import {
  contentReports,
  type Db,
  emailOutbox,
  messagePosts,
  messageThreads,
  moderationActions,
} from "@picks/db";
import { REMOVED_TEXT_RETENTION_MS, REPORT_OVERDUE_MS, screeningVerdict } from "@picks/shared";
import { and, asc, count, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { flag, hidePost } from "./moderation";
import type { EmailDeps } from "./outbox";
import type { Screener } from "./screening";
import { moderationDigestEmail } from "./templates";

const DAY_MS = 24 * 60 * 60_000;
/** Posts rechecked per run. Small, like the outbox's batches, so a run cut short strands little. */
const RECHECK_BATCH = 20;
/** Older unchecked posts aren't worth checking any more: they have been read, and reports cover them. */
const RECHECK_WINDOW_MS = 7 * DAY_MS;
/** The digest goes out once a day, from this UTC hour (9am US Eastern in winter). */
const DIGEST_HOUR_UTC = 14;

/**
 * Screens posts saved while the model didn't answer. A block verdict hides the post and flags it for review, since
 * it is already up. Stops at the first post the model still can't answer, so an outage isn't hammered.
 */
export async function recheckUnchecked(db: Db, screener: Screener, now: Date) {
  const rows = await db
    .select({ post: messagePosts, title: messageThreads.title, leagueId: messageThreads.leagueId })
    .from(messagePosts)
    .innerJoin(messageThreads, eq(messageThreads.id, messagePosts.threadId))
    .where(
      and(
        eq(messagePosts.screening, "unchecked"),
        isNull(messagePosts.removedAt),
        gte(messagePosts.createdAt, new Date(now.getTime() - RECHECK_WINDOW_MS)),
      ),
    )
    .orderBy(asc(messagePosts.createdAt))
    .limit(RECHECK_BATCH);
  let checked = 0;
  for (const { post, title, leagueId } of rows) {
    const opening = post.position === 1;
    const scores = await screener.screen({
      kind: opening ? "thread" : "reply",
      text: opening ? `${title}\n\n${post.body}` : post.body,
      ...(!opening && { context: [title] }),
    });
    if (!scores) break;
    const verdict = screeningVerdict(scores);
    await db.transaction(async (tx) => {
      // Only if it is still unchecked: a concurrent run may have got here first.
      const [updated] = await tx
        .update(messagePosts)
        .set({ screening: verdict, screeningScores: scores })
        .where(and(eq(messagePosts.id, post.id), eq(messagePosts.screening, "unchecked")))
        .returning({ id: messagePosts.id });
      if (!updated || verdict === "allow") return;
      await flag(
        tx,
        { kind: "post", postId: post.id, subjectUserId: post.authorId, leagueId },
        "recheck",
        now,
      );
      const [report] = await tx
        .select({ id: contentReports.id })
        .from(contentReports)
        .where(and(eq(contentReports.postId, post.id), eq(contentReports.status, "open")))
        .limit(1);
      if (report) await hidePost(tx, post.id, leagueId, report.id, "recheck blocked", now);
    });
    checked++;
  }
  return checked;
}

/** A removed message's text is kept 30 days for appeals, then cleared. The row stays. */
export async function clearRemovedText(db: Db, now: Date) {
  const cleared = await db
    .update(messagePosts)
    .set({ body: "" })
    .where(
      and(
        lt(messagePosts.removedAt, new Date(now.getTime() - REMOVED_TEXT_RETENTION_MS)),
        ne(messagePosts.body, ""),
      ),
    )
    .returning({ id: messagePosts.id });
  return cleared.length;
}

/**
 * Queues the operator's daily digest from 14:00 UTC: open reports, those close to 24 hours old, and what
 * automation removed or hid in the last day. Nothing is sent on a quiet day. Once per day per operator.
 */
export async function queueDigest(db: Db, email: EmailDeps, operatorUserIds: readonly string[], now: Date) {
  if (!operatorUserIds.length || now.getUTCHours() < DIGEST_HOUR_UTC) return 0;
  const since = new Date(now.getTime() - DAY_MS);
  const [open] = await db
    .select({
      n: count(),
      overdue: sql<number>`(count(*) filter (where ${contentReports.createdAt} < ${new Date(now.getTime() - REPORT_OVERDUE_MS).toISOString()}::timestamptz))::int`,
    })
    .from(contentReports)
    .where(eq(contentReports.status, "open"));
  const [automatic] = await db
    .select({
      removed: sql<number>`(count(*) filter (where ${moderationActions.action} = 'remove'))::int`,
      hidden: sql<number>`(count(*) filter (where ${moderationActions.action} = 'hide'))::int`,
    })
    .from(moderationActions)
    .where(and(isNull(moderationActions.actorId), gte(moderationActions.createdAt, since)));
  const counts = {
    open: open?.n ?? 0,
    overdue: open?.overdue ?? 0,
    removed: automatic?.removed ?? 0,
    hidden: automatic?.hidden ?? 0,
  };
  if (!counts.open && !counts.removed && !counts.hidden) return 0;
  const day = now.toISOString().slice(0, 10);
  const inserted = await db
    .insert(emailOutbox)
    .values(
      operatorUserIds.map((userId) => ({
        userId,
        kind: "moderation" as const,
        dedupeKey: `moderation:digest:${day}:${userId}`,
        nextAttemptAt: now,
        expiresAt: new Date(now.getTime() + DAY_MS / 2),
        message: moderationDigestEmail({ url: `${email.appUrl}/operator`, ...counts }),
      })),
    )
    .onConflictDoNothing({ target: emailOutbox.dedupeKey })
    .returning({ id: emailOutbox.id });
  return inserted.length;
}

/** The scheduled moderation work. Each part is idempotent and fails on its own. */
export async function runModerationJobs(
  db: Db,
  deps: { screener?: Screener; email?: EmailDeps; operatorUserIds?: readonly string[] },
  now: Date,
) {
  const rechecked = deps.screener ? await recheckUnchecked(db, deps.screener, now) : 0;
  const cleared = await clearRemovedText(db, now);
  const digests =
    deps.email && deps.operatorUserIds ? await queueDigest(db, deps.email, deps.operatorUserIds, now) : 0;
  return { rechecked, cleared, digests };
}
