import {
  type Db,
  emailOutbox,
  emailUsage,
  leagueMembers,
  messagePosts,
  messageThreads,
  type OutboxMessage,
  profiles,
  userBlocks,
} from "@picks/db";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notExists, or, sql } from "drizzle-orm";
import { type EmailKind, EmailSendError, type Mailer, unsubscribeToken } from "./email";
import { knownErrorCode, logError, logWarning } from "./logging";
import { dueReminders, type ReminderMessage, reminderStillApplies } from "./reminderTargets";
import { newThreadEmail, pickReminderEmail, reminderTextEmail } from "./templates";

export type EmailDeps = {
  mailer: Mailer;
  /** The public web origin links point at, e.g. `https://www.pow-pickem.com`. */
  appUrl: string;
  /** Signs unsubscribe links. */
  unsubscribeSecret: string;
  /** The most emails to hand the provider per UTC day and calendar month (see `EMAIL_DAILY_LIMIT`). */
  limits: { daily: number; monthly: number };
};

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const MAX_ATTEMPTS = 5;
/** Rows claimed at a time. Small, so a Worker cut off mid-drain (its `waitUntil` has a time limit) strands few. */
const BATCH = 20;
/** A claimed row whose send never finished (e.g. the process died) is tried again after this. */
const CLAIM_MS = 10 * 60_000;
const RETAIN_MS = 30 * 24 * 60 * 60_000;
const THREAD_EMAIL_TTL_MS = 24 * 60 * 60_000;

/** An email's button, its unsubscribe links (for this player and kind) and the settings link. */
export function notificationLinks(
  email: EmailDeps,
  userId: string,
  kind: EmailKind,
  action: { label: string; path: string },
) {
  const token = encodeURIComponent(unsubscribeToken(email.unsubscribeSecret, userId, kind));
  return {
    action: { label: action.label, url: `${email.appUrl}${action.path}` },
    unsubscribeUrl: `${email.appUrl}/unsubscribe?token=${token}`,
    listUnsubscribeUrl: `${email.appUrl}/api/unsubscribe?token=${token}`,
    settingsUrl: `${email.appUrl}/account`,
  };
}

/** Joins a member's notification switches; a player without a profile row gets the defaults (on). */
const wants = (kind: EmailKind) =>
  sql<boolean>`coalesce(${
    kind === "new_thread"
      ? profiles.emailNewThreads
      : kind === "pick_reminder"
        ? profiles.emailPickReminders
        : profiles.emailLeagueEvents
  }, true)`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dedupe keys name what an email is about, so the send-time recheck reads the thread, week or league from them:
 * `thread:<threadId>:<userId>`, `reminder:<weekId>:<YYYY-MM-DD>:<userId>` and
 * `league_event:<leagueId>:<userId>:<event>` (the event name may itself hold colons).
 */
export const threadEmailKey = (threadId: string, userId: string) => `thread:${threadId}:${userId}`;
export const reminderEmailKey = (weekId: string, date: string, userId: string) =>
  `reminder:${weekId}:${date}:${userId}`;
export const leagueEventEmailKey = (leagueId: string, userId: string, event: string) =>
  `league_event:${leagueId}:${userId}:${event}`;

export function parseDedupeKey(
  key: string,
):
  | { kind: "new_thread"; threadId: string; userId: string }
  | { kind: "pick_reminder"; weekId: string; date: string; userId: string }
  | { kind: "league_event"; leagueId: string; userId: string; event: string }
  | null {
  const parts = key.split(":");
  if (parts[0] === "league_event" && parts.length >= 4) {
    const [, leagueId = "", userId = "", ...event] = parts;
    return UUID.test(leagueId) && UUID.test(userId) && event.join(":")
      ? { kind: "league_event", leagueId, userId, event: event.join(":") }
      : null;
  }
  if (parts[0] === "thread" && parts.length === 3) {
    const [, threadId = "", userId = ""] = parts;
    return UUID.test(threadId) && UUID.test(userId) ? { kind: "new_thread", threadId, userId } : null;
  }
  if (parts[0] === "reminder" && parts.length === 4) {
    const [, weekId = "", date = "", userId = ""] = parts;
    return UUID.test(weekId) && UUID.test(userId) && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? { kind: "pick_reminder", weekId, date, userId }
      : null;
  }
  return null;
}

/** Queues a new-thread email for every other current member who wants one. Runs inside the thread's transaction. */
export async function queueThreadEmails(
  tx: Tx,
  email: EmailDeps,
  input: {
    leagueId: string;
    leagueName: string;
    threadId: string;
    authorId: string;
    title: string;
    body: string;
    now: Date;
  },
) {
  const [author] = await tx
    .select({ name: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.userId, input.authorId));
  const recipients = await tx
    .select({ userId: leagueMembers.userId })
    .from(leagueMembers)
    .leftJoin(profiles, eq(profiles.userId, leagueMembers.userId))
    .where(
      and(
        eq(leagueMembers.leagueId, input.leagueId),
        isNull(leagueMembers.removedAt),
        ne(leagueMembers.userId, input.authorId),
        wants("new_thread"),
        // Nobody hears about threads from a player they blocked.
        notExists(
          tx
            .select({ one: sql`1` })
            .from(userBlocks)
            .where(
              and(eq(userBlocks.blockerId, leagueMembers.userId), eq(userBlocks.blockedId, input.authorId)),
            ),
        ),
      ),
    );
  if (!recipients.length) return 0;
  const path = `/leagues/${input.leagueId}/messages/${input.threadId}`;
  await tx
    .insert(emailOutbox)
    .values(
      recipients.map(({ userId }) => ({
        userId,
        kind: "new_thread" as const,
        dedupeKey: threadEmailKey(input.threadId, userId),
        // From the injected clock, not the database's, so a simulated date (tests, CLOCK_OVERRIDE) still sends.
        nextAttemptAt: input.now,
        expiresAt: new Date(input.now.getTime() + THREAD_EMAIL_TTL_MS),
        message: newThreadEmail({
          leagueName: input.leagueName,
          authorName: author?.name ?? "A player",
          title: input.title,
          body: input.body,
          links: notificationLinks(email, userId, "new_thread", { label: "Read and reply", path }),
        }),
      })),
    )
    .onConflictDoNothing({ target: emailOutbox.dedupeKey });
  return recipients.length;
}

/**
 * Queues the evening-before reminder for every current member with something still to pick on the next game day,
 * in every league type (`dueReminders`). Safe to run as often as you like: each player gets at most one reminder
 * per week (or board) and game day.
 */
export async function queueReminders(db: Db, email: EmailDeps, now: Date): Promise<number> {
  const targets = await dueReminders(db, now);
  if (!targets.length) return 0;
  // Members without a profile row get the defaults: reminders on, no name.
  const people = await db
    .select({
      userId: profiles.userId,
      displayName: profiles.displayName,
      wanted: profiles.emailPickReminders,
    })
    .from(profiles)
    .where(inArray(profiles.userId, [...new Set(targets.flatMap((t) => t.players.map((p) => p.userId)))]));
  const byUser = new Map(people.map((p) => [p.userId, p]));

  let queued = 0;
  for (const { league, subjectId, date, expiresAt, players } of targets) {
    // One week that can't be rendered or stored mustn't stop the others.
    try {
      const rows = players
        .filter(({ userId }) => byUser.get(userId)?.wanted ?? true)
        .map(({ userId, message }) => ({
          userId,
          kind: "pick_reminder" as const,
          dedupeKey: reminderEmailKey(subjectId, date, userId),
          nextAttemptAt: now,
          expiresAt,
          message: reminderMessage(email, {
            userId,
            displayName: byUser.get(userId)?.displayName ?? null,
            league,
            message,
          }),
        }));
      if (!rows.length) continue;
      const inserted = await db
        .insert(emailOutbox)
        .values(rows)
        .onConflictDoNothing({ target: emailOutbox.dedupeKey })
        .returning({ id: emailOutbox.id });
      queued += inserted.length;
    } catch (error) {
      logError("email_queue", error);
    }
  }
  return queued;
}

function reminderMessage(
  email: EmailDeps,
  input: {
    userId: string;
    displayName: string | null;
    league: { name: string; timeZone: string };
    message: ReminderMessage;
  },
) {
  const { message } = input;
  if (message.kind === "text") {
    return reminderTextEmail({
      leagueName: input.league.name,
      heading: message.heading,
      intro: message.intro,
      links: notificationLinks(email, input.userId, "pick_reminder", {
        label: message.actionLabel,
        path: message.path,
      }),
    });
  }
  return pickReminderEmail({
    leagueName: input.league.name,
    displayName: input.displayName,
    weekNumber: message.weekNumber,
    timeZone: input.league.timeZone,
    games: message.games,
    links: notificationLinks(email, input.userId, "pick_reminder", {
      label: "Make your picks",
      path: `/weeks/${message.weekId}`,
    }),
  });
}

// ---------- Budget ----------

const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const nextUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));

/**
 * Takes one send from today's budget, or returns false when the daily or monthly limit is reached.
 * Atomic: the row lock on today's counter serializes concurrent drains, and earlier days can't change.
 */
export async function reserveSend(db: Db, limits: EmailDeps["limits"], now: Date): Promise<boolean> {
  const day = utcDay(now);
  const monthStart = `${day.slice(0, 7)}-01`;
  const [earlier] = await db
    .select({ sent: sql<number>`coalesce(sum(${emailUsage.sent}), 0)::int` })
    .from(emailUsage)
    .where(and(gte(emailUsage.day, monthStart), lt(emailUsage.day, day)));
  const cap = Math.min(limits.daily, limits.monthly - (earlier?.sent ?? 0));
  if (cap <= 0) return false;
  await db.insert(emailUsage).values({ day, sent: 0 }).onConflictDoNothing();
  const reserved = await db
    .update(emailUsage)
    .set({ sent: sql`${emailUsage.sent} + 1` })
    .where(and(eq(emailUsage.day, day), lt(emailUsage.sent, cap)))
    .returning({ sent: emailUsage.sent });
  return reserved.length > 0;
}

/** Gives back a reserved send the provider said it didn't make. */
async function releaseSend(db: Db, now: Date) {
  await db
    .update(emailUsage)
    .set({ sent: sql`greatest(${emailUsage.sent} - 1, 0)` })
    .where(eq(emailUsage.day, utcDay(now)));
}

/** The provider says its quota is used up: spend the rest of today's budget so no drain asks again today. */
export type DrainResult = {
  sent: number;
  failed: number;
  skipped: number;
  retrying: number;
  /** Held until tomorrow because the budget (ours or the provider's) ran out. */
  deferred: number;
};

export type JobResult = DrainResult & { queued: number };

/**
 * The scheduled email job: queues any pick reminders that are due, then sends everything waiting in the outbox.
 * Production runs it from the Worker's Cron Trigger (wrangler.jsonc), local development on a timer
 * (src/index.ts). Idempotent, so overlapping or repeated runs never send twice.
 */
export async function runEmailJobs(db: Db, email: EmailDeps, now: Date): Promise<JobResult> {
  // Queueing and sending fail separately: a reminder that can't be queued never holds up retries and thread
  // emails already waiting.
  let queued = 0;
  try {
    queued = await queueReminders(db, email, now);
  } catch (error) {
    logError("email_queue", error);
  }
  return { queued, ...(await drainOutbox(db, email, now)) };
}

type ClaimedRow = typeof emailOutbox.$inferSelect;

/**
 * Rechecks claimed rows just before sending, as push does: a thread email only while its recipient is still a
 * current member of the thread's league, hasn't blocked its author since, and the thread's opening message hasn't
 * been hidden or removed; a league event only while its recipient is still a current member of the league; a
 * reminder only while it is still due (`reminderStillDue`), re-rendered with the games still to pick. The
 * operator's moderation emails go as they are. Returns the message to send, or the reason the row is skipped.
 */
async function stillWorthSending(
  db: Db,
  email: EmailDeps,
  claimed: ClaimedRow[],
  displayNames: Map<string, string | null>,
  now: Date,
): Promise<Map<string, OutboxMessage | "NOT_A_MEMBER" | "NO_LONGER_DUE">> {
  const keys = new Map(claimed.map((row) => [row.id, parseDedupeKey(row.dedupeKey)]));
  const threads = claimed.flatMap((row) => {
    const key = keys.get(row.id);
    return key?.kind === "new_thread" && row.kind === "new_thread" && key.userId === row.userId ? [key] : [];
  });
  const members = threads.length
    ? await db
        .select({ threadId: messageThreads.id, userId: leagueMembers.userId })
        .from(messageThreads)
        .innerJoin(
          leagueMembers,
          and(eq(leagueMembers.leagueId, messageThreads.leagueId), isNull(leagueMembers.removedAt)),
        )
        .where(
          and(
            inArray(messageThreads.id, [...new Set(threads.map((t) => t.threadId))]),
            inArray(leagueMembers.userId, [...new Set(threads.map((t) => t.userId))]),
            notExists(
              db
                .select({ one: sql`1` })
                .from(messagePosts)
                .where(
                  and(
                    eq(messagePosts.threadId, messageThreads.id),
                    eq(messagePosts.position, 1),
                    or(isNotNull(messagePosts.hiddenAt), isNotNull(messagePosts.removedAt)),
                  ),
                ),
            ),
            notExists(
              db
                .select({ one: sql`1` })
                .from(userBlocks)
                .where(
                  and(
                    eq(userBlocks.blockerId, leagueMembers.userId),
                    eq(userBlocks.blockedId, messageThreads.authorId),
                  ),
                ),
            ),
          ),
        )
    : [];
  const current = new Set(members.map((m) => `${m.threadId}:${m.userId}`));
  // League events: the recipient must still be a current member of the event's league.
  const events = claimed.flatMap((row) => {
    const key = keys.get(row.id);
    return key?.kind === "league_event" && row.kind === "league_event" && key.userId === row.userId
      ? [key]
      : [];
  });
  const eventMembers = events.length
    ? await db
        .select({ leagueId: leagueMembers.leagueId, userId: leagueMembers.userId })
        .from(leagueMembers)
        .where(
          and(
            inArray(leagueMembers.leagueId, [...new Set(events.map((e) => e.leagueId))]),
            inArray(leagueMembers.userId, [...new Set(events.map((e) => e.userId))]),
            isNull(leagueMembers.removedAt),
          ),
        )
    : [];
  const inLeague = new Set(eventMembers.map((m) => `${m.leagueId}:${m.userId}`));

  const result = new Map<string, OutboxMessage | "NOT_A_MEMBER" | "NO_LONGER_DUE">();
  for (const row of claimed) {
    const key = keys.get(row.id);
    if (row.kind === "moderation") {
      result.set(row.id, row.message as OutboxMessage);
      continue;
    }
    if (row.kind === "new_thread") {
      const ok = key?.kind === "new_thread" && current.has(`${key.threadId}:${row.userId}`);
      result.set(row.id, ok ? (row.message as OutboxMessage) : "NOT_A_MEMBER");
      continue;
    }
    if (row.kind === "league_event") {
      const ok = key?.kind === "league_event" && inLeague.has(`${key.leagueId}:${row.userId}`);
      result.set(row.id, ok ? (row.message as OutboxMessage) : "NOT_A_MEMBER");
      continue;
    }
    let still: Awaited<ReturnType<typeof reminderStillApplies>> = null;
    try {
      still =
        key?.kind === "pick_reminder" && key.userId === row.userId
          ? await reminderStillApplies(db, { subjectId: key.weekId, date: key.date, userId: row.userId }, now)
          : null;
    } catch (error) {
      // The recheck is a refinement. If it can't run for this row, send what was queued rather than leave the
      // whole claimed batch unsent behind it.
      logError("reminder_targets", error);
      result.set(row.id, row.message as OutboxMessage);
      continue;
    }
    result.set(
      row.id,
      still
        ? reminderMessage(email, {
            userId: row.userId,
            displayName: displayNames.get(row.userId) ?? null,
            league: still.league,
            message: still.message,
          })
        : "NO_LONGER_DUE",
    );
  }
  return result;
}

/** Sends what's due in the outbox. Concurrent drains never send the same row twice (rows are claimed). */
export async function drainOutbox(db: Db, email: EmailDeps, now: Date): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, failed: 0, skipped: 0, retrying: 0, deferred: 0 };
  const expired = await db
    .update(emailOutbox)
    // Keep "held for budget" visible: those expired because the budget ran out, not for being slow.
    .set({
      status: "skipped",
      lastError: sql`case when ${emailOutbox.lastError} = 'OVER_BUDGET' then 'OVER_BUDGET' else 'EXPIRED' end`,
    })
    .where(and(inArray(emailOutbox.status, ["pending", "sending"]), lte(emailOutbox.expiresAt, now)))
    .returning({ id: emailOutbox.id });
  result.skipped += expired.length;

  let outOfBudget = false;
  for (;;) {
    const claimed = await db.transaction(async (tx) => {
      const due = await tx
        .select({ id: emailOutbox.id })
        .from(emailOutbox)
        .where(
          and(
            or(eq(emailOutbox.status, "pending"), eq(emailOutbox.status, "sending")),
            lte(emailOutbox.nextAttemptAt, now),
          ),
        )
        .orderBy(asc(emailOutbox.createdAt))
        .limit(BATCH)
        .for("update", { skipLocked: true });
      if (!due.length) return [];
      return tx
        .update(emailOutbox)
        .set({
          status: "sending",
          attempts: sql`${emailOutbox.attempts} + 1`,
          nextAttemptAt: new Date(now.getTime() + CLAIM_MS),
        })
        .where(
          inArray(
            emailOutbox.id,
            due.map((d) => d.id),
          ),
        )
        .returning();
    });
    if (!claimed.length) break;

    // Look addresses and switches up now, not when queued: a player may have changed either since.
    const recipients = await db
      .select({
        userId: sql<string>`u.id`,
        address: sql<string | null>`u.email`,
        newThreads: wants("new_thread"),
        pickReminders: wants("pick_reminder"),
        leagueEvents: wants("league_event"),
        displayName: profiles.displayName,
      })
      .from(sql`auth.users u`)
      .leftJoin(profiles, sql`${profiles.userId} = u.id`)
      .where(
        sql`u.id in (${sql.join(
          [...new Set(claimed.map((r) => r.userId))].map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
    const byUser = new Map(recipients.map((r) => [r.userId, r]));
    // Membership and missing picks are rechecked now too, since the row may have waited (retries, budget).
    const current = await stillWorthSending(
      db,
      email,
      claimed,
      new Map(recipients.map((r) => [r.userId, r.displayName])),
      now,
    );

    for (const row of claimed) {
      if (outOfBudget) {
        await deferToTomorrow(db, row.id, now, "OVER_BUDGET");
        result.deferred++;
        continue;
      }
      const recipient = byUser.get(row.userId);
      // Moderation emails go only to operators, who can't switch them off.
      const wanted =
        row.kind === "moderation"
          ? true
          : row.kind === "new_thread"
            ? recipient?.newThreads
            : row.kind === "pick_reminder"
              ? recipient?.pickReminders
              : recipient?.leagueEvents;
      if (!recipient?.address || !wanted) {
        await finish(db, row.id, {
          status: "skipped",
          lastError: recipient?.address ? "OPTED_OUT" : "NO_ADDRESS",
        });
        result.skipped++;
        continue;
      }
      const message = current.get(row.id);
      if (typeof message !== "object") {
        await finish(db, row.id, { status: "skipped", lastError: message ?? "NO_LONGER_DUE" });
        result.skipped++;
        continue;
      }
      if (!(await reserveSend(db, email.limits, now))) {
        outOfBudget = true;
        logWarning("email_budget_reached");
        await deferToTomorrow(db, row.id, now, "OVER_BUDGET");
        result.deferred++;
        continue;
      }
      try {
        await email.mailer.send({ to: recipient.address, ...message });
        await finish(db, row.id, { status: "sent", sentAt: now, lastError: null });
        result.sent++;
      } catch (error) {
        logError("email_send", error);
        if (error instanceof EmailSendError && error.notSent) await releaseSend(db, now);
        if (error instanceof EmailSendError && error.quota) {
          // The provider's own quota is spent (e.g. Auth's emails used the headroom). Everything due now waits
          // for tomorrow. Our own count stays what was really sent (the slot was given back above): closing the
          // day by writing the daily limit into it would charge up to a full day against the monthly budget
          // each time. An email that comes due later today asks the provider once more and waits in turn.
          outOfBudget = true;
          await deferToTomorrow(db, row.id, now, error.code);
          result.deferred++;
          continue;
        }
        const code = knownErrorCode(error);
        const permanent = error instanceof EmailSendError && error.permanent;
        if (permanent || row.attempts >= MAX_ATTEMPTS) {
          await finish(db, row.id, { status: "failed", lastError: code });
          result.failed++;
        } else {
          // 5, 10, 20, 40 minutes.
          const delay = 5 * 60_000 * 2 ** (row.attempts - 1);
          await finish(db, row.id, {
            status: "pending",
            lastError: code,
            nextAttemptAt: new Date(now.getTime() + delay),
          });
          result.retrying++;
        }
      }
    }
    if (outOfBudget || claimed.length < BATCH) break;
  }

  await db
    .delete(emailOutbox)
    .where(
      and(
        inArray(emailOutbox.status, ["sent", "failed", "skipped"]),
        lt(emailOutbox.createdAt, new Date(now.getTime() - RETAIN_MS)),
      ),
    );
  // Usage history only matters for the current month's total; keep a few months for reference.
  await db
    .delete(emailUsage)
    .where(lt(emailUsage.day, utcDay(new Date(now.getTime() - 100 * 24 * 60 * 60_000))));
  return result;
}

/** Back in the queue at the next UTC day, without using up one of its attempts. */
function deferToTomorrow(db: Db, id: string, now: Date, reason: string) {
  return db
    .update(emailOutbox)
    .set({
      status: "pending",
      attempts: sql`${emailOutbox.attempts} - 1`,
      lastError: reason,
      nextAttemptAt: nextUtcDay(now),
    })
    .where(eq(emailOutbox.id, id));
}

function finish(db: Db, id: string, set: Partial<typeof emailOutbox.$inferInsert>) {
  return db.update(emailOutbox).set(set).where(eq(emailOutbox.id, id));
}
