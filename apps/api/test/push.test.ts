import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDb,
  games,
  leagueMembers,
  leagues,
  messageThreads,
  picks,
  profiles,
  pushDeliveries,
  pushSubscriptions,
  seasons,
  weeks,
} from "@picks/db";
import type { PushDevice } from "@picks/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { drainPush, queuePickPush, queueThreadPush } from "../src/pushQueue";
import type { PushSender } from "../src/pushSender";

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };
const author = randomUUID(),
  player = randomUUID(),
  other = randomUUID();
const users: string[] = [author, player, other];
const verifyToken = async (token: string) => (users.includes(token) ? { id: token } : null);
const keys = { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) };
const subscription = (suffix: string) => ({
  endpoint: `https://web.push.apple.com/${suffix}`,
  keys,
  newThreads: true,
  pickReminders: true,
});
const at = new Date("2026-11-15T00:00:00Z"); // Saturday 7pm Eastern.

it("requires auth for device routes, and has no job endpoint (the Cron Trigger runs the job)", async () => {
  const app = createApp({ db: {} as never, verifyToken, publicConfig, nfl: { getWeek: async () => [] } });
  expect((await app.request("/api/push/config")).status).toBe(401);
  expect((await app.request("/api/push/device", { method: "DELETE" })).status).toBe(401);
  expect((await app.request("/api/push/jobs/run", { method: "POST" })).status).toBe(404);
});

describe.skipIf(!process.env.DATABASE_URL)("push with a local database", () => {
  // Vitest still runs a skipped suite's body to collect it, so the URL must parse even when it is never used.
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  const send = vi.fn<PushSender["send"]>(async () => "sent");
  const push = { publicKey: keys.p256dh, send };
  const app = createApp({
    db,
    verifyToken,
    publicConfig,
    nfl: { getWeek: async () => [] },
    push,
    now: () => at,
  });
  let leagueId: string, threadId: string, weekId: string, gameId: string;
  const call = async (user: string, method: string, path: string, json?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  async function device(user = player, suffix = randomUUID()) {
    const value = subscription(suffix);
    const res = await call(user, "PUT", "/push/device", value);
    expect(res.status).toBe(200);
    const { device: result } = (await res.json()) as { device: PushDevice };
    return { ...result, ...value };
  }
  beforeAll(async () => {
    for (const id of users)
      await db.execute(sql`insert into auth.users (id, email) values (${id}, ${`${id}@push.test`})`);
    // Posting needs a display name. Removed with the users (cascade).
    await db.insert(profiles).values(users.map((userId, i) => ({ userId, displayName: `Push ${i}` })));
  });
  beforeEach(async () => {
    send.mockReset().mockResolvedValue("sent");
    const [league] = await db
      .insert(leagues)
      .values({ name: "Push test", inviteCode: randomUUID() })
      .returning();
    assert(league);
    leagueId = league.id;
    await db
      .insert(leagueMembers)
      .values(users.map((userId) => ({ leagueId, userId, role: "member" as const })));
    const [season] = await db.insert(seasons).values({ leagueId, year: 2026 }).returning();
    assert(season);
    const [week] = await db
      .insert(weeks)
      .values({ seasonId: season.id, number: 10, status: "open" })
      .returning();
    assert(week);
    weekId = week.id;
    const [game] = await db
      .insert(games)
      .values({
        weekId,
        kickoff: new Date("2026-11-15T18:00:00Z"),
        homeTeam: "BUF",
        awayTeam: "MIA",
        spread: -3,
        points: 1,
      })
      .returning();
    assert(game);
    gameId = game.id;
    const [thread] = await db
      .insert(messageThreads)
      .values({ leagueId, authorId: author, title: "Sunday picks" })
      .returning();
    assert(thread);
    threadId = thread.id;
  });
  afterEach(async () => {
    await db.delete(leagues).where(eq(leagues.id, leagueId));
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, users));
  });
  afterAll(async () => {
    await db.execute(sql`delete from auth.users where id in (${author}, ${player}, ${other})`);
    await db.$close();
  });

  it("keeps subscriptions private, validates provider endpoints and prevents cross-account reassignment/deletion", async () => {
    const d = await device();
    const config = await (await call(player, "GET", "/push/config")).json();
    expect(config).toEqual({ configured: true, publicKey: keys.p256dh });
    expect(
      (await call(player, "PUT", "/push/device", { ...d, endpoint: "https://127.0.0.1/private" })).status,
    ).toBe(400);
    expect((await call(other, "PUT", "/push/device", d)).status).toBe(409);
    const hidden = (await (await call(other, "POST", "/push/device", { endpoint: d.endpoint })).json()) as {
      device: PushDevice | null;
    };
    expect(hidden.device).toBeNull();
    await call(other, "DELETE", "/push/device", { endpoint: d.endpoint });
    expect((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, d.id))).length).toBe(1);
    await call(player, "DELETE", "/push/device", { endpoint: d.endpoint });
    expect((await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, d.id))).length).toBe(0);
  });
  it("caps subscriptions per account while allowing preference updates", async () => {
    const devices = [];
    for (let i = 0; i < 10; i++) devices.push(await device());
    expect((await call(player, "PUT", "/push/device", subscription(randomUUID()))).status).toBe(409);
    expect((await call(player, "PUT", "/push/device", { ...devices[0], newThreads: false })).status).toBe(
      200,
    );
  });
  it("queues new threads for other current opted-in members only, and deduplicates events", async () => {
    await device(author);
    const recipient = await device();
    const optedOut = await device(other);
    await call(other, "PUT", "/push/device", { ...optedOut, newThreads: false });
    await queueThreadPush(db, leagueId, threadId, author, at);
    await queueThreadPush(db, leagueId, threadId, author, at);
    const queued = await db.select().from(pushDeliveries).where(eq(pushDeliveries.leagueId, leagueId));
    expect(queued).toHaveLength(1);
    expect(queued[0]?.subscriptionId).toBe(recipient.id);
    await Promise.all([drainPush(db, push, at), drainPush(db, push, at)]);
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      title: "New league thread",
      url: `/leagues/${leagueId}/messages/${threadId}`,
    });
  });
  it("commits queued notifications atomically with threads and delivers after commit", async () => {
    await device();
    send.mockImplementation(async () => {
      const found = await db
        .select()
        .from(messageThreads)
        .where(and(eq(messageThreads.leagueId, leagueId), eq(messageThreads.title, "New post")));
      expect(found).toHaveLength(1);
      return "sent";
    });
    expect(
      (await call(author, "POST", `/leagues/${leagueId}/messages`, { title: "New post", body: "Hello team" }))
        .status,
    ).toBe(201);
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await vi.waitFor(async () => {
      const rows = await db.select().from(pushDeliveries).where(eq(pushDeliveries.leagueId, leagueId));
      expect(rows[0]?.status).toBe("sent");
    });
  });
  it("rechecks removed membership, preferences and expiry before sending", async () => {
    await device();
    await queueThreadPush(db, leagueId, threadId, author, at);
    await db
      .update(leagueMembers)
      .set({ removedAt: at })
      .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, player)));
    expect((await drainPush(db, push, at)).skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("queues only missing-pick reminders, deduplicates jobs, and drops one when picks are completed", async () => {
    await device();
    expect(await queuePickPush(db, at)).toBe(1);
    expect(await queuePickPush(db, at)).toBe(0);
    await db.insert(picks).values({ weekId, gameId, userId: player, side: "home" });
    expect((await drainPush(db, push, at)).skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("sends reminders with the week link, then expires unsent reminders at the day's first kickoff", async () => {
    await device();
    await queuePickPush(db, at);
    expect((await drainPush(db, push, at)).sent).toBe(1);
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      title: "Make your picks",
      body: "Push test: 1 game left to pick before kickoff.",
      url: `/weeks/${weekId}`,
    });
    await device(other);
    await queuePickPush(db, at);
    // Picks lock at kickoff (1pm Eastern), so a reminder still waiting then is no use.
    expect((await drainPush(db, push, new Date("2026-11-15T18:00:00Z"))).skipped).toBe(1);
    expect(send).toHaveBeenCalledOnce();
  });

  it("still sends a waiting reminder in the morning, before kickoff", async () => {
    await device();
    await queuePickPush(db, at);
    expect((await drainPush(db, push, new Date("2026-11-15T17:59:00Z"))).sent).toBe(1);
  });
  it("backs off transient failures and removes expired device subscriptions", async () => {
    const d = await device();
    await queueThreadPush(db, leagueId, threadId, author, at);
    send.mockResolvedValue("retry");
    expect((await drainPush(db, push, at)).retrying).toBe(1);
    await drainPush(db, push, at);
    expect(send).toHaveBeenCalledOnce();
    send.mockResolvedValue("gone");
    await drainPush(db, push, new Date(at.getTime() + 5 * 60_000));
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, d.id))).toHaveLength(0);
    expect(await db.select().from(pushDeliveries).where(eq(pushDeliveries.leagueId, leagueId))).toHaveLength(
      0,
    );
  });
  it("sends each notification exactly once when drains overlap", async () => {
    // More devices than the per-account cap the route enforces, so insert them directly.
    const devices = await db
      .insert(pushSubscriptions)
      .values(
        Array.from({ length: 30 }, () => ({
          userId: player,
          endpoint: `https://web.push.apple.com/${randomUUID()}`,
          ...keys,
        })),
      )
      .returning({ id: pushSubscriptions.id });
    await queueThreadPush(db, leagueId, threadId, author, at);
    send.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return "sent";
    });
    await Promise.all([drainPush(db, push, at), drainPush(db, push, at), drainPush(db, push, at)]);
    expect(send).toHaveBeenCalledTimes(devices.length);
    expect(new Set(send.mock.calls.map(([device]) => device.endpoint)).size).toBe(devices.length);
    const rows = await db.select().from(pushDeliveries).where(eq(pushDeliveries.leagueId, leagueId));
    expect(rows.every((r) => r.status === "sent" && r.attempts === 1)).toBe(true);
  });
  it("retries a delivery whose sender died mid-send once its lease runs out", async () => {
    await device();
    await queueThreadPush(db, leagueId, threadId, author, at);
    send.mockRejectedValueOnce(new Error("isolate cut off"));
    await expect(drainPush(db, push, at)).rejects.toThrow();
    // Leased: no other run takes it while the lease lasts...
    await drainPush(db, push, new Date(at.getTime() + 60_000));
    expect(send).toHaveBeenCalledOnce();
    // ...and the next run after it sends it.
    expect((await drainPush(db, push, new Date(at.getTime() + 5 * 60_000))).sent).toBe(1);
    const [row] = await db.select().from(pushDeliveries).where(eq(pushDeliveries.leagueId, leagueId));
    expect(row).toMatchObject({ status: "sent", attempts: 2 });
  });
  it("forgets a device after three permanent failures in a row", async () => {
    const d = await device();
    const more = await db
      .insert(messageThreads)
      .values([
        { leagueId, authorId: author, title: "Two" },
        { leagueId, authorId: author, title: "Three" },
      ])
      .returning({ id: messageThreads.id });
    send.mockResolvedValue("failed");
    for (const [i, id] of [threadId, ...more.map((t) => t.id)].entries()) {
      // Queued a second apart, so "in a row" has an order.
      await queueThreadPush(db, leagueId, id, author, new Date(at.getTime() + i * 1000));
      await drainPush(db, push, new Date(at.getTime() + i * 1000));
      const left = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, d.id));
      expect(left).toHaveLength(i < 2 ? 1 : 0);
    }
  });
  it("keeps a device whose failures are broken up by a success", async () => {
    const d = await device();
    const more = await db
      .insert(messageThreads)
      .values([
        { leagueId, authorId: author, title: "Two" },
        { leagueId, authorId: author, title: "Three" },
      ])
      .returning({ id: messageThreads.id });
    send.mockResolvedValueOnce("failed").mockResolvedValueOnce("sent").mockResolvedValueOnce("failed");
    for (const [i, id] of [threadId, ...more.map((t) => t.id)].entries()) {
      await queueThreadPush(db, leagueId, id, author, new Date(at.getTime() + i * 1000));
      await drainPush(db, push, new Date(at.getTime() + i * 1000));
    }
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, d.id))).toHaveLength(1);
  });
  it("leaves everything queued while the sender isn't ready (mismatched VAPID keys)", async () => {
    await device();
    await queueThreadPush(db, leagueId, threadId, author, at);
    expect(await drainPush(db, { ...push, ready: async () => false }, at)).toEqual({
      sent: 0,
      skipped: 0,
      retrying: 0,
      failed: 0,
    });
    expect(send).not.toHaveBeenCalled();
    const [row] = await db.select().from(pushDeliveries).where(eq(pushDeliveries.leagueId, leagueId));
    expect(row).toMatchObject({ status: "pending", attempts: 0 });
  });
  it("drops a queued reminder for a player who has left the league", async () => {
    await device();
    expect(await queuePickPush(db, at)).toBe(1);
    await db
      .update(leagueMembers)
      .set({ removedAt: at })
      .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, player)));
    expect((await drainPush(db, push, at)).skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
  });
  it("queues one reminder per device in a single pass, and not for a game with both scores in", async () => {
    await device();
    await device();
    expect(await queuePickPush(db, at)).toBe(2);
    await db.delete(pushDeliveries).where(eq(pushDeliveries.leagueId, leagueId));
    // Only one score typed so far: the game hasn't been played, so it still needs a pick.
    await db.update(games).set({ homeScore: 3 }).where(eq(games.id, gameId));
    expect(await queuePickPush(db, at)).toBe(2);
    await db.delete(pushDeliveries).where(eq(pushDeliveries.leagueId, leagueId));
    await db.update(games).set({ homeScore: 3, awayScore: 0 }).where(eq(games.id, gameId));
    expect(await queuePickPush(db, at)).toBe(0);
  });
  it("stops permanent failures and honors preference changes on pending notifications", async () => {
    const d = await device();
    await queueThreadPush(db, leagueId, threadId, author, at);
    await call(player, "PUT", "/push/device", { ...d, newThreads: false });
    expect((await drainPush(db, push, at)).skipped).toBe(1);
    expect(send).not.toHaveBeenCalled();
    await call(player, "PUT", "/push/device", { ...d, newThreads: true });
    await db.delete(pushDeliveries).where(eq(pushDeliveries.leagueId, leagueId));
    await queueThreadPush(db, leagueId, threadId, author, at);
    send.mockResolvedValue("failed");
    expect((await drainPush(db, push, at)).failed).toBe(1);
    await drainPush(db, push, at);
    expect(send).toHaveBeenCalledOnce();
  });
});
