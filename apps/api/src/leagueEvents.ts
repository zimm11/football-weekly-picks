// League events: one notification kind (`league_event`) for results and updates in a league, such as a week
// opening or final in a league that runs itself, the numbers drawn on a squares board, or being added to a league
// with its creator's members. They go through the email outbox and the push queue like the other kinds, sent
// after the request commits, and are rechecked just before sending (still a current member, the switch still on;
// see `stillWorthSending` in outbox.ts and `claimPush` in pushQueue.ts).

import { emailOutbox, leagueMembers, leagues, profiles, pushDeliveries, pushSubscriptions } from "@picks/db";
import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { AppDeps, Store } from "./context";
import { logError } from "./logging";
import { drainOutbox, type EmailDeps, leagueEventEmailKey, notificationLinks } from "./outbox";
import { drainPush } from "./pushQueue";
import { leagueEventEmail } from "./templates";

/** How long a league event is worth sending, unless the event says otherwise. */
const LEAGUE_EVENT_TTL_MS = 24 * 60 * 60_000;

/** An event name: letters, digits and `:`, `-`, `_`, e.g. `week-final:<weekId>:<finalizedAt ms>`. */
const EVENT_NAME = /^[A-Za-z0-9:_-]{1,160}$/;

export type LeagueEvent = {
  leagueId: string;
  /**
   * Names the event within the league. With the player, it is the dedupe key, so running the same step twice
   * queues nothing twice. Include whatever makes a repeat a new event (a week finalized again after a reopen
   * should carry its new `finalizedAt`).
   */
  event: string;
  /**
   * A short line, the push body and the email's heading and subject (after the league's name): "Week 7 is final".
   * Never a pick, a team, a square, or whether the reader is in or out.
   */
  headline: string;
  /** A sentence for the email body. Defaults to "<headline> in <league>." Same rule as the headline. */
  detail?: string;
  /** The app path the notification opens, e.g. `/weeks/<id>`. */
  path: string;
  /** The email button's label. */
  actionLabel?: string;
  /** Who to notify, if not every current member. Removed members are never notified. */
  userIds?: string[];
  /** Current members not to notify, e.g. the admin who made the change. */
  exceptUserIds?: string[];
  /** Push only, no email: for frequent events (a squares quarter result) that would spend the email budget. */
  pushOnly?: boolean;
  /** What the event is about, so deleting it clears its queued push notifications. */
  weekId?: string | null;
  boardId?: string | null;
  /** After this it isn't worth sending. Defaults to a day after `now`. */
  expiresAt?: Date;
};

export type LeagueEventDeps = Pick<AppDeps, "email" | "push" | "nativePush">;

/**
 * Queues one league event for its players: an email to those whose email switch is on (unless `pushOnly`), and a
 * push notification to each of their devices with the switch on. Call it inside the transaction that made the
 * change, so the notification commits with it, then `deliverLeagueEventsSoon` after commit. Idempotent: the same
 * event for the same player is queued once (email dedupe key, push event key).
 */
export async function queueLeagueEvent(
  db: Store,
  deps: LeagueEventDeps,
  input: LeagueEvent,
  now: Date,
): Promise<{ emails: number; pushes: number }> {
  if (!EVENT_NAME.test(input.event)) throw new Error("Invalid league event name");
  if (input.userIds?.length === 0) return { emails: 0, pushes: 0 };
  const [league] = await db
    .select({ name: leagues.name })
    .from(leagues)
    .where(eq(leagues.id, input.leagueId));
  if (!league) return { emails: 0, pushes: 0 };
  const members = and(
    eq(leagueMembers.leagueId, input.leagueId),
    isNull(leagueMembers.removedAt),
    input.userIds ? inArray(leagueMembers.userId, input.userIds) : undefined,
    input.exceptUserIds?.length ? notInArray(leagueMembers.userId, input.exceptUserIds) : undefined,
  );
  const expiresAt = input.expiresAt ?? new Date(now.getTime() + LEAGUE_EVENT_TTL_MS);
  let emails = 0;
  let pushes = 0;

  if (deps.email && !input.pushOnly) {
    const email: EmailDeps = deps.email;
    const recipients = await db
      .select({ userId: leagueMembers.userId })
      .from(leagueMembers)
      .leftJoin(profiles, eq(profiles.userId, leagueMembers.userId))
      .where(and(members, sql`coalesce(${profiles.emailLeagueEvents}, true)`));
    if (recipients.length) {
      const inserted = await db
        .insert(emailOutbox)
        .values(
          recipients.map(({ userId }) => ({
            userId,
            kind: "league_event" as const,
            dedupeKey: leagueEventEmailKey(input.leagueId, userId, input.event),
            nextAttemptAt: now,
            expiresAt,
            message: leagueEventEmail({
              leagueName: league.name,
              headline: input.headline,
              detail: input.detail,
              links: notificationLinks(email, userId, "league_event", {
                label: input.actionLabel ?? "Open the league",
                path: input.path,
              }),
            }),
          })),
        )
        .onConflictDoNothing({ target: emailOutbox.dedupeKey })
        .returning({ id: emailOutbox.id });
      emails = inserted.length;
    }
  }

  if (deps.push || deps.nativePush) {
    const devices = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .innerJoin(leagueMembers, eq(leagueMembers.userId, pushSubscriptions.userId))
      .where(and(members, eq(pushSubscriptions.leagueEvents, true)));
    if (devices.length) {
      const inserted = await db
        .insert(pushDeliveries)
        .values(
          devices.map(({ id }) => ({
            subscriptionId: id,
            leagueId: input.leagueId,
            weekId: input.weekId ?? null,
            boardId: input.boardId ?? null,
            kind: "league_event" as const,
            eventKey: `${input.leagueId}:${input.event}`,
            payload: { title: league.name, body: input.headline, url: input.path },
            nextAttemptAt: now,
            expiresAt,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: pushDeliveries.id });
      pushes = inserted.length;
    }
  }
  return { emails, pushes };
}

/**
 * Starts sending what league events queued, after the request's transaction has committed. The Cron Trigger
 * retries whatever this misses.
 */
export function deliverLeagueEventsSoon(
  deps: Pick<AppDeps, "db" | "email" | "push" | "nativePush" | "background">,
  queued: { emails: number; pushes: number },
  now: Date,
) {
  const { db, email, push, nativePush, background = (task) => void task() } = deps;
  if (email && queued.emails) {
    background(() => drainOutbox(db, email, now).catch((err) => logError("email_jobs", err)));
  }
  if ((push || nativePush) && queued.pushes) {
    background(() => drainPush(db, push, now, nativePush).catch((err) => logError("push_delivery", err)));
  }
}
