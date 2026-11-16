import {
  type Db,
  emailOutbox,
  emailUsage,
  games,
  leagueMembers,
  leagues,
  type OutboxMessage,
  picks,
  profiles,
  seasons,
  weeks,
} from "@picks/db";
import { dueReminderDay, missingPicks } from "@picks/shared";
import { and, asc, eq, exists, gt, gte, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { type EmailKind, EmailSendError, type Mailer, unsubscribeToken } from "./email";
import { knownErrorCode, logError, logWarning } from "./logging";
import { newThreadEmail, pickReminderEmail } from "./templates";

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

function links(email: EmailDeps, userId: string, kind: EmailKind, action: { label: string; path: string }) {
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
  sql<boolean>`coalesce(${kind === "new_thread" ? profiles.emailNewThreads : profiles.emailPickReminders}, true)`;

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
        dedupeKey: `thread:${input.threadId}:${userId}`,
        // From the injected clock, not the database's, so a simulated date (tests, CLOCK_OVERRIDE) still sends.
        nextAttemptAt: input.now,
        expiresAt: new Date(input.now.getTime() + THREAD_EMAIL_TTL_MS),
        message: newThreadEmail({
          leagueName: input.leagueName,
          authorName: author?.name ?? "A player",
          title: input.title,
          body: input.body,
          links: links(email, userId, "new_thread", { label: "Read and reply", path }),
        }),
      })),
    )
    .onConflictDoNothing({ target: emailOutbox.dedupeKey });
  return recipients.length;
}

/**
 * Queues the evening-before reminder for every current member with games still to pick on the next game day.
 * Safe to run as often as you like: each player gets at most one reminder per week and game day.
 */
export async function queueReminders(db: Db, email: EmailDeps, now: Date): Promise<number> {
  // Only open weeks with a game in the next two days can have a reminder due.
  const soon = new Date(now.getTime() + 2 * 24 * 60 * 60_000);
  const candidates = await db
    .select({ week: weeks, league: leagues })
    .from(weeks)
    .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .where(
      and(
        eq(weeks.status, "open"),
        exists(
          db
            .select({ one: sql`1` })
            .from(games)
            .where(and(eq(games.weekId, weeks.id), gt(games.kickoff, now), lt(games.kickoff, soon))),
        ),
      ),
    );

  let queued = 0;
  for (const { week, league } of candidates) {
    const slate = await db.select().from(games).where(eq(games.weekId, week.id)).orderBy(asc(games.kickoff));
    const due = dueReminderDay(
      slate.map((g) => ({ ...g, final: g.homeScore !== null && g.awayScore !== null })),
      league.timeZone,
      now,
    );
    if (!due) continue;

    const members = await db
      .select({ userId: leagueMembers.userId, displayName: profiles.displayName })
      .from(leagueMembers)
      .leftJoin(profiles, eq(profiles.userId, leagueMembers.userId))
      .where(
        and(eq(leagueMembers.leagueId, league.id), isNull(leagueMembers.removedAt), wants("pick_reminder")),
      );
    if (!members.length) continue;
    const made = await db
      .select({ userId: picks.userId, gameId: picks.gameId })
      .from(picks)
      .where(
        and(
          eq(picks.weekId, week.id),
          inArray(
            picks.gameId,
            due.games.map((g) => g.id),
          ),
        ),
      );

    const rows = members.flatMap(({ userId, displayName }) => {
      const picked = new Set(made.filter((p) => p.userId === userId).map((p) => p.gameId));
      const missing = missingPicks(due.games, picked);
      if (!missing.length) return [];
      const message = pickReminderEmail({
        leagueName: league.name,
        displayName,
        weekNumber: week.number,
        timeZone: league.timeZone,
        games: missing,
        links: links(email, userId, "pick_reminder", { label: "Make your picks", path: `/weeks/${week.id}` }),
      });
      return [
        {
          userId,
          kind: "pick_reminder" as const,
          dedupeKey: `reminder:${week.id}:${due.date}:${userId}`,
          nextAttemptAt: now,
          expiresAt: due.expiresAt,
          message,
        },
      ];
    });
    if (!rows.length) continue;
    const inserted = await db
      .insert(emailOutbox)
      .values(rows)
      .onConflictDoNothing({ target: emailOutbox.dedupeKey })
      .returning({ id: emailOutbox.id });
    queued += inserted.length;
  }
  return queued;
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
async function exhaustToday(db: Db, limits: EmailDeps["limits"], now: Date) {
  await db
    .insert(emailUsage)
    .values({ day: utcDay(now), sent: limits.daily })
    .onConflictDoUpdate({
      target: emailUsage.day,
      set: { sent: sql`greatest(${emailUsage.sent}, ${limits.daily})` },
    });
}

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
  const queued = await queueReminders(db, email, now);
  return { queued, ...(await drainOutbox(db, email, now)) };
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

    for (const row of claimed) {
      if (outOfBudget) {
        await deferToTomorrow(db, row.id, now, "OVER_BUDGET");
        result.deferred++;
        continue;
      }
      const recipient = byUser.get(row.userId);
      const wanted = row.kind === "new_thread" ? recipient?.newThreads : recipient?.pickReminders;
      if (!recipient?.address || !wanted) {
        await finish(db, row.id, {
          status: "skipped",
          lastError: recipient?.address ? "OPTED_OUT" : "NO_ADDRESS",
        });
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
      const message = row.message as OutboxMessage;
      try {
        await email.mailer.send({ to: recipient.address, ...message });
        await finish(db, row.id, { status: "sent", sentAt: now, lastError: null });
        result.sent++;
      } catch (error) {
        logError("email_send", error);
        if (error instanceof EmailSendError && error.notSent) await releaseSend(db, now);
        if (error instanceof EmailSendError && error.quota) {
          // The provider's own quota is spent (e.g. Auth's emails used the headroom). Stop asking until tomorrow.
          outOfBudget = true;
          await exhaustToday(db, email.limits, now);
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
