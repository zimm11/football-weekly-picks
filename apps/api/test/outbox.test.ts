import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDb,
  emailOutbox,
  emailUsage,
  games,
  leagueMembers,
  leagues,
  messageThreads,
  picks,
  seasons,
  weeks,
} from "@picks/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OutgoingEmail } from "../src/email";
import { drainOutbox, type EmailDeps, queueReminders, threadEmailKey } from "../src/outbox";

const author = randomUUID(),
  player = randomUUID(),
  other = randomUUID();
const users = [author, player, other];
const addressOf = (id: string) => `${id}@outbox.test`;
// Saturday 8pm Eastern: Sunday's pick reminders are due.
const now = new Date("2026-11-15T01:00:00Z");
const DAY = "2026-11-15";

describe.skipIf(!process.env.DATABASE_URL)("email outbox with a local database", () => {
  // Vitest still runs a skipped suite's body to collect it, so the URL must parse even when it is never used.
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  let sent: OutgoingEmail[] = [];
  const email: EmailDeps = {
    mailer: {
      send: async (message) => {
        // Yield, so overlapping drains really interleave.
        await new Promise((resolve) => setTimeout(resolve, 1));
        sent.push(message);
      },
    },
    appUrl: "https://picks.test",
    unsubscribeSecret: "test-unsubscribe-secret-that-is-long-enough",
    limits: { daily: 100_000, monthly: 1_000_000 },
  };
  let usageBefore: (typeof emailUsage.$inferSelect)[] = [];
  let leagueId: string, weekId: string, early: string, late: string;

  // The drain sends whatever is due in the whole database; only look at this suite's recipients.
  const mine = () => sent.filter((m) => users.some((id) => m.to === addressOf(id)));
  const outbox = () => db.select().from(emailOutbox).where(inArray(emailOutbox.userId, users));
  const message = (subject: string) => ({
    subject,
    html: `<p>${subject}</p>`,
    text: subject,
    listUnsubscribeUrl: "https://picks.test/api/unsubscribe?token=t",
  });
  async function threads(count: number) {
    return db
      .insert(messageThreads)
      .values(Array.from({ length: count }, (_, i) => ({ leagueId, authorId: author, title: `Thread ${i}` })))
      .returning({ id: messageThreads.id });
  }
  /** Queues a thread email the way `queueThreadEmails` does, with a known subject. */
  const threadRow = (
    threadId: string,
    userId: string,
    set: Partial<typeof emailOutbox.$inferInsert> = {},
  ) => ({
    userId,
    kind: "new_thread" as const,
    dedupeKey: threadEmailKey(threadId, userId),
    nextAttemptAt: now,
    expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
    message: message(`${threadId}:${userId}`),
    ...set,
  });

  beforeAll(async () => {
    for (const id of users)
      await db.execute(sql`insert into auth.users (id, email) values (${id}, ${addressOf(id)})`);
    usageBefore = await db.select().from(emailUsage).where(eq(emailUsage.day, DAY));
  });
  beforeEach(async () => {
    sent = [];
    const [league] = await db
      .insert(leagues)
      .values({ name: "Outbox test", inviteCode: randomUUID() })
      .returning();
    assert(league);
    leagueId = league.id;
    await db.insert(leagueMembers).values(users.map((userId) => ({ leagueId, userId })));
    const [season] = await db.insert(seasons).values({ leagueId, year: 2026 }).returning();
    assert(season);
    const [week] = await db
      .insert(weeks)
      .values({ seasonId: season.id, number: 10, status: "open" })
      .returning();
    assert(week);
    weekId = week.id;
    const slate = await db
      .insert(games)
      .values([
        // Sunday 1pm and 4:25pm Eastern.
        {
          weekId,
          kickoff: new Date("2026-11-15T18:00:00Z"),
          homeTeam: "BUF",
          awayTeam: "MIA",
          spread: -3,
          points: 1,
        },
        {
          weekId,
          kickoff: new Date("2026-11-15T21:25:00Z"),
          homeTeam: "ATL",
          awayTeam: "KC",
          spread: 3,
          points: 1,
        },
      ])
      .returning();
    [early, late] = slate.map((g) => g.id) as [string, string];
  });
  afterEach(async () => {
    await db.delete(emailOutbox).where(inArray(emailOutbox.userId, users));
    await db.delete(leagues).where(eq(leagues.id, leagueId));
  });
  afterAll(async () => {
    await db.delete(emailUsage).where(eq(emailUsage.day, DAY));
    if (usageBefore.length) await db.insert(emailUsage).values(usageBefore);
    await db.execute(sql`delete from auth.users where id in (${author}, ${player}, ${other})`);
    await db.$close();
  });

  it("sends each email exactly once when drains overlap", async () => {
    // More rows than one claim batch, so the drains contend for several batches.
    const made = await threads(25);
    await db
      .insert(emailOutbox)
      .values(made.flatMap(({ id }) => [threadRow(id, player), threadRow(id, other)]));
    await Promise.all([
      drainOutbox(db, email, now),
      drainOutbox(db, email, now),
      drainOutbox(db, email, now),
    ]);
    expect(mine()).toHaveLength(50);
    expect(new Set(mine().map((m) => m.subject)).size).toBe(50);
    expect((await outbox()).every((r) => r.status === "sent" && r.attempts === 1)).toBe(true);
  });

  it("reclaims a row stuck in sending once its lease runs out, and leaves a live claim alone", async () => {
    const [stale, live] = await threads(2);
    assert(stale && live);
    await db.insert(emailOutbox).values([
      // A drain died mid-send: its lease ended a minute ago.
      threadRow(stale.id, player, {
        status: "sending",
        attempts: 1,
        nextAttemptAt: new Date(now.getTime() - 60_000),
      }),
      // Another drain is sending this one right now.
      threadRow(live.id, player, {
        status: "sending",
        attempts: 1,
        nextAttemptAt: new Date(now.getTime() + 5 * 60_000),
      }),
    ]);
    await drainOutbox(db, email, now);
    expect(mine().map((m) => m.subject)).toEqual([`${stale.id}:${player}`]);
    const rows = await outbox();
    expect(rows.find((r) => r.dedupeKey === threadEmailKey(stale.id, player))).toMatchObject({
      status: "sent",
      attempts: 2,
    });
    expect(rows.find((r) => r.dedupeKey === threadEmailKey(live.id, player))?.status).toBe("sending");
  });

  it("skips a thread email to someone who left the league before it went out", async () => {
    const [thread] = await threads(1);
    assert(thread);
    await db.insert(emailOutbox).values([threadRow(thread.id, player), threadRow(thread.id, other)]);
    await db
      .update(leagueMembers)
      .set({ removedAt: now })
      .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, player)));
    await drainOutbox(db, email, now);
    expect(mine().map((m) => m.to)).toEqual([addressOf(other)]);
    expect((await outbox()).find((r) => r.userId === player)).toMatchObject({
      status: "skipped",
      lastError: "NOT_A_MEMBER",
    });
  });

  it("rechecks a reminder at send time: lists only games still unpicked, and skips it once none are", async () => {
    // Queued now, sent an hour later (as a retry or a budget hold would).
    await queueReminders(db, email, now);
    expect((await outbox()).map((r) => r.userId).sort()).toEqual([...users].sort());
    // The player picks one of the two Sunday games; the other picks both; the author leaves the league.
    await db.insert(picks).values([
      { weekId, gameId: early, userId: player, side: "home" },
      { weekId, gameId: early, userId: other, side: "home" },
      { weekId, gameId: late, userId: other, side: "away" },
    ]);
    await db
      .update(leagueMembers)
      .set({ removedAt: now })
      .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, author)));

    const later = new Date(now.getTime() + 60 * 60_000);
    await drainOutbox(db, email, later);
    const [reminder] = mine();
    expect(mine()).toHaveLength(1);
    expect(reminder?.to).toBe(addressOf(player));
    expect(reminder?.subject).toBe("Outbox test: 1 game to pick for Sunday");
    expect(reminder?.text).toContain("Chiefs at Falcons");
    expect(reminder?.text).not.toContain("Dolphins at Bills");
    const rows = await outbox();
    expect(
      rows
        .filter((r) => r.lastError === "NO_LONGER_DUE")
        .map((r) => r.userId)
        .sort(),
    ).toEqual([author, other].sort());
  });

  it("sends a reminder as queued when its recheck can't run, instead of holding up the batch", async () => {
    await queueReminders(db, email, now);
    const [thread] = await threads(1);
    assert(thread);
    await db.insert(emailOutbox).values(threadRow(thread.id, player));
    // A time zone the runtime doesn't know makes working out the due day throw.
    await db.update(leagues).set({ timeZone: "Not/AZone" }).where(eq(leagues.id, leagueId));
    await drainOutbox(db, email, now);
    // All three reminders and the thread email behind them still go out.
    expect(mine()).toHaveLength(4);
    expect((await outbox()).every((r) => r.status === "sent")).toBe(true);
  });

  it("skips a reminder once its week is no longer open", async () => {
    await queueReminders(db, email, now);
    await db.update(weeks).set({ status: "draft" }).where(eq(weeks.id, weekId));
    await drainOutbox(db, email, now);
    expect(mine()).toEqual([]);
    expect((await outbox()).map((r) => r.lastError)).toEqual([
      "NO_LONGER_DUE",
      "NO_LONGER_DUE",
      "NO_LONGER_DUE",
    ]);
  });
});
