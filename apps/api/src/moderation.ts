import {
  contentReports,
  emailOutbox,
  leagueMembers,
  leagues,
  messagePosts,
  messageThreads,
  moderationActions,
  profiles,
  userBlocks,
} from "@picks/db";
import {
  activeMute,
  appealSchema,
  type BlockedPlayer,
  DELETED_MESSAGE_TEXT,
  HIDDEN_TEXT,
  MODERATION_MESSAGES,
  MUTE_DURATIONS,
  type MuteDuration,
  mutedMessage,
  muteSchema,
  type OperatorReportQueue,
  type PostState,
  REMOVED_TEXT,
  REPORT_DAILY_LIMIT,
  type ReportItem,
  type ReportQueue,
  reportSchema,
  resolveReportSchema,
  SCREENING_THRESHOLDS,
  type ScreeningScores,
  STRIKE_WINDOW_MS,
  screeningVerdict,
  strikeConsequence,
  suspensionSchema,
} from "@picks/shared";
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "./auth";
import {
  type AppDeps,
  body,
  fail,
  isOperator,
  leagueParam,
  param,
  requireAdmin,
  requireMember,
  type Tx,
} from "./context";
import { logError } from "./logging";
import { drainOutbox } from "./outbox";
import type { Screener, ScreenInput } from "./screening";
import { moderationAlertEmail } from "./templates";

type Store = AppDeps["db"] | Tx;

const DAY_MS = 24 * 60 * 60_000;

/** What a report is about, one key per message, player name or league name. */
export const postKey = (postId: string) => `post:${postId}`;
export const nameKey = (userId: string) => `name:${userId}`;
export const leagueKey = (leagueId: string) => `league:${leagueId}`;

/** Timestamps go into raw SQL as ISO text with a cast: the driver doesn't take a bare Date there. */
const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;

// ---------- Who may post ----------

/** The player's profile and, in a league, their mute there. Undefined without a profile (no display name yet). */
export async function posterState(db: Store, userId: string, leagueId: string | null) {
  const [row] = await db
    .select({
      termsAcceptedAt: profiles.termsAcceptedAt,
      mutedUntil: profiles.mutedUntil,
      suspendedAt: profiles.suspendedAt,
      leagueMutedUntil: leagueMembers.mutedUntil,
    })
    .from(profiles)
    .leftJoin(
      leagueMembers,
      and(
        eq(leagueMembers.userId, profiles.userId),
        leagueId ? eq(leagueMembers.leagueId, leagueId) : sql`false`,
      ),
    )
    .where(eq(profiles.userId, userId));
  return row;
}

/** Why this player can't post or react right now, or null. Picking is never affected. */
export function postingBlocked(state: Awaited<ReturnType<typeof posterState>>, now: Date): string | null {
  if (!state) return null;
  if (state.suspendedAt) return MODERATION_MESSAGES.suspended;
  const muted = activeMute(now, state.mutedUntil, state.leagueMutedUntil);
  return muted ? mutedMessage(muted, now) : null;
}

/** Posting, replying and reacting need a display name, agreed terms, and no running mute or suspension. */
export async function requirePoster(db: Store, userId: string, leagueId: string | null, now: Date) {
  const state = await posterState(db, userId, leagueId);
  if (!state) fail(409, "Choose a display name first.");
  if (!state.termsAcceptedAt) fail(409, MODERATION_MESSAGES.terms);
  const blocked = postingBlocked(state, now);
  if (blocked) fail(403, blocked);
}

/** A suspended player can't change names others see. */
export async function requireNotSuspended(db: Store, userId: string) {
  const [row] = await db
    .select({ suspendedAt: profiles.suspendedAt })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (row?.suspendedAt) fail(403, MODERATION_MESSAGES.suspended);
}

// ---------- Screening ----------

export type Screened = {
  screening: "allow" | "unchecked" | "skipped";
  screeningScores: ScreeningScores | null;
};

/**
 * Asks the screening model about content before it is saved. A block verdict refuses the request with `refusal`;
 * allow saves it; a model that didn't answer saves it `unchecked` for the scheduled recheck. Without a screener
 * (screening off, local development, most tests) it is `skipped`.
 */
export async function screen(
  screener: Screener | undefined,
  input: ScreenInput,
  refusal: string,
): Promise<Screened> {
  if (!screener) return { screening: "skipped", screeningScores: null };
  const scores = await screener.screen(input);
  if (!scores) return { screening: "unchecked", screeningScores: null };
  const verdict = screeningVerdict(scores);
  if (verdict === "block") fail(400, refusal);
  return { screening: verdict, screeningScores: scores };
}

type FlagTarget =
  | { kind: "post"; postId: string; subjectUserId: string; leagueId: string }
  | { kind: "display_name"; subjectUserId: string; leagueId?: string | null }
  | { kind: "league_name"; leagueId: string };

function targetKeyOf(target: FlagTarget) {
  if (target.kind === "post") return postKey(target.postId);
  if (target.kind === "display_name") return nameKey(target.subjectUserId);
  return leagueKey(target.leagueId);
}

/** Files an automatic flag in the queue (from the recheck of unchecked posts). At most one open flag per target. */
export async function flag(db: Store, target: FlagTarget, source: "recheck", now: Date) {
  await db
    .insert(contentReports)
    .values({
      kind: target.kind,
      targetKey: targetKeyOf(target),
      postId: target.kind === "post" ? target.postId : null,
      subjectUserId: target.kind === "league_name" ? null : target.subjectUserId,
      leagueId: target.leagueId ?? null,
      source,
      reason: "flagged",
      createdAt: now,
    })
    .onConflictDoNothing();
}

// ---------- Blocks and how messages are shown ----------

/** The players this player has blocked. */
export async function blockedBy(db: Store, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: userBlocks.blockedId })
    .from(userBlocks)
    .where(eq(userBlocks.blockerId, userId));
  return new Set(rows.map((r) => r.id));
}

/** SQL: the reader has blocked this author. */
export const readerBlocked = (readerId: string, authorId: unknown) =>
  sql`exists (select 1 from ${userBlocks} where ${userBlocks.blockerId} = ${readerId} and ${userBlocks.blockedId} = ${authorId})`;

/**
 * SQL: the thread's opening message is gone for this reader: removed, or hidden for review and the reader is
 * neither its author nor a league admin. Such a thread is left off the board and answers 404.
 */
export const openingPostGone = (readerId: string, readerIsAdmin: boolean) => sql`exists (
  select 1 from ${messagePosts} op
  where op.thread_id = ${messageThreads.id} and op.position = 1
    and (op.removed_at is not null
      or (op.hidden_at is not null and op.author_id <> ${readerId} and ${readerIsAdmin ? sql`false` : sql`true`})))`;

/** How one message is shown to one reader, and the text they may see. */
export function postView(
  post: { authorId: string; body: string; hiddenAt: Date | null; removedAt: Date | null },
  reader: { userId: string; isAdmin: boolean; blocked: ReadonlySet<string> },
  authorDeleted = false,
): { state: PostState; body: string } {
  // The author deleted their account: the text is already cleared.
  if (authorDeleted) return { state: "deleted", body: DELETED_MESSAGE_TEXT };
  if (post.removedAt) return { state: "removed", body: REMOVED_TEXT };
  if (post.hiddenAt) {
    if (post.authorId === reader.userId) return { state: "review", body: post.body };
    return { state: "hidden", body: reader.isAdmin ? post.body : HIDDEN_TEXT };
  }
  if (reader.blocked.has(post.authorId)) return { state: "blocked", body: post.body };
  return { state: "visible", body: post.body };
}

// ---------- Actions ----------

async function logAction(tx: Store, values: typeof moderationActions.$inferInsert) {
  await tx.insert(moderationActions).values(values);
}

/** Closes the open reports on a target (never appeals, which are decided on their own). */
export async function closeReports(
  tx: Store,
  targetKey: string,
  status: "removed" | "dismissed",
  actorId: string | null,
  now: Date,
) {
  await tx
    .update(contentReports)
    .set({ status, resolvedAt: now, resolvedBy: actorId })
    .where(
      and(
        eq(contentReports.targetKey, targetKey),
        eq(contentReports.status, "open"),
        ne(contentReports.source, "appeal"),
      ),
    );
}

/** Mutes a player app-wide until at least `until`, never shortening a longer mute. */
async function muteEverywhere(tx: Store, userId: string, until: Date) {
  await tx
    .update(profiles)
    .set({ mutedUntil: sql`greatest(coalesce(${profiles.mutedUntil}, ${at(until)}), ${at(until)})` })
    .where(eq(profiles.userId, userId));
}

/** A removal counts against its author: the second in 30 days mutes them for a day, the third for a week. */
async function applyStrikes(tx: Store, authorId: string, leagueId: string | null, now: Date) {
  const [row] = await tx
    .select({ n: count() })
    .from(messagePosts)
    .where(
      and(
        eq(messagePosts.authorId, authorId),
        gte(messagePosts.removedAt, new Date(now.getTime() - STRIKE_WINDOW_MS)),
      ),
    );
  const consequence = strikeConsequence(row?.n ?? 0);
  if (!consequence) return;
  await muteEverywhere(tx, authorId, new Date(now.getTime() + MUTE_DURATIONS[consequence.mute]));
  await logAction(tx, {
    action: "mute",
    userId: authorId,
    leagueId,
    actorId: null,
    note: `${row?.n ?? 0} removals in 30 days`,
    createdAt: now,
  });
}

/** Takes a message down for everyone. The row stays, so positions and quotes still line up. */
export async function removePost(
  tx: Store,
  input: { postId: string; leagueId: string | null; actorId: string | null; reportId?: string; now: Date },
) {
  const [post] = await tx
    .update(messagePosts)
    .set({ removedAt: input.now, removedBy: input.actorId, hiddenAt: null })
    .where(and(eq(messagePosts.id, input.postId), isNull(messagePosts.removedAt)))
    .returning();
  if (!post) return null;
  await closeReports(tx, postKey(post.id), "removed", input.actorId, input.now);
  await logAction(tx, {
    action: "remove",
    postId: post.id,
    userId: post.authorId,
    leagueId: input.leagueId,
    actorId: input.actorId,
    reportId: input.reportId,
    createdAt: input.now,
  });
  await applyStrikes(tx, post.authorId, input.leagueId, input.now);
  return post;
}

/** Hides a message until someone reviews it. */
export async function hidePost(
  tx: Store,
  postId: string,
  leagueId: string,
  reportId: string,
  note: string,
  now: Date,
) {
  const [post] = await tx
    .update(messagePosts)
    .set({ hiddenAt: now })
    .where(and(eq(messagePosts.id, postId), isNull(messagePosts.hiddenAt), isNull(messagePosts.removedAt)))
    .returning({ id: messagePosts.id, authorId: messagePosts.authorId });
  if (post)
    await logAction(tx, {
      action: "hide",
      postId,
      userId: post.authorId,
      leagueId,
      reportId,
      note,
      createdAt: now,
    });
  return !!post;
}

/** Puts a hidden or removed message back. */
async function restorePost(tx: Store, postId: string, leagueId: string | null, actorId: string, now: Date) {
  const [post] = await tx
    .update(messagePosts)
    .set({ removedAt: null, removedBy: null, hiddenAt: null })
    .where(eq(messagePosts.id, postId))
    .returning();
  if (post)
    await logAction(tx, {
      action: "restore",
      postId,
      userId: post.authorId,
      leagueId,
      actorId,
      createdAt: now,
    });
  return post;
}

/** Resets a reported display name or league name to a neutral one. */
async function resetName(
  tx: Store,
  report: { kind: string; subjectUserId: string | null; leagueId: string | null; id?: string },
  actorId: string | null,
  now: Date,
) {
  if (report.kind === "display_name" && report.subjectUserId) {
    await tx.update(profiles).set({ displayName: "Player" }).where(eq(profiles.userId, report.subjectUserId));
    await closeReports(tx, nameKey(report.subjectUserId), "removed", actorId, now);
  } else if (report.kind === "league_name" && report.leagueId) {
    await tx.update(leagues).set({ name: "League" }).where(eq(leagues.id, report.leagueId));
    await closeReports(tx, leagueKey(report.leagueId), "removed", actorId, now);
  } else return;
  await logAction(tx, {
    action: "reset_name",
    userId: report.subjectUserId,
    leagueId: report.leagueId,
    actorId,
    reportId: report.id,
    createdAt: now,
  });
}

/** Emails the operators about a report that can't wait for the digest (threats or self-harm). */
async function alertOperators(deps: AppDeps, reportId: string, now: Date) {
  const { db, email, operatorUserIds, background = (task) => void task() } = deps;
  if (!email || !operatorUserIds?.length) return;
  try {
    await db
      .insert(emailOutbox)
      .values(
        operatorUserIds.map((userId) => ({
          userId,
          kind: "moderation" as const,
          dedupeKey: `moderation:alert:${reportId}:${userId}`,
          nextAttemptAt: now,
          expiresAt: new Date(now.getTime() + DAY_MS),
          message: moderationAlertEmail({ url: `${email.appUrl}/operator` }),
        })),
      )
      .onConflictDoNothing({ target: emailOutbox.dedupeKey });
    background(() => drainOutbox(db, email, now).catch((err) => logError("email_jobs", err)));
  } catch (error) {
    logError("moderation_report", error);
  }
}

// ---------- The queue ----------

const reporter = alias(profiles, "reporter");
const subject = alias(profiles, "subject");

/**
 * Open reports, newest information first, shaped for the queue screens. `viewerId` is who is reviewing: an item
 * says whether they can open its thread (`canOpen`), which the operator can't in a league they aren't in.
 */
async function queueItems(
  db: AppDeps["db"],
  where: SQL | undefined,
  viewerId: string,
): Promise<ReportItem[]> {
  const rows = await db
    .select({
      report: contentReports,
      leagueName: leagues.name,
      reporterName: reporter.displayName,
      subjectName: subject.displayName,
      post: messagePosts,
      threadTitle: messageThreads.title,
      subjectRole: leagueMembers.role,
      others: sql<number>`(select count(*)::int - 1 from ${contentReports} o
        where o.target_key = ${contentReports.targetKey} and o.status = 'open' and o.source <> 'appeal')`,
      // The same rule as the thread route: a current member, and the opening message isn't gone for them.
      canOpen: sql<boolean>`exists (select 1 from ${leagueMembers} v
        where v.league_id = ${contentReports.leagueId} and v.user_id = ${viewerId} and v.removed_at is null
          and not exists (select 1 from ${messagePosts} op
            where op.thread_id = ${messagePosts.threadId} and op.position = 1
              and (op.removed_at is not null
                or (op.hidden_at is not null and op.author_id <> ${viewerId} and v.role <> 'admin'))))`,
    })
    .from(contentReports)
    .leftJoin(leagues, eq(leagues.id, contentReports.leagueId))
    .leftJoin(reporter, eq(reporter.userId, contentReports.reporterId))
    .leftJoin(subject, eq(subject.userId, contentReports.subjectUserId))
    .leftJoin(messagePosts, eq(messagePosts.id, contentReports.postId))
    .leftJoin(messageThreads, eq(messageThreads.id, messagePosts.threadId))
    .leftJoin(
      leagueMembers,
      and(
        eq(leagueMembers.leagueId, contentReports.leagueId),
        eq(leagueMembers.userId, contentReports.subjectUserId),
        isNull(leagueMembers.removedAt),
      ),
    )
    .where(where)
    .orderBy(asc(contentReports.createdAt))
    .limit(200);
  return rows.map(({ report, post, ...row }) => ({
    id: report.id,
    kind: report.kind,
    source: report.source,
    reason: report.reason,
    note: report.note,
    createdAt: report.createdAt.toISOString(),
    league: report.leagueId && row.leagueName ? { id: report.leagueId, name: row.leagueName } : null,
    reporterName: report.source === "player" ? (row.reporterName ?? "Player") : null,
    subject: report.subjectUserId
      ? { userId: report.subjectUserId, displayName: row.subjectName ?? "Player" }
      : null,
    post:
      post && row.threadTitle !== null
        ? {
            id: post.id,
            threadId: post.threadId,
            threadTitle: row.threadTitle,
            position: post.position,
            body: post.body,
            hidden: !!post.hiddenAt,
            removed: !!post.removedAt,
          }
        : null,
    otherReports: Math.max(0, row.others),
    aboutAdmin: row.subjectRole === "admin",
    ...(post && row.threadTitle !== null && { canOpen: !!row.canOpen }),
  }));
}

/** SQL: what a league's admins review: their league's reports about members, never appeals or the league's name. */
const adminReviewable = (leagueId: string) =>
  and(
    eq(contentReports.status, "open"),
    eq(contentReports.leagueId, leagueId),
    ne(contentReports.source, "appeal"),
    ne(contentReports.kind, "league_name"),
    sql`not exists (select 1 from ${leagueMembers} a where a.league_id = ${leagueId}
      and a.user_id = ${contentReports.subjectUserId} and a.role = 'admin' and a.removed_at is null)`,
  );

export async function openReportCount(db: AppDeps["db"], leagueId: string) {
  const [row] = await db.select({ n: count() }).from(contentReports).where(adminReviewable(leagueId));
  return row?.n ?? 0;
}

const reportParam = param(z.object({ reportId: z.uuid() }));
const userParam = param(z.object({ userId: z.uuid() }));
const memberParam = param(z.object({ leagueId: z.uuid(), userId: z.uuid() }));
const postParam = param(z.object({ leagueId: z.uuid(), threadId: z.uuid(), postId: z.uuid() }));

export function moderationRoutes(deps: AppDeps) {
  const { db, verifyToken, screener, now = () => new Date() } = deps;
  const auth = requireAuth(verifyToken);
  const operator = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    if (!isOperator(deps, c.var.user.id)) fail(404, "Not found");
    await next();
  });

  /** The reported message, when it belongs to that league and thread. */
  async function findPost(leagueId: string, threadId: string, postId: string) {
    const [row] = await db
      .select({ post: messagePosts, threadTitle: messageThreads.title })
      .from(messagePosts)
      .innerJoin(messageThreads, eq(messageThreads.id, messagePosts.threadId))
      .where(
        and(
          eq(messagePosts.id, postId),
          eq(messagePosts.threadId, threadId),
          eq(messageThreads.leagueId, leagueId),
        ),
      );
    return row;
  }

  /**
   * What happens right after a player reports a message: a threats or self-harm report hides it and emails the
   * operator; a second reporter hides it; and the larger model, reading the thread around it, removes it when it
   * is sure. Anything else waits in the queue.
   */
  async function triagePost(report: { id: string; reason: string; leagueId: string }, postId: string) {
    const clock = now();
    const [row] = await db
      .select({ post: messagePosts, title: messageThreads.title })
      .from(messagePosts)
      .innerJoin(messageThreads, eq(messageThreads.id, messagePosts.threadId))
      .where(eq(messagePosts.id, postId));
    if (!row || row.post.removedAt) return;
    const [reporters] = await db
      .select({ n: sql<number>`count(distinct ${contentReports.reporterId})::int` })
      .from(contentReports)
      .where(
        and(
          eq(contentReports.targetKey, postKey(postId)),
          eq(contentReports.status, "open"),
          eq(contentReports.source, "player"),
        ),
      );
    if (report.reason === "threat_self_harm") {
      await hidePost(db, postId, report.leagueId, report.id, "threat or self-harm report", clock);
      await alertOperators(deps, report.id, clock);
    } else if ((reporters?.n ?? 0) >= 2) {
      await hidePost(db, postId, report.leagueId, report.id, "two reports", clock);
    }
    if (!screener) return;
    const before = await db
      .select({ body: messagePosts.body })
      .from(messagePosts)
      .where(
        and(
          eq(messagePosts.threadId, row.post.threadId),
          sql`${messagePosts.position} < ${row.post.position}`,
          isNull(messagePosts.removedAt),
        ),
      )
      .orderBy(desc(messagePosts.position))
      .limit(5);
    const scores = await screener.screen(
      {
        kind: row.post.position === 1 ? "thread" : "reply",
        text: row.post.position === 1 ? `${row.title}\n\n${row.post.body}` : row.post.body,
        context: [row.title, ...before.reverse().map((b) => b.body)],
      },
      { deep: true },
    );
    if (scores && scores.block >= SCREENING_THRESHOLDS.reportRemove) {
      await db.transaction((tx) =>
        removePost(tx, { postId, leagueId: report.leagueId, actorId: null, reportId: report.id, now: clock }),
      );
    }
  }

  /** A reported name gets the same second look; a sure verdict resets it. */
  async function triageName(report: {
    id: string;
    kind: "display_name" | "league_name";
    subjectUserId: string | null;
    leagueId: string;
  }) {
    if (!screener) return;
    const [name] =
      report.kind === "display_name" && report.subjectUserId
        ? await db
            .select({ text: profiles.displayName })
            .from(profiles)
            .where(eq(profiles.userId, report.subjectUserId))
        : await db.select({ text: leagues.name }).from(leagues).where(eq(leagues.id, report.leagueId));
    if (!name) return;
    const scores = await screener.screen({ kind: report.kind, text: name.text }, { deep: true });
    if (scores && scores.block >= SCREENING_THRESHOLDS.reportRemove)
      await db.transaction((tx) => resetName(tx, report, null, now()));
  }

  /** May this account resolve this report? The operator always; a league admin for their league's members. */
  async function requireReviewer(reportId: string, userId: string) {
    const [report] = await db.select().from(contentReports).where(eq(contentReports.id, reportId));
    if (report?.status !== "open") fail(404, "Report not found.");
    if (isOperator(deps, userId)) return { report, asOperator: true };
    if (!report.leagueId || report.source === "appeal" || report.kind === "league_name")
      fail(404, "Report not found.");
    const { role } = await requireMember(db, report.leagueId, userId).catch(() =>
      fail(404, "Report not found."),
    );
    if (role !== "admin") fail(404, "Report not found.");
    const [reviewable] = await db
      .select({ id: contentReports.id })
      .from(contentReports)
      .where(and(eq(contentReports.id, reportId), adminReviewable(report.leagueId)));
    if (!reviewable) fail(404, "Report not found.");
    return { report, asOperator: false };
  }

  async function mute(
    tx: Store,
    input: { userId: string; leagueId: string | null; duration: MuteDuration | null; actorId: string },
  ) {
    const clock = now();
    const until = input.duration ? new Date(clock.getTime() + MUTE_DURATIONS[input.duration]) : null;
    if (input.leagueId)
      await tx
        .update(leagueMembers)
        .set({ mutedUntil: until })
        .where(and(eq(leagueMembers.leagueId, input.leagueId), eq(leagueMembers.userId, input.userId)));
    else await tx.update(profiles).set({ mutedUntil: until }).where(eq(profiles.userId, input.userId));
    await logAction(tx, {
      action: until ? "mute" : "unmute",
      userId: input.userId,
      leagueId: input.leagueId,
      actorId: input.actorId,
      note: input.duration ?? null,
      createdAt: clock,
    });
  }

  return new Hono<{ Variables: AuthVariables }>()
    .put("/me/terms", auth, async (c) => {
      const [row] = await db
        .update(profiles)
        .set({ termsAcceptedAt: sql`coalesce(${profiles.termsAcceptedAt}, now())` })
        .where(eq(profiles.userId, c.var.user.id))
        .returning({ id: profiles.userId });
      if (!row) fail(409, "Choose a display name first.");
      return c.json({ ok: true });
    })
    .post("/reports", auth, body(reportSchema), async (c) => {
      const input = c.req.valid("json");
      const userId = c.var.user.id;
      const clock = now();
      await requireMember(db, input.leagueId, userId);
      let target: {
        kind: "post" | "display_name" | "league_name";
        targetKey: string;
        postId: string | null;
        subjectUserId: string | null;
      };
      if (input.kind === "post") {
        const found = await findPost(input.leagueId, input.threadId, input.postId);
        if (!found || found.post.removedAt) fail(404, "Message not found.");
        if (found.post.authorId === userId) fail(400, "You can't report your own message.");
        target = {
          kind: "post",
          targetKey: postKey(found.post.id),
          postId: found.post.id,
          subjectUserId: found.post.authorId,
        };
      } else if (input.kind === "display_name") {
        if (input.userId === userId) fail(400, "You can't report your own name.");
        await requireMember(db, input.leagueId, input.userId).catch(() => fail(404, "Player not found."));
        target = {
          kind: "display_name",
          targetKey: nameKey(input.userId),
          postId: null,
          subjectUserId: input.userId,
        };
      } else {
        target = {
          kind: "league_name",
          targetKey: leagueKey(input.leagueId),
          postId: null,
          subjectUserId: null,
        };
      }
      const report = await db.transaction(async (tx) => {
        // One report at a time per player, so two at once can't both slip under the daily limit.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`report:${userId}`}, 0))`);
        const [recent] = await tx
          .select({ n: count() })
          .from(contentReports)
          .where(
            and(
              eq(contentReports.reporterId, userId),
              eq(contentReports.source, "player"),
              gte(contentReports.createdAt, new Date(clock.getTime() - DAY_MS)),
            ),
          );
        if ((recent?.n ?? 0) >= REPORT_DAILY_LIMIT)
          fail(429, "You've sent a lot of reports today. Try again tomorrow.");
        const [existing] = await tx
          .select({ id: contentReports.id })
          .from(contentReports)
          .where(
            and(
              eq(contentReports.targetKey, target.targetKey),
              eq(contentReports.reporterId, userId),
              eq(contentReports.status, "open"),
            ),
          );
        if (existing) {
          // A second report on the same thing updates the first, rather than counting twice.
          await tx
            .update(contentReports)
            .set({ reason: input.reason, note: input.note || null })
            .where(eq(contentReports.id, existing.id));
          return { id: existing.id, fresh: false };
        }
        const [created] = await tx
          .insert(contentReports)
          .values({
            ...target,
            leagueId: input.leagueId,
            reporterId: userId,
            source: "player",
            reason: input.reason,
            note: input.note || null,
            createdAt: clock,
          })
          .returning({ id: contentReports.id });
        if (!created) throw new Error("Report insert returned no row");
        return { id: created.id, fresh: true };
      });
      if (report.fresh) {
        // The report is saved either way; triage failing (the model, say) leaves it for a person.
        try {
          if (target.kind === "post" && target.postId)
            await triagePost(
              { id: report.id, reason: input.reason, leagueId: input.leagueId },
              target.postId,
            );
          else if (target.kind !== "post")
            await triageName({
              id: report.id,
              kind: target.kind,
              subjectUserId: target.subjectUserId,
              leagueId: input.leagueId,
            });
        } catch (error) {
          logError("moderation_report", error);
        }
      }
      return c.json({ ok: true }, 201);
    })
    .post(
      "/leagues/:leagueId/messages/:threadId/posts/:postId/appeal",
      auth,
      postParam,
      body(appealSchema),
      async (c) => {
        const { leagueId, threadId, postId } = c.req.valid("param");
        const userId = c.var.user.id;
        await requireMember(db, leagueId, userId);
        const found = await findPost(leagueId, threadId, postId);
        if (!found || found.post.authorId !== userId || !found.post.removedAt)
          fail(404, "Message not found.");
        // Once per message: an appeal already filed (open or decided) can't be filed again.
        const [earlier] = await db
          .select({ id: contentReports.id })
          .from(contentReports)
          .where(and(eq(contentReports.targetKey, postKey(postId)), eq(contentReports.source, "appeal")));
        if (earlier) fail(409, "You've already asked for a review of this message.");
        await db
          .insert(contentReports)
          .values({
            kind: "post",
            targetKey: postKey(postId),
            postId,
            subjectUserId: userId,
            leagueId,
            reporterId: userId,
            source: "appeal",
            reason: "appeal",
            note: c.req.valid("json").note || null,
            createdAt: now(),
          })
          .onConflictDoNothing();
        return c.json({ ok: true }, 201);
      },
    )
    .get("/blocks", auth, async (c) => {
      const rows = await db
        .select({
          userId: userBlocks.blockedId,
          displayName: sql<string>`coalesce(${profiles.displayName}, 'Player')`,
          blockedAt: userBlocks.createdAt,
        })
        .from(userBlocks)
        .leftJoin(profiles, eq(profiles.userId, userBlocks.blockedId))
        .where(eq(userBlocks.blockerId, c.var.user.id))
        .orderBy(asc(sql`coalesce(${profiles.displayName}, 'Player')`));
      return c.json<BlockedPlayer[]>(rows.map((r) => ({ ...r, blockedAt: r.blockedAt.toISOString() })));
    })
    .put("/blocks/:userId", auth, userParam, async (c) => {
      const { userId } = c.req.valid("param");
      if (userId === c.var.user.id) fail(400, "You can't block yourself.");
      const [target] = await db
        .select({ id: profiles.userId })
        .from(profiles)
        .where(eq(profiles.userId, userId));
      if (!target) fail(404, "Player not found.");
      await db
        .insert(userBlocks)
        .values({ blockerId: c.var.user.id, blockedId: userId, createdAt: now() })
        .onConflictDoNothing();
      return c.json({ blocked: true });
    })
    .delete("/blocks/:userId", auth, userParam, async (c) => {
      await db
        .delete(userBlocks)
        .where(
          and(eq(userBlocks.blockerId, c.var.user.id), eq(userBlocks.blockedId, c.req.valid("param").userId)),
        );
      return c.json({ blocked: false });
    })
    .get("/leagues/:leagueId/reports", auth, leagueParam, async (c) => {
      const { leagueId } = c.req.valid("param");
      requireAdmin((await requireMember(db, leagueId, c.var.user.id)).role);
      return c.json<ReportQueue>({
        items: await queueItems(db, adminReviewable(leagueId), c.var.user.id),
      });
    })
    .post("/reports/:reportId/resolve", auth, reportParam, body(resolveReportSchema), async (c) => {
      const { reportId } = c.req.valid("param");
      const actorId = c.var.user.id;
      const { action, mute: muteFor } = c.req.valid("json");
      const { report, asOperator } = await requireReviewer(reportId, actorId);
      const appeal = report.source === "appeal";
      if (appeal ? action === "remove" : action === "restore")
        fail(
          400,
          appeal ? "Restore the message or keep it removed." : "Remove the content or dismiss the report.",
        );
      const clock = now();
      await db.transaction(async (tx) => {
        if (appeal) {
          // An appeal is decided on its own: restoring puts the message back (and takes back the strike).
          if (action === "restore" && report.postId)
            await restorePost(tx, report.postId, report.leagueId, actorId, clock);
          await tx
            .update(contentReports)
            .set({
              status: action === "restore" ? "dismissed" : "removed",
              resolvedAt: clock,
              resolvedBy: actorId,
            })
            .where(eq(contentReports.id, report.id));
          return;
        }
        if (action === "remove") {
          if (report.kind === "post" && report.postId)
            await removePost(tx, {
              postId: report.postId,
              leagueId: report.leagueId,
              actorId,
              reportId: report.id,
              now: clock,
            });
          else await resetName(tx, report, actorId, clock);
        } else {
          if (report.postId)
            await tx.update(messagePosts).set({ hiddenAt: null }).where(eq(messagePosts.id, report.postId));
          await closeReports(tx, report.targetKey, "dismissed", actorId, clock);
          await logAction(tx, {
            action: "dismiss",
            postId: report.postId,
            userId: report.subjectUserId,
            leagueId: report.leagueId,
            actorId,
            reportId: report.id,
            createdAt: clock,
          });
        }
        if (muteFor && report.subjectUserId)
          await mute(tx, {
            userId: report.subjectUserId,
            // An admin's mute holds in their league; the operator's everywhere.
            leagueId: asOperator ? null : report.leagueId,
            duration: muteFor,
            actorId,
          });
      });
      return c.json({ ok: true });
    })
    .put(
      "/leagues/:leagueId/messages/:threadId/posts/:postId/moderation",
      auth,
      postParam,
      body(z.object({ action: z.enum(["remove", "restore"]) })),
      async (c) => {
        const { leagueId, threadId, postId } = c.req.valid("param");
        const actorId = c.var.user.id;
        requireAdmin((await requireMember(db, leagueId, actorId)).role);
        const found = await findPost(leagueId, threadId, postId);
        if (!found) fail(404, "Message not found.");
        const { action } = c.req.valid("json");
        if (
          action === "restore" &&
          found.post.removedBy &&
          found.post.removedBy !== actorId &&
          isOperator(deps, found.post.removedBy)
        )
          fail(403, "The people who run POW Pick'em removed this message, so only they can restore it.");
        await db.transaction(async (tx) => {
          if (action === "remove") await removePost(tx, { postId, leagueId, actorId, now: now() });
          else {
            await restorePost(tx, postId, leagueId, actorId, now());
            await closeReports(tx, postKey(postId), "dismissed", actorId, now());
          }
        });
        return c.json({ ok: true });
      },
    )
    .put("/leagues/:leagueId/members/:userId/mute", auth, memberParam, body(muteSchema), async (c) => {
      const { leagueId, userId } = c.req.valid("param");
      requireAdmin((await requireMember(db, leagueId, c.var.user.id)).role);
      const target = await requireMember(db, leagueId, userId).catch(() => fail(404, "Player not found."));
      if (target.role === "admin")
        fail(400, "Commissioners can't be muted. Revoke their commissioner access first.");
      await db.transaction((tx) =>
        mute(tx, { userId, leagueId, duration: c.req.valid("json").duration, actorId: c.var.user.id }),
      );
      return c.json({ ok: true });
    })
    .get("/operator/reports", auth, operator, async (c) => {
      const clock = now();
      const items = await queueItems(db, and(eq(contentReports.status, "open")), c.var.user.id);
      // Players with three or more removals in 30 days, for a suspension decision.
      const repeat = await db
        .select({
          userId: messagePosts.authorId,
          displayName: sql<string>`coalesce(max(${profiles.displayName}), 'Player')`,
          removals: count(),
          mutedUntil: sql<Date | null>`max(${profiles.mutedUntil})`,
          suspended: sql<boolean>`bool_or(${profiles.suspendedAt} is not null)`,
        })
        .from(messagePosts)
        .leftJoin(profiles, eq(profiles.userId, messagePosts.authorId))
        .where(gte(messagePosts.removedAt, new Date(clock.getTime() - STRIKE_WINDOW_MS)))
        .groupBy(messagePosts.authorId)
        .having(sql`count(*) >= 3`);
      return c.json<OperatorReportQueue>({
        items,
        repeatOffenders: repeat.map((r) => ({
          userId: r.userId,
          displayName: r.displayName,
          removals: r.removals,
          mutedUntil: r.mutedUntil ? new Date(r.mutedUntil).toISOString() : null,
          suspended: !!r.suspended,
        })),
      });
    })
    .put(
      "/operator/users/:userId/suspension",
      auth,
      operator,
      userParam,
      body(suspensionSchema),
      async (c) => {
        const { userId } = c.req.valid("param");
        const { suspended, note } = c.req.valid("json");
        const clock = now();
        await db.transaction(async (tx) => {
          const [row] = await tx
            .update(profiles)
            .set({ suspendedAt: suspended ? sql`coalesce(${profiles.suspendedAt}, ${at(clock)})` : null })
            .where(eq(profiles.userId, userId))
            .returning({ id: profiles.userId });
          if (!row) fail(404, "Player not found.");
          await logAction(tx, {
            action: suspended ? "suspend" : "unsuspend",
            userId,
            actorId: c.var.user.id,
            note: note || null,
            createdAt: clock,
          });
        });
        return c.json({ suspended });
      },
    )
    .put("/operator/users/:userId/mute", auth, operator, userParam, body(muteSchema), async (c) => {
      const { userId } = c.req.valid("param");
      await db.transaction((tx) =>
        mute(tx, { userId, leagueId: null, duration: c.req.valid("json").duration, actorId: c.var.user.id }),
      );
      return c.json({ ok: true });
    });
}

/** Ids of the players in `ids` who are admins of `leagueId`. */
export async function adminsAmong(db: Store, leagueId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db
    .select({ id: leagueMembers.userId })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, leagueId),
        inArray(leagueMembers.userId, ids),
        eq(leagueMembers.role, "admin"),
        isNull(leagueMembers.removedAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
