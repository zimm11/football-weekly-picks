import {
  type Db,
  games,
  leagueMembers,
  leagues,
  messageThreads,
  picks,
  pushDeliveries,
  pushSubscriptions,
  seasons,
  weeks,
} from "@picks/db";
import { dueReminderDay, missingPicks, type PushPayload } from "@picks/shared";
import { and, asc, eq, isNull, lt, lte, ne } from "drizzle-orm";
import type { PushSender } from "./pushSender";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Store = Db | Tx;

/** A week's games in the shape the lock rules read. */
async function slateOf(db: Store, weekId: string) {
  const slate = await db.select().from(games).where(eq(games.weekId, weekId));
  return slate.map((g) => ({ ...g, final: g.homeScore !== null || g.awayScore !== null }));
}

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

/** Queues one reminder per device, week and game day, from 7pm league time the evening before (`dueReminderDay`). */
export async function queuePickPush(db: Db, at: Date) {
  let queued = 0;
  const openWeeks = await db
    .select({ week: weeks, league: leagues })
    .from(weeks)
    .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .where(eq(weeks.status, "open"));
  for (const { week, league } of openWeeks) {
    const due = dueReminderDay(await slateOf(db, week.id), league.timeZone, at);
    if (!due) continue;
    const devices = await db
      .select({ device: pushSubscriptions })
      .from(pushSubscriptions)
      .innerJoin(
        leagueMembers,
        and(
          eq(leagueMembers.userId, pushSubscriptions.userId),
          eq(leagueMembers.leagueId, league.id),
          isNull(leagueMembers.removedAt),
        ),
      )
      .where(eq(pushSubscriptions.pickReminders, true));
    const saved = await db
      .select({ userId: picks.userId, gameId: picks.gameId })
      .from(picks)
      .where(eq(picks.weekId, week.id));
    for (const { device } of devices) {
      const missing = missingPicks(
        due.games,
        new Set(saved.filter((p) => p.userId === device.userId).map((p) => p.gameId)),
      );
      if (!missing.length) continue;
      const inserted = await db
        .insert(pushDeliveries)
        .values({
          subscriptionId: device.id,
          leagueId: league.id,
          weekId: week.id,
          kind: "pick_reminder",
          eventKey: `${week.id}:${due.date}`,
          gameIds: missing.map((g) => g.id),
          nextAttemptAt: at,
          expiresAt: due.expiresAt,
        })
        .onConflictDoNothing()
        .returning({ id: pushDeliveries.id });
      queued += inserted.length;
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
      const [week] = delivery.weekId
        ? await tx
            .select({ id: weeks.id, status: weeks.status })
            .from(weeks)
            .where(eq(weeks.id, delivery.weekId))
        : [];
      if (week?.status !== "open") return skip();
      const due = dueReminderDay(await slateOf(tx, week.id), league.timeZone, at);
      const saved = await tx
        .select({ gameId: picks.gameId })
        .from(picks)
        .where(and(eq(picks.weekId, week.id), eq(picks.userId, device.userId)));
      const remaining = missingPicks(
        due?.games.filter((g) => delivery.gameIds.includes(g.id)) ?? [],
        new Set(saved.map((p) => p.gameId)),
      );
      if (!remaining.length) return skip();
      payload = {
        title: "Make your picks",
        body: `${league.name}: ${remaining.length} ${remaining.length === 1 ? "game left" : "games left"} to pick before kickoff.`.slice(
          0,
          180,
        ),
        url: `/weeks/${week.id}`,
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
          await settle(claim.id, status);
          counts[status]++;
        }
      }
    }),
  );
  return counts;
}
