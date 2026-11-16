import {
  type Db,
  leagueMembers,
  leagues,
  messageThreads,
  pushDeliveries,
  pushSubscriptions,
} from "@picks/db";
import type { PushPayload } from "@picks/shared";
import { and, asc, eq, inArray, isNull, lt, lte, ne } from "drizzle-orm";
import { logError } from "./logging";
import type { PushSender } from "./pushSender";
import { dueReminderTargets, reminderStillDue } from "./reminderTargets";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Store = Db | Tx;

/** Called inside the thread transaction: either both the post and notifications commit, or neither does. */
export async function queueThreadPush(
  db: Store,
  leagueId: string,
  threadId: string,
  authorId: string,
  at: Date,
) {
  const devices = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .innerJoin(
      leagueMembers,
      and(
        eq(leagueMembers.userId, pushSubscriptions.userId),
        eq(leagueMembers.leagueId, leagueId),
        isNull(leagueMembers.removedAt),
      ),
    )
    .where(and(ne(pushSubscriptions.userId, authorId), eq(pushSubscriptions.newThreads, true)));
  if (devices.length)
    await db
      .insert(pushDeliveries)
      .values(
        devices.map(({ id }) => ({
          subscriptionId: id,
          leagueId,
          threadId,
          kind: "new_thread" as const,
          eventKey: threadId,
          nextAttemptAt: at,
          expiresAt: new Date(at.getTime() + 24 * 60 * 60_000),
        })),
      )
      .onConflictDoNothing();
}

/** A reminder's event key: the week and the game day (`YYYY-MM-DD`, league time) it is for. */
const reminderKey = (weekId: string, date: string) => `${weekId}:${date}`;
const reminderDateOf = (eventKey: string) => eventKey.split(":")[1];

/**
 * Queues one reminder per device, week and game day, from 7pm league time the evening before (`dueReminderDay`),
 * for the players `dueReminderTargets` finds. One insert per week; a week that fails is logged and skipped.
 */
export async function queuePickPush(db: Db, at: Date) {
  const targets = await dueReminderTargets(db, at);
  if (!targets.length) return 0;
  const devices = await db
    .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(
      and(
        inArray(pushSubscriptions.userId, [
          ...new Set(targets.flatMap((t) => t.players.map((p) => p.userId))),
        ]),
        eq(pushSubscriptions.pickReminders, true),
      ),
    );
  let queued = 0;
  for (const { league, week, due, players } of targets) {
    const rows = players.flatMap(({ userId, missing }) =>
      devices
        .filter((d) => d.userId === userId)
        .map((d) => ({
          subscriptionId: d.id,
          leagueId: league.id,
          weekId: week.id,
          kind: "pick_reminder" as const,
          eventKey: reminderKey(week.id, due.date),
          gameIds: missing.map((g) => g.id),
          nextAttemptAt: at,
          expiresAt: due.expiresAt,
        })),
    );
    if (!rows.length) continue;
    try {
      const inserted = await db
        .insert(pushDeliveries)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: pushDeliveries.id });
      queued += inserted.length;
    } catch (error) {
      logError("push_queue", error);
    }
  }
  return queued;
}

const SENDERS = 5;
const SENDS_PER_SENDER = 20;
const MAX_ATTEMPTS = 5;
const FIRST_RETRY_MS = 5 * 60_000;
const RETENTION_MS = 30 * 24 * 60 * 60_000;

type Claim = {
  id: string;
  attempts: number;
  expiresAt: Date;
  device: typeof pushSubscriptions.$inferSelect;
  payload: PushPayload;
};

/**
 * Takes the next due delivery in one short transaction. A delivery worth sending is leased rather than held:
 * the attempt is counted and its next attempt pushed out by the retry backoff before the row lock is released,
 * so no other job picks it up while the send is in flight, and a crash mid-send becomes an ordinary retry.
 * Anything that no longer deserves a notification is marked skipped here.
 */
async function claimPush(db: Db, at: Date): Promise<Claim | "skipped" | null> {
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(pushDeliveries)
      .where(and(eq(pushDeliveries.status, "pending"), lte(pushDeliveries.nextAttemptAt, at)))
      .orderBy(asc(pushDeliveries.nextAttemptAt), asc(pushDeliveries.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!delivery) return null;
    const skip = async () => {
      await tx.update(pushDeliveries).set({ status: "skipped" }).where(eq(pushDeliveries.id, delivery.id));
      return "skipped" as const;
    };
    const [device] = await tx
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.id, delivery.subscriptionId));
    const [league] = device
      ? await tx
          .select({ name: leagues.name, timeZone: leagues.timeZone })
          .from(leagueMembers)
          .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
          .where(
            and(
              eq(leagueMembers.leagueId, delivery.leagueId),
              eq(leagueMembers.userId, device.userId),
              isNull(leagueMembers.removedAt),
            ),
          )
      : [];
    if (
      !device ||
      !league ||
      at >= delivery.expiresAt ||
      !(delivery.kind === "new_thread" ? device.newThreads : device.pickReminders)
    )
      return skip();
    let payload: PushPayload;
    if (delivery.kind === "new_thread") {
      const [thread] = delivery.threadId
        ? await tx
            .select({ title: messageThreads.title })
            .from(messageThreads)
            .where(eq(messageThreads.id, delivery.threadId))
        : [];
      if (!thread) return skip();
      payload = {
        title: "New league thread",
        body: `${league.name}: ${thread.title}`.slice(0, 180),
        url: `/leagues/${delivery.leagueId}/messages/${delivery.threadId}`,
        tag: delivery.id,
      };
    } else {
      const date = reminderDateOf(delivery.eventKey);
      const still =
        delivery.weekId && date
          ? await reminderStillDue(tx, { weekId: delivery.weekId, date, userId: device.userId }, at)
          : null;
      // Only the games it was queued for: a game added since gets its own reminder or none.
      const remaining = still?.missing.filter((g) => delivery.gameIds.includes(g.id)) ?? [];
      if (!remaining.length) return skip();
      payload = {
        title: "Make your picks",
        body: `${league.name}: ${remaining.length} ${remaining.length === 1 ? "game left" : "games left"} to pick before kickoff.`.slice(
          0,
          180,
        ),
        url: `/weeks/${delivery.weekId}`,
        tag: delivery.id,
      };
    }
    const attempts = delivery.attempts + 1;
    await tx
      .update(pushDeliveries)
      .set({ attempts, nextAttemptAt: new Date(at.getTime() + FIRST_RETRY_MS * 2 ** (attempts - 1)) })
      .where(eq(pushDeliveries.id, delivery.id));
    return { id: delivery.id, attempts, expiresAt: delivery.expiresAt, device, payload };
  });
}

/**
 * Sends what is due, a bounded batch per call. The send itself happens outside any transaction, so a slow push
 * service never holds a database connection. Delivery is at least once: a crash after the provider accepts a
 * message retries it, and the notification tag then replaces the duplicate on the device.
 */
export async function drainPush(db: Db, sender: PushSender, at: Date) {
  const counts = { sent: 0, skipped: 0, retrying: 0, failed: 0 };
  // Misconfigured keys (logged once by the sender): leave everything queued rather than fail it all.
  if (sender.ready && !(await sender.ready())) return counts;
  await db.delete(pushDeliveries).where(lt(pushDeliveries.createdAt, new Date(at.getTime() - RETENTION_MS)));
  const settle = (id: string, status: "sent" | "failed") =>
    db.update(pushDeliveries).set({ status }).where(eq(pushDeliveries.id, id));
  await Promise.all(
    Array.from({ length: SENDERS }, async () => {
      for (let i = 0; i < SENDS_PER_SENDER; i++) {
        const claim = await claimPush(db, at);
        if (!claim) break;
        if (claim === "skipped") {
          counts.skipped++;
          continue;
        }
        const result = await sender.send(
          claim.device,
          claim.payload,
          Math.max(1, Math.floor((claim.expiresAt.getTime() - at.getTime()) / 1000)),
        );
        if (result === "gone") {
          // The device unsubscribed: forget it, which also drops everything still queued for it.
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, claim.device.id));
          counts.skipped++;
        } else if (result === "retry" && claim.attempts < MAX_ATTEMPTS) {
          counts.retrying++;
        } else {
          const status = result === "sent" ? "sent" : "failed";
          // A failure here never removes the device. Only the push service saying the subscription is gone
          // (404/410, above) does: a 401/403 or an outage is as likely our side's fault (a bad VAPID subject, a
          // provider incident), and dropping devices for it would silently turn notifications off for everyone.
          await settle(claim.id, status);
          counts[status]++;
        }
      }
    }),
  );
  return counts;
}

/**
 * The scheduled push job: queue due reminders, then send. Queueing and sending fail separately, so a reminder
 * that can't be queued never holds up retries and thread notifications already waiting.
 */
export async function runPushJobs(db: Db, sender: PushSender, now: Date) {
  let queued = 0;
  try {
    queued = await queuePickPush(db, now);
  } catch (error) {
    logError("push_queue", error);
  }
  return { queued, ...(await drainPush(db, sender, now)) };
}
