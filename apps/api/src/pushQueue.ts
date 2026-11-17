import {
  type Db,
  leagueMembers,
  leagues,
  messagePosts,
  messageThreads,
  pushDeliveries,
  pushSubscriptions,
  userBlocks,
} from "@picks/db";
import type { PushPayload } from "@picks/shared";
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, ne, notExists, or, sql } from "drizzle-orm";
import { logError } from "./logging";
import type { PushSender } from "./pushSender";
import { dueReminders, reminderStillApplies } from "./reminderTargets";

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
    .where(
      and(
        ne(pushSubscriptions.userId, authorId),
        eq(pushSubscriptions.newThreads, true),
        // Nobody hears about threads from a player they blocked.
        notExists(
          db
            .select({ one: sql`1` })
            .from(userBlocks)
            .where(
              and(eq(userBlocks.blockerId, pushSubscriptions.userId), eq(userBlocks.blockedId, authorId)),
            ),
        ),
      ),
    );
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
 * Queues one reminder per device, week (or board) and game day, from 7pm league time the evening before
 * (`dueReminderDay`), for the players `dueReminders` finds in every league type. One insert per week; a week
 * that fails is logged and skipped.
 */
export async function queuePickPush(db: Db, at: Date) {
  const targets = await dueReminders(db, at);
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
  for (const { league, subjectId, weekId, boardId, date, expiresAt, players } of targets) {
    const rows = players.flatMap(({ userId, gameIds }) =>
      devices
        .filter((d) => d.userId === userId)
        .map((d) => ({
          subscriptionId: d.id,
          leagueId: league.id,
          weekId,
          boardId,
          kind: "pick_reminder" as const,
          eventKey: reminderKey(subjectId, date),
          gameIds,
          nextAttemptAt: at,
          expiresAt,
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
  nativeReceiptId: string | null;
};

/**
 * Takes the next due delivery in one short transaction. A delivery worth sending is leased rather than held:
 * the attempt is counted and its next attempt pushed out by the retry backoff before the row lock is released,
 * so no other job picks it up while the send is in flight, and a crash mid-send becomes an ordinary retry.
 * Anything that no longer deserves a notification is marked skipped here.
 */
async function claimPush(
  db: Db,
  at: Date,
  transports: ("web" | "expo")[],
): Promise<Claim | "skipped" | null> {
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select()
      .from(pushDeliveries)
      .where(
        and(
          eq(pushDeliveries.status, "pending"),
          lte(pushDeliveries.nextAttemptAt, at),
          inArray(
            pushDeliveries.subscriptionId,
            tx
              .select({ id: pushSubscriptions.id })
              .from(pushSubscriptions)
              .where(inArray(pushSubscriptions.transport, transports)),
          ),
        ),
      )
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
    const wanted =
      delivery.kind === "new_thread"
        ? device?.newThreads
        : delivery.kind === "pick_reminder"
          ? device?.pickReminders
          : device?.leagueEvents;
    if (!device || !league || at >= delivery.expiresAt || !wanted) return skip();
    let payload: PushPayload;
    if (delivery.kind === "league_event") {
      // Rendered when queued (`queueLeagueEvent`): the league's name and the event, never a pick or a status.
      if (!delivery.payload) return skip();
      payload = {
        title: delivery.payload.title.slice(0, 80),
        body: delivery.payload.body.slice(0, 180),
        url: delivery.payload.url,
        tag: delivery.id,
      };
    } else if (delivery.kind === "new_thread") {
      // Rechecked now: the opening message may have been hidden or removed, or its author blocked, since.
      const [thread] = delivery.threadId
        ? await tx
            .select({ title: messageThreads.title })
            .from(messageThreads)
            .where(
              and(
                eq(messageThreads.id, delivery.threadId),
                notExists(
                  tx
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
                  tx
                    .select({ one: sql`1` })
                    .from(userBlocks)
                    .where(
                      and(
                        eq(userBlocks.blockerId, device.userId),
                        eq(userBlocks.blockedId, messageThreads.authorId),
                      ),
                    ),
                ),
              ),
            )
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
      const subjectId = delivery.weekId ?? delivery.boardId;
      const still =
        subjectId && date
          ? await reminderStillApplies(tx, { subjectId, date, userId: device.userId }, at)
          : null;
      if (!still) return skip();
      if (still.message.kind === "text") {
        payload = {
          // The type's own words ("Claim your squares", "Make your Week 5 pick"), not weekly pick'em's.
          title: still.message.heading.slice(0, 80),
          body: `${league.name}: ${still.message.pushBody}`.slice(0, 180),
          url: still.message.path,
          tag: delivery.id,
        };
      } else {
        // Only the games it was queued for: a game added since gets its own reminder or none.
        const remaining = still.gameIds.filter((id) => delivery.gameIds.includes(id));
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
    }
    const attempts = delivery.attempts + 1;
    await tx
      .update(pushDeliveries)
      .set({ attempts, nextAttemptAt: new Date(at.getTime() + FIRST_RETRY_MS * 2 ** (attempts - 1)) })
      .where(eq(pushDeliveries.id, delivery.id));
    return {
      id: delivery.id,
      attempts,
      expiresAt: delivery.expiresAt,
      device,
      payload,
      nativeReceiptId: delivery.nativeReceiptId,
    };
  });
}

/**
 * Sends what is due, a bounded batch per call. The send itself happens outside any transaction, so a slow push
 * service never holds a database connection. Delivery is at least once: a crash after the provider accepts a
 * message retries it, and the notification tag then replaces the duplicate on the device.
 */
export async function drainPush(db: Db, sender: PushSender | undefined, at: Date, nativeSender?: PushSender) {
  const counts = { sent: 0, skipped: 0, retrying: 0, failed: 0 };
  // Misconfigured keys (logged once by the sender): leave everything queued rather than fail it all.
  const transports: ("web" | "expo")[] = [];
  if (sender && (!sender.ready || (await sender.ready()))) transports.push("web");
  if (nativeSender && (!nativeSender.ready || (await nativeSender.ready()))) transports.push("expo");
  if (!transports.length) return counts;
  await db.delete(pushDeliveries).where(lt(pushDeliveries.createdAt, new Date(at.getTime() - RETENTION_MS)));
  const settle = (id: string, status: "sent" | "failed") =>
    db.update(pushDeliveries).set({ status }).where(eq(pushDeliveries.id, id));
  await Promise.all(
    Array.from({ length: SENDERS }, async () => {
      for (let i = 0; i < SENDS_PER_SENDER; i++) {
        const claim = await claimPush(db, at, transports);
        if (!claim) break;
        if (claim === "skipped") {
          counts.skipped++;
          continue;
        }
        const transport = claim.device.transport === "expo" ? nativeSender : sender;
        // Only configured transports were leased above.
        if (!transport) continue;
        const result = claim.nativeReceiptId
          ? ((await transport.receipt?.(claim.nativeReceiptId)) ?? "failed")
          : await transport.send(
              claim.device,
              claim.payload,
              Math.max(1, Math.floor((claim.expiresAt.getTime() - at.getTime()) / 1000)),
            );
        if (typeof result === "object") {
          await db
            .update(pushDeliveries)
            .set({ nativeReceiptId: result.receiptId, nextAttemptAt: new Date(at.getTime() + 15 * 60_000) })
            .where(eq(pushDeliveries.id, claim.id));
          counts.retrying++;
          continue;
        }
        if (result === "resend") {
          await db
            .update(pushDeliveries)
            .set({ nativeReceiptId: null })
            .where(eq(pushDeliveries.id, claim.id));
        }
        if (result === "gone") {
          // The device unsubscribed: forget it, which also drops everything still queued for it.
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, claim.device.id));
          counts.skipped++;
        } else if ((result === "retry" || result === "resend") && claim.attempts < MAX_ATTEMPTS) {
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
export async function runPushJobs(
  db: Db,
  sender: PushSender | undefined,
  now: Date,
  nativeSender?: PushSender,
) {
  let queued = 0;
  try {
    queued = await queuePickPush(db, now);
  } catch (error) {
    logError("push_queue", error);
  }
  return { queued, ...(await drainPush(db, sender, now, nativeSender)) };
}
