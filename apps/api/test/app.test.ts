import {
  createDb,
  emailOutbox,
  emailUsage,
  leagueMembers,
  leagues,
  messagePosts,
  messageReactions,
  messageReads,
  profiles,
  pushDeliveries,
  pushSubscriptions,
  weekParticipants,
} from "@picks/db";
import {
  type GameInsights,
  type LeagueDetail,
  MAX_LEAGUE_MEMBERS,
  MAX_LEAGUES_PER_USER,
  MESSAGE_BODY_MAX,
  type Me,
  type MessageReaction,
  type MessageThread,
  type Standings,
  type ThreadDetail,
  type WeekView,
} from "@picks/shared";
import { and, between, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { EmailSendError, type OutgoingEmail } from "../src/email";
import { loadEnv } from "../src/env";
import { type NflProvider, type ProviderGame, parseEspnScoreboard } from "../src/nfl";
import { type EmailDeps, runEmailJobs } from "../src/outbox";
import { RESULTS_REFRESH_MS } from "../src/weeks";

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };
const ADMIN = "00000000-0000-4000-8000-000000000001";
const PLAYER = "00000000-0000-4000-8000-000000000002";
const OUTSIDER = "00000000-0000-4000-8000-000000000003";
const USERS = [ADMIN, PLAYER, OUTSIDER];
// Tests inject a fake verifier: the token *is* the user id.
const verifyToken = async (token: string) => (USERS.includes(token) ? { id: token } : null);
const noGames: NflProvider = { getWeek: async () => [] };

describe("without a database", () => {
  const app = createApp({ db: {} as never, verifyToken, publicConfig, nfl: noGames });

  it("rejects requests without a token", async () => {
    expect((await app.request("/api/me")).status).toBe(401);
    expect((await app.request("/api/leagues")).status).toBe(401);
  });

  it("has no job endpoint: the email job runs only from the Cron Trigger", async () => {
    expect((await app.request("/api/jobs/run", { method: "POST" })).status).toBe(404);
  });

  it("rejects requests with an invalid token", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it("reports the database as down when it is unreachable", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(503);
  });

  it("sends security headers and no-store on every response, errors included", async () => {
    for (const res of [
      await app.request("/api/config"),
      await app.request("/api/me"),
      await app.request("/api/nothing-here"),
    ]) {
      expect(res.headers.get("Strict-Transport-Security")).toBe("max-age=15552000");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
      expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("answers unknown paths with a JSON 404", async () => {
    const res = await app.request("/api/nothing-here");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("refuses an oversized body before reading it", async () => {
    const res = await app.request("/api/me", {
      method: "PUT",
      headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "x".repeat(70 * 1024) }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "That request is too large." });
  });

  it("answers bad params and queries in the API's { error } shape", async () => {
    const get = (path: string) =>
      app.request(`/api${path}`, { headers: { Authorization: `Bearer ${ADMIN}` } });
    const badMember = await app.request(`/api/leagues/${ADMIN}/members/not-a-uuid`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${ADMIN}` },
    });
    expect(badMember.status).toBe(404);
    expect(await badMember.json()).toEqual({ error: "Not found" });
    const badYear = await get(`/leagues/${ADMIN}/standings?year=soon`);
    expect(badYear.status).toBe(400);
    expect(await badYear.json()).toEqual({ error: "Choose a season year" });
    const badThread = await get(`/leagues/${ADMIN}/messages/nope`);
    expect(badThread.status).toBe(404);
    expect(await badThread.json()).toEqual({ error: "Not found" });
  });
});

describe.skipIf(!process.env.DATABASE_URL)("with a database (requires `pnpm db:start`)", () => {
  // Vitest collects skipped suites too. A valid lazy client keeps collection safe without opening a DB.
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");

  // Week 10 of 2026 in Eastern time (UTC-5): Thursday night, Sunday 1pm, Monday night.
  const THU = new Date("2026-11-13T01:15:00Z");
  const SUN = new Date("2026-11-15T18:00:00Z");
  const MON = new Date("2026-11-17T01:15:00Z");
  const WEDNESDAY = new Date("2026-11-11T17:00:00Z");
  const SUNDAY_7AM = new Date("2026-11-15T12:00:00Z");

  let now = WEDNESDAY;
  let insightsDown = false;
  let providerDown = false;
  let providerCalls = 0;
  const emptyTeam = { record: null, venueRecord: null, lastFive: [], injuries: [], leaders: [], news: [] };
  const emptyMatchup = {
    home: emptyTeam,
    away: emptyTeam,
    stats: [],
    overUnder: null,
    prediction: { home: 0.6, away: 0.39 },
    url: null,
  };
  let provided: ProviderGame[] = [
    {
      externalId: "t1",
      homeTeam: "NYG",
      awayTeam: "WSH",
      kickoff: THU,
      spread: -2.5,
      homeScore: null,
      awayScore: null,
    },
    {
      externalId: "t2",
      homeTeam: "ATL",
      awayTeam: "KC",
      kickoff: SUN,
      spread: 3.5,
      homeScore: null,
      awayScore: null,
    },
    {
      externalId: "t3",
      homeTeam: "BAL",
      awayTeam: "LAC",
      kickoff: MON,
      spread: null,
      homeScore: null,
      awayScore: null,
    },
  ];
  // Email goes to this fake. Background sends are collected so a test can wait for them with `settle()`.
  let sentEmails: OutgoingEmail[] = [];
  let mailerError: Error | undefined;
  const pending: Promise<unknown>[] = [];
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };
  // Mutable so the budget test can tighten it; generous everywhere else.
  const limits = { daily: 10_000, monthly: 100_000 };
  const email: EmailDeps = {
    mailer: {
      send: async (message) => {
        if (mailerError) throw mailerError;
        sentEmails.push(message);
      },
    },
    appUrl: "https://picks.test",
    unsubscribeSecret: "test-unsubscribe-secret-that-is-long-enough",
    limits,
  };
  const app = createApp({
    db,
    verifyToken,
    publicConfig,
    // This suite starts far more threads in one league than a player may in a day (messages.test.ts covers
    // that limit).
    limits: {
      membersPerLeague: MAX_LEAGUE_MEMBERS,
      leaguesPerUser: MAX_LEAGUES_PER_USER,
      threadsPerDay: 1000,
    },
    nfl: {
      getWeek: async () => {
        providerCalls += 1;
        if (providerDown) throw new Error("offline");
        return provided;
      },
    },
    insights: {
      getMatchup: async (externalId) => {
        if (insightsDown) throw new Error("offline");
        return { ...emptyMatchup, url: `https://example.test/${externalId}` };
      },
    },
    now: () => now,
    email,
    background: (task) => pending.push(task()),
  });
  /** What the Worker's Cron Trigger runs. */
  const runJobs = async () => ({ body: await runEmailJobs(db, email, now) });
  const outboxFor = async (threadId: string) =>
    (await db.select().from(emailOutbox).where(eq(emailOutbox.userId, ADMIN))).find((r) =>
      r.dedupeKey.startsWith(`thread:${threadId}:`),
    );
  // The suite's clock stays in November and December 2026; put that range of the send counter back afterwards.
  const usageRange = between(emailUsage.day, "2026-11-01", "2026-12-31");
  let usageBefore: (typeof emailUsage.$inferSelect)[] = [];
  const emailsTo = (user: string) =>
    sentEmails.filter((m) => m.to === `api-test-${USERS.indexOf(user)}@example.com`);

  const callOn =
    (target: ReturnType<typeof createApp>) =>
    async <T = unknown>(user: string, method: string, path: string, json?: unknown) => {
      const res = await target.request(`/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
        body: json === undefined ? undefined : JSON.stringify(json),
      });
      return { status: res.status, body: (await res.json()) as T };
    };
  const call = callOn(app);
  const errorOf = (res: { body: unknown }) => (res.body as { error: string }).error;

  // State threaded through the flow below; the tests run in order.
  const createdLeagues: string[] = [];
  let leagueId = "";
  let inviteCode = "";
  let weekId = "";
  let game: Record<"thu" | "sun" | "mon", string> = { thu: "", sun: "", mon: "" };

  // Only touch rows this suite creates.
  const cleanUp = async () => {
    if (createdLeagues.length) await db.delete(leagues).where(inArray(leagues.id, createdLeagues));
    await db.delete(profiles).where(inArray(profiles.userId, USERS));
    await db.delete(emailOutbox).where(inArray(emailOutbox.userId, USERS));
  };

  beforeAll(async () => {
    for (const [i, id] of USERS.entries()) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}, ${`api-test-${i}@example.com`}) on conflict do nothing`,
      );
    }
    await db.delete(profiles).where(inArray(profiles.userId, USERS));
    await db.delete(emailOutbox).where(inArray(emailOutbox.userId, USERS));
    usageBefore = await db.select().from(emailUsage).where(usageRange);
  });

  afterAll(async () => {
    await cleanUp();
    await db.delete(emailUsage).where(usageRange);
    if (usageBefore.length) await db.insert(emailUsage).values(usageBefore);
    await db.$close();
  });

  it("reports healthy", async () => {
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({ ok: true, db: "up" });
  });

  it("stores a display name", async () => {
    expect((await call(ADMIN, "GET", "/me")).body).toEqual({
      id: ADMIN,
      displayName: null,
      isOperator: false,
      notifications: { newThreads: true, pickReminders: true, leagueEvents: true },
      moderation: { termsAccepted: false, mutedUntil: null, suspended: false },
    });
    // The first name step also agrees to the terms, which posting needs.
    expect(
      (await call(ADMIN, "PUT", "/me", { displayName: "  Commish  ", acceptTerms: true })).body,
    ).toMatchObject({
      displayName: "Commish",
      moderation: { termsAccepted: true },
    });
    await call(PLAYER, "PUT", "/me", { displayName: "Pat", acceptTerms: true });
    expect((await call(ADMIN, "PUT", "/me", { displayName: "" })).status).toBe(400);

    // A name comes before anything else, so nobody shows up in a league as "Player".
    const nameless = await call(OUTSIDER, "POST", "/leagues", { name: "No name yet" });
    expect(nameless).toEqual({ status: 409, body: { error: "Choose a display name first." } });
    await call(OUTSIDER, "PUT", "/me", { displayName: "Newcomer", acceptTerms: true });
  });

  it("creates a league with its creator as admin", async () => {
    const created = await call<{ id: string }>(ADMIN, "POST", "/leagues", { name: "Test League" });
    expect(created.status).toBe(201);
    leagueId = created.body.id;
    createdLeagues.push(leagueId);

    const detail = await call<LeagueDetail>(ADMIN, "GET", `/leagues/${leagueId}`);
    expect(detail.body).toMatchObject({
      name: "Test League",
      role: "admin",
      timeZone: "America/New_York",
      members: [{ userId: ADMIN, displayName: "Commish", role: "admin" }],
    });
    inviteCode = detail.body.inviteCode ?? "";
    expect(inviteCode).not.toBe("");
  });

  it("hides a league from people who aren't in it", async () => {
    expect((await call(OUTSIDER, "GET", `/leagues/${leagueId}`)).status).toBe(404);
    expect((await call(OUTSIDER, "GET", `/leagues/${leagueId}/standings`)).status).toBe(404);
    expect((await call(OUTSIDER, "GET", "/leagues/not-a-uuid")).status).toBe(404);
    expect((await call(OUTSIDER, "GET", "/leagues")).body).toEqual([]);
  });

  it("lets someone with the invite link join as a member", async () => {
    expect((await call(PLAYER, "GET", `/invites/${inviteCode}`)).body).toEqual({
      leagueId,
      leagueName: "Test League",
      alreadyMember: false,
      full: false,
    });
    expect((await call(PLAYER, "POST", `/invites/${inviteCode}/join`)).body).toEqual({ leagueId });
    // Joining twice is harmless.
    expect((await call(PLAYER, "POST", `/invites/${inviteCode}/join`)).status).toBe(200);

    const detail = await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`);
    expect(detail.body).toMatchObject({ role: "member", inviteCode: null });
    expect(detail.body.members.map((m) => m.displayName)).toEqual(["Commish", "Pat"]);
    expect((await call(PLAYER, "GET", "/invites/bogus")).status).toBe(404);
  });

  it("uses the injected clock for joins and rejoins while enforcing membership limits", async () => {
    let clock = WEDNESDAY;
    const on = callOn(
      createApp({
        db,
        verifyToken,
        publicConfig,
        nfl: noGames,
        now: () => clock,
        limits: { membersPerLeague: 2, leaguesPerUser: 100 },
      }),
    );
    const created = await on<{ id: string }>(ADMIN, "POST", "/leagues", { name: "Clock Test" });
    const id = created.body.id;
    createdLeagues.push(id);
    try {
      const code = (await on<LeagueDetail>(ADMIN, "GET", `/leagues/${id}`)).body.inviteCode;
      const membership = async () =>
        (
          await db
            .select()
            .from(leagueMembers)
            .where(and(eq(leagueMembers.leagueId, id), eq(leagueMembers.userId, PLAYER)))
        )[0];

      expect((await on(PLAYER, "POST", `/invites/${code}/join`)).status).toBe(200);
      expect(await membership()).toMatchObject({ joinedAt: WEDNESDAY, removedAt: null });
      clock = SUNDAY_7AM;
      // An existing membership keeps its original timestamp, even when the league is full.
      expect((await on(PLAYER, "POST", `/invites/${code}/join`)).status).toBe(200);
      expect(await membership()).toMatchObject({ joinedAt: WEDNESDAY });
      const full = await on(OUTSIDER, "POST", `/invites/${code}/join`);
      expect(full.status).toBe(409);
      expect(errorOf(full)).toMatch(/full/);
      expect((await on(PLAYER, "DELETE", `/leagues/${id}/members/${PLAYER}`)).status).toBe(200);
      expect(await membership()).toMatchObject({ removedAt: SUNDAY_7AM });
      clock = MON;
      expect((await on(PLAYER, "POST", `/invites/${code}/join`)).status).toBe(200);
      expect(await membership()).toMatchObject({ joinedAt: MON, removedAt: null });
    } finally {
      await db.delete(leagues).where(eq(leagues.id, id));
    }
  });

  it("keeps conversations private to members and tracks exact read versions", async () => {
    const base = `/leagues/${leagueId}/messages`;
    expect((await call(OUTSIDER, "GET", base)).status).toBe(404);
    expect((await call(PLAYER, "POST", base, { title: " ", body: "hello" })).status).toBe(400);
    expect(
      (await call(PLAYER, "POST", base, { title: "Hi", body: "x".repeat(MESSAGE_BODY_MAX + 1) })).status,
    ).toBe(400);
    const created = await call<{ id: string }>(PLAYER, "POST", base, {
      title: "  Discussion  ",
      body: "Hello league",
    });
    expect(created.status).toBe(201);
    const path = `${base}/${created.body.id}`;
    expect((await call<MessageThread[]>(PLAYER, "GET", base)).body[0]).toMatchObject({
      title: "Discussion",
      unread: false,
    });
    expect((await call<MessageThread[]>(ADMIN, "GET", base)).body[0]?.unread).toBe(true);
    for (const [method, suffix, body] of [
      ["GET", "", undefined],
      ["POST", "/replies", { body: "no" }],
      ["POST", "/read", { version: 1 }],
    ] as const) {
      expect((await call(OUTSIDER, method, path + suffix, body)).status).toBe(404);
    }
    await call(ADMIN, "POST", `${path}/read`, { version: 1 });
    const replies = await Promise.all([
      call(PLAYER, "POST", `${path}/replies`, { body: "First" }),
      call(ADMIN, "POST", `${path}/replies`, { body: "Second" }),
    ]);
    expect(replies.map((r) => r.status)).toEqual([201, 201]);
    const detail = (await call<ThreadDetail>(ADMIN, "GET", path)).body;
    expect(detail.version).toBe(3);
    expect(detail.posts.map((p) => p.position)).toEqual([1, 2, 3]);
    await call(ADMIN, "POST", `${path}/read`, { version: 1 });
    expect((await call<MessageThread[]>(ADMIN, "GET", base)).body[0]?.unread).toBe(true);
    await call(ADMIN, "POST", `${path}/read`, { version: 3 });
    await call(ADMIN, "POST", `${path}/read`, { version: 1 });
    expect((await call<MessageThread[]>(ADMIN, "GET", base)).body[0]?.unread).toBe(false);
    const other = await call<{ id: string }>(ADMIN, "POST", "/leagues", { name: "Other messages" });
    createdLeagues.push(other.body.id);
    expect((await call(ADMIN, "GET", `/leagues/${other.body.id}/messages/${created.body.id}`)).status).toBe(
      404,
    );
    const postId = detail.posts[0]?.id;
    const reactionPath = `${path}/posts/${postId}/reactions`;
    const react = (user: string, emoji = "👍", active = true) =>
      call<MessageReaction[]>(user, "PUT", reactionPath, { emoji, active });
    expect((await react(OUTSIDER)).status).toBe(404);
    expect((await react(PLAYER, "not-an-emoji")).status).toBe(400);
    const concurrent = await Promise.all([react(PLAYER), react(PLAYER), react(ADMIN)]);
    expect(concurrent.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await react(PLAYER)).body).toEqual([{ emoji: "👍", count: 2, reacted: true }]);
    expect((await react(PLAYER, "🔥")).body).toEqual(
      expect.arrayContaining([
        { emoji: "👍", count: 2, reacted: true },
        { emoji: "🔥", count: 1, reacted: true },
      ]),
    );
    await react(PLAYER, "👍", false);
    expect((await react(PLAYER, "👍", false)).body).toEqual(
      expect.arrayContaining([{ emoji: "👍", count: 1, reacted: false }]),
    );
    const reacted = (await call<ThreadDetail>(PLAYER, "GET", path)).body;
    expect(reacted.version).toBe(3);
    expect(reacted.posts[0]?.reactions).toEqual(
      expect.arrayContaining([
        { emoji: "👍", count: 1, reacted: false },
        { emoji: "🔥", count: 1, reacted: true },
      ]),
    );
    expect((await call<MessageThread[]>(ADMIN, "GET", base)).body[0]?.unread).toBe(false);
    const secondThread = await call<{ id: string }>(ADMIN, "POST", base, { title: "Other", body: "Hi" });
    expect(
      (
        await call(ADMIN, "PUT", `${base}/${secondThread.body.id}/posts/${postId}/reactions`, {
          emoji: "👍",
          active: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          ADMIN,
          "PUT",
          `/leagues/${other.body.id}/messages/${created.body.id}/posts/${postId}/reactions`,
          { emoji: "👍", active: true },
        )
      ).status,
    ).toBe(404);
    const replyPath = `${path}/posts/${detail.posts[1]?.id}/reactions`;
    expect((await call(PLAYER, "PUT", replyPath, { emoji: "😂", active: true })).status).toBe(200);
    await call(ADMIN, "DELETE", `/leagues/${leagueId}/members/${PLAYER}`);
    expect((await call(PLAYER, "GET", path)).status).toBe(404);
    expect((await react(PLAYER)).status).toBe(404);
    await call(PLAYER, "POST", `/invites/${inviteCode}/join`);
  });

  it("restricts announcement pins to admins and quotes to the same thread", async () => {
    const base = `/leagues/${leagueId}/messages`;
    const create = (title: string) =>
      call<{ id: string }>(PLAYER, "POST", base, { title, body: `${title} body` });
    const first = await create("Announcement");
    const path = `${base}/${first.body.id}`;
    const original = (await call<ThreadDetail>(ADMIN, "GET", path)).body;
    const postId = original.posts[0]?.id;
    expect(original).toMatchObject({ pinned: false, canPin: true });
    expect((await call<ThreadDetail>(PLAYER, "GET", path)).body.canPin).toBe(false);
    await call(ADMIN, "POST", `${path}/read`, { version: 1 });
    const second = await create("Newer discussion");
    const pin = (user: string, pinned: boolean) => call(user, "PUT", `${path}/pin`, { pinned });
    expect((await pin(PLAYER, true)).status).toBe(403);
    expect((await pin(OUTSIDER, true)).status).toBe(404);
    expect((await call(ADMIN, "PUT", `${path}/pin`, { pinned: "yes" })).status).toBe(400);
    expect((await pin(ADMIN, true)).status).toBe(200);
    expect((await pin(ADMIN, true)).status).toBe(200);
    const list = (await call<MessageThread[]>(ADMIN, "GET", base)).body;
    expect(list[0]).toMatchObject({
      id: first.body.id,
      pinned: true,
      unread: false,
      version: 1,
      updatedAt: original.posts[0]?.createdAt,
    });
    expect((await call<ThreadDetail>(PLAYER, "GET", path)).body.pinned).toBe(true);
    expect((await pin(ADMIN, false)).status).toBe(200);
    expect((await call<MessageThread[]>(ADMIN, "GET", base)).body[0]?.id).toBe(second.body.id);
    const reply = (quotedPostId: string) =>
      call(PLAYER, "POST", `${path}/replies`, { body: "Agreed!", quotedPostId });
    const otherPost = (await call<ThreadDetail>(PLAYER, "GET", `${base}/${second.body.id}`)).body.posts[0];
    expect((await reply(otherPost?.id ?? "")).status).toBe(404);
    expect((await reply("00000000-0000-4000-8000-000000009999")).status).toBe(404);
    expect((await reply("bad-id")).status).toBe(400);
    expect((await call<ThreadDetail>(PLAYER, "GET", path)).body.version).toBe(1);
    expect((await reply(postId ?? "")).status).toBe(201);
    const quoted = (await call<ThreadDetail>(ADMIN, "GET", path)).body;
    expect(quoted.version).toBe(2);
    expect(quoted.posts[1]).toMatchObject({
      body: "Agreed!",
      position: 2,
      quote: { id: postId, authorName: "Pat", body: "Announcement body" },
    });
    expect(quoted.posts[0]?.quote).toBeNull();
    const other = await call<{ id: string }>(ADMIN, "POST", "/leagues", { name: "Quote isolation" });
    createdLeagues.push(other.body.id);
    expect(
      (await call(ADMIN, "PUT", `/leagues/${other.body.id}/messages/${first.body.id}/pin`, { pinned: true }))
        .status,
    ).toBe(404);
    const foreign = await call<{ id: string }>(ADMIN, "POST", `/leagues/${other.body.id}/messages`, {
      title: "Private",
      body: "Other league only",
    });
    const foreignPost = (
      await call<ThreadDetail>(ADMIN, "GET", `/leagues/${other.body.id}/messages/${foreign.body.id}`)
    ).body.posts[0];
    expect((await reply(foreignPost?.id ?? "")).status).toBe(404);
    expect(
      (await call(OUTSIDER, "POST", `${path}/replies`, { body: "No access", quotedPostId: postId })).status,
    ).toBe(404);
  });

  it("allows only active league admins to delete entire threads and their queued notifications", async () => {
    await settle();
    const league = (await call<{ id: string }>(ADMIN, "POST", "/leagues", { name: "Thread deletion" })).body;
    createdLeagues.push(league.id);
    const invite = (await call<LeagueDetail>(ADMIN, "GET", `/leagues/${league.id}`)).body.inviteCode;
    await call(PLAYER, "POST", `/invites/${invite}/join`);
    const base = `/leagues/${league.id}/messages`;
    // Leave emails pending so deletion is checked before a background sender handles them.
    const queuedCall = callOn(
      createApp({ db, verifyToken, publicConfig, nfl: noGames, email, now: () => now, background: () => {} }),
    );
    const created = await queuedCall<{ id: string }>(PLAYER, "POST", base, {
      title: "Remove this",
      body: "Opening post",
    });
    const id = created.body.id;
    const path = `${base}/${id}`;
    const kept = await queuedCall<{ id: string }>(PLAYER, "POST", base, {
      title: "Keep this",
      body: "Unrelated post",
    });
    const original = (await call<ThreadDetail>(ADMIN, "GET", path)).body;
    expect(original.canDelete).toBe(true);
    expect((await call<ThreadDetail>(PLAYER, "GET", path)).body.canDelete).toBe(false);
    const postId = original.posts[0]?.id ?? "";
    await call(ADMIN, "PUT", `${path}/pin`, { pinned: true });
    await call(ADMIN, "POST", `${path}/replies`, { body: "Quoted reply", quotedPostId: postId });
    await call(ADMIN, "POST", `${path}/read`, { version: 2 });
    await call(PLAYER, "PUT", `${path}/posts/${postId}/reactions`, { emoji: "👍", active: true });
    expect((await outboxFor(id))?.status).toBe("pending");
    expect((await app.request(`/api${path}`, { method: "DELETE" })).status).toBe(401);
    // Even the author cannot delete a thread without the admin role.
    expect((await call(PLAYER, "DELETE", path)).status).toBe(403);
    expect((await call(OUTSIDER, "DELETE", path)).status).toBe(404);
    expect((await call(ADMIN, "DELETE", `/leagues/${leagueId}/messages/${id}`)).status).toBe(404);
    expect((await call(ADMIN, "DELETE", `${base}/not-a-uuid`)).status).toBe(404);
    expect((await call(ADMIN, "DELETE", `${base}/00000000-0000-4000-8000-000000009999`)).status).toBe(404);
    await call(ADMIN, "PATCH", `/leagues/${league.id}/members/${PLAYER}`, { role: "admin" });
    expect((await call<ThreadDetail>(PLAYER, "GET", path)).body.canDelete).toBe(true);
    await call(ADMIN, "DELETE", `/leagues/${league.id}/members/${PLAYER}`);
    expect((await call(PLAYER, "DELETE", path)).status).toBe(404);
    await call(PLAYER, "POST", `/invites/${invite}/join`);
    await call(ADMIN, "PATCH", `/leagues/${league.id}/members/${PLAYER}`, { role: "admin" });
    const posts = (await call<ThreadDetail>(ADMIN, "GET", path)).body.posts;
    const [subscription] = await db
      .insert(pushSubscriptions)
      .values({ userId: ADMIN, endpoint: `https://push.example.test/${id}`, p256dh: "test", auth: "test" })
      .returning();
    expect(subscription).toBeDefined();
    if (!subscription) return;
    try {
      await db.insert(pushDeliveries).values({
        subscriptionId: subscription.id,
        leagueId: league.id,
        threadId: id,
        kind: "new_thread",
        eventKey: id,
        expiresAt: new Date(now.getTime() + 60_000),
      });
      // A second admin can delete a pinned thread, including one they authored.
      expect((await call(PLAYER, "DELETE", path)).status).toBe(200);
      expect((await call(ADMIN, "GET", path)).status).toBe(404);
      expect((await call(ADMIN, "DELETE", path)).status).toBe(404);
      expect((await call(ADMIN, "POST", `${path}/replies`, { body: "Too late" })).status).toBe(404);
      expect((await call(ADMIN, "POST", `${path}/read`, { version: 2 })).status).toBe(404);
      expect(
        (await call(ADMIN, "PUT", `${path}/posts/${postId}/reactions`, { emoji: "👍", active: true })).status,
      ).toBe(404);
      expect((await call<MessageThread[]>(ADMIN, "GET", base)).body.map((t) => t.id)).toEqual([kept.body.id]);
      expect(await db.select().from(messagePosts).where(eq(messagePosts.threadId, id))).toEqual([]);
      expect(await db.select().from(messageReads).where(eq(messageReads.threadId, id))).toEqual([]);
      expect(
        await db
          .select()
          .from(messageReactions)
          .where(
            inArray(
              messageReactions.postId,
              posts.map((p) => p.id),
            ),
          ),
      ).toEqual([]);
      expect(await db.select().from(pushDeliveries).where(eq(pushDeliveries.threadId, id))).toEqual([]);
      expect(await outboxFor(id)).toBeUndefined();
      expect((await outboxFor(kept.body.id))?.status).toBe("pending");
      // Admins can also remove another member's unpinned thread.
      expect((await call(ADMIN, "DELETE", `${base}/${kept.body.id}`)).status).toBe(200);
    } finally {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
      await db.delete(leagues).where(eq(leagues.id, league.id));
    }
  });

  it("emails other members about a new thread, and honors one-click unsubscribe", async () => {
    await settle();
    sentEmails = [];
    const base = `/leagues/${leagueId}/messages`;
    const created = await call<{ id: string }>(PLAYER, "POST", base, {
      title: "Trade <talk>",
      body: "Who's taking the <b>Chiefs</b> this week?",
    });
    await settle();
    // The author and outsiders get nothing; the other member gets one email.
    expect(emailsTo(PLAYER)).toEqual([]);
    expect(emailsTo(OUTSIDER)).toEqual([]);
    const [email] = emailsTo(ADMIN);
    expect(sentEmails).toHaveLength(1);
    expect(email?.subject).toBe("Test League: Trade <talk>");
    expect(email?.html).toContain("Trade &lt;talk&gt;");
    expect(email?.html).toContain("&lt;b&gt;Chiefs&lt;/b&gt;");
    expect(email?.html).not.toContain("<b>Chiefs");
    expect(email?.text).toContain(`https://picks.test${base}/${created.body.id}`);
    expect(email?.listUnsubscribeUrl).toMatch(/^https:\/\/picks\.test\/api\/unsubscribe\?token=/);

    // A tampered or missing token changes nothing.
    const url = new URL(email?.listUnsubscribeUrl ?? "");
    const token = url.searchParams.get("token") ?? "";
    const unsubscribe = (query: string) =>
      app.request(`/api/unsubscribe?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      });
    expect((await unsubscribe(`token=${encodeURIComponent(token.replace(/.$/, "x"))}`)).status).toBe(400);
    expect(
      (await unsubscribe(`token=${encodeURIComponent(token.replace("new_thread", "pick_reminder"))}`)).status,
    ).toBe(400);
    expect((await unsubscribe("")).status).toBe(400);
    // The mail client's one-click POST turns new-thread emails off, and only those.
    const res = await unsubscribe(url.search.slice(1));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "new_thread" });
    expect((await call<Me>(ADMIN, "GET", "/me")).body.notifications).toEqual({
      newThreads: false,
      pickReminders: true,
      leagueEvents: true,
    });

    sentEmails = [];
    await call(PLAYER, "POST", base, { title: "Quiet", body: "Nobody gets this." });
    await settle();
    expect(sentEmails).toEqual([]);

    // The settings screen turns it back on; the web page's form of unsubscribe (no body) works too.
    expect((await call(ADMIN, "PUT", "/me/notifications", {})).status).toBe(400);
    expect((await call(ADMIN, "PUT", "/me/notifications", { newThreads: true })).body).toEqual({
      newThreads: true,
      pickReminders: true,
      leagueEvents: true,
    });
    // A player without a profile has no settings to change.
    await db.delete(profiles).where(eq(profiles.userId, OUTSIDER));
    expect((await call(OUTSIDER, "PUT", "/me/notifications", { newThreads: true })).status).toBe(409);
    await call(OUTSIDER, "PUT", "/me", { displayName: "Newcomer", acceptTerms: true });
    const fromPage = await app.request(`/api/unsubscribe?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
    expect(fromPage.status).toBe(200);
    await call(ADMIN, "PUT", "/me/notifications", { newThreads: true });
  });

  it("retries an email the provider couldn't take, and gives up on one it rejected", async () => {
    await settle();
    const base = `/leagues/${leagueId}/messages`;

    mailerError = new EmailSendError("E_RATE_LIMIT_EXCEEDED", "retry");
    const flaky = await call<{ id: string }>(PLAYER, "POST", base, { title: "Flaky", body: "Retry me." });
    await settle();
    expect(await outboxFor(flaky.body.id)).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "E_RATE_LIMIT_EXCEEDED",
    });

    mailerError = new EmailSendError("E_RECIPIENT_SUPPRESSED", "rejected");
    const rejected = await call<{ id: string }>(PLAYER, "POST", base, { title: "Bad", body: "Rejected." });
    await settle();
    expect(await outboxFor(rejected.body.id)).toMatchObject({
      status: "failed",
      lastError: "E_RECIPIENT_SUPPRESSED",
    });

    // The next job run after the backoff sends the retry.
    mailerError = undefined;
    sentEmails = [];
    const saved = now;
    now = new Date(now.getTime() + 6 * 60_000);
    await runJobs();
    now = saved;
    expect(emailsTo(ADMIN).map((m) => m.subject)).toEqual(["Test League: Flaky"]);
    expect(await outboxFor(flaky.body.id)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("stops at the daily and monthly budget, holds the rest for tomorrow, and backs off on the provider's quota", async () => {
    await settle();
    sentEmails = [];
    const base = `/leagues/${leagueId}/messages`;
    const usage = async (day: string) =>
      (await db.select().from(emailUsage).where(eq(emailUsage.day, day)))[0]?.sent ?? 0;
    // Each check reads this test's own outbox rows, never the run's totals: other rows in the shared outbox (a
    // reminder for a week an earlier test left open) may be due at the same simulated time.
    const post = async (title: string) => {
      const res = await call<{ id: string }>(PLAYER, "POST", base, { title, body: "Budget test." });
      await settle();
      return res.body.id;
    };

    try {
      // Room for exactly one more email today (Wednesday, UTC).
      limits.daily = (await usage("2026-11-11")) + 1;
      await post("Budget one");
      const held = await post("Budget two");
      expect(emailsTo(ADMIN).map((m) => m.subject)).toEqual(["Test League: Budget one"]);
      expect(await outboxFor(held)).toMatchObject({
        status: "pending",
        attempts: 0,
        lastError: "OVER_BUDGET",
        nextAttemptAt: new Date("2026-11-12T00:00:00Z"),
      });
      await runJobs(); // not due again until tomorrow
      expect(await outboxFor(held)).toMatchObject({ status: "pending", attempts: 0 });

      // Thursday (UTC): a fresh daily budget sends it.
      now = new Date("2026-11-12T00:30:00Z");
      limits.daily = 10_000;
      await runJobs();
      expect(await outboxFor(held)).toMatchObject({ status: "sent" });
      expect(emailsTo(ADMIN).map((m) => m.subject)).toContain("Test League: Budget two");

      // The month's total counts earlier days too: at the monthly limit, nothing goes out.
      const [month] = await db
        .select({ sent: sql<number>`sum(${emailUsage.sent})::int` })
        .from(emailUsage)
        // Up to the simulated today; real runs (e.g. E2E) may have rows for later November days.
        .where(between(emailUsage.day, "2026-11-01", "2026-11-12"));
      limits.monthly = month?.sent ?? 0;
      const monthly = await post("Over the month");
      expect(await outboxFor(monthly)).toMatchObject({ status: "pending", lastError: "OVER_BUDGET" });
      limits.monthly = 100_000;

      // Held past its expiry, it is dropped, and the record says why.
      now = new Date("2026-11-13T12:00:00Z");
      await runJobs();
      expect(await outboxFor(monthly)).toMatchObject({ status: "skipped", lastError: "OVER_BUDGET" });

      // The provider says its own quota is spent: the send is given back and the email waits for tomorrow
      // without using an attempt. Our count stays what was really sent, so the month isn't charged for it.
      const before = await usage("2026-11-13");
      mailerError = new EmailSendError("E_DAILY_LIMIT_EXCEEDED", "quota");
      const quota = await post("Quota");
      const again = await post("Quota again");
      mailerError = undefined;
      for (const id of [quota, again]) {
        expect(await outboxFor(id)).toMatchObject({
          status: "pending",
          attempts: 0,
          lastError: "E_DAILY_LIMIT_EXCEEDED",
          nextAttemptAt: new Date("2026-11-14T00:00:00Z"),
        });
      }
      expect(await usage("2026-11-13")).toBe(before);
      await runJobs();
      for (const id of [quota, again]) expect(await outboxFor(id)).toMatchObject({ status: "pending" });
      now = new Date("2026-11-14T00:30:00Z");
      await runJobs();
      for (const id of [quota, again]) expect(await outboxFor(id)).toMatchObject({ status: "sent" });
    } finally {
      mailerError = undefined;
      limits.daily = 10_000;
      limits.monthly = 100_000;
      now = WEDNESDAY;
    }
  });

  it("only lets the admin set up weeks", async () => {
    const res = await call(PLAYER, "POST", `/leagues/${leagueId}/weeks`, { year: 2026, number: 10 });
    expect(res.status).toBe(403);
  });

  it("lets every admin assign roles, including demoting the creator or themselves", async () => {
    const path = `/leagues/${leagueId}/members/${PLAYER}`;
    const creatorPath = `/leagues/${leagueId}/members/${ADMIN}`;
    expect((await call(PLAYER, "PATCH", path, { role: "admin" })).status).toBe(403);
    expect((await call(OUTSIDER, "PATCH", path, { role: "admin" })).status).toBe(404);
    expect((await call(ADMIN, "PATCH", path, { role: "owner" })).status).toBe(400);
    expect((await call(ADMIN, "PATCH", path, {})).status).toBe(400);
    expect(
      (await call(ADMIN, "PATCH", `/leagues/${leagueId}/members/${OUTSIDER}`, { role: "admin" })).status,
    ).toBe(404);
    expect((await call(ADMIN, "PATCH", creatorPath, { role: "member" })).status).toBe(409);
    expect((await call(ADMIN, "PATCH", creatorPath, { role: "admin" })).status).toBe(200);
    expect((await call(ADMIN, "PATCH", path, { role: "admin" })).status).toBe(200);
    expect((await call(ADMIN, "PATCH", path, { role: "admin" })).status).toBe(200);
    expect((await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`)).body).toMatchObject({
      role: "admin",
      inviteCode,
    });
    expect((await call<{ role: string }[]>(PLAYER, "GET", "/leagues")).body).toContainEqual({
      id: leagueId,
      name: "Test League",
      role: "admin",
      type: "weekly",
      management: "manual",
    });

    expect((await call(PLAYER, "PATCH", creatorPath, { role: "member" })).status).toBe(200);
    expect((await call(ADMIN, "PATCH", path, { role: "member" })).status).toBe(403);
    expect((await call(PLAYER, "PATCH", `/leagues/${leagueId}`, { name: "Test League" })).status).toBe(200);
    expect((await call(PLAYER, "PATCH", path, { role: "member" })).status).toBe(409);
    expect((await call(PLAYER, "PATCH", creatorPath, { role: "admin" })).status).toBe(200);
    expect((await call(PLAYER, "PATCH", path, { role: "member" })).status).toBe(200);
    expect((await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`)).body.role).toBe("member");
    expect((await call(PLAYER, "PATCH", `/leagues/${leagueId}`, { name: "Forbidden" })).status).toBe(403);
  });

  async function adminTestLeague() {
    const created = await call<{ id: string }>(ADMIN, "POST", "/leagues", { name: "Equal admins" });
    const id = created.body.id;
    createdLeagues.push(id);
    const detail = (await call<LeagueDetail>(ADMIN, "GET", `/leagues/${id}`)).body;
    await call(PLAYER, "POST", `/invites/${detail.inviteCode}/join`);
    await call(ADMIN, "PATCH", `/leagues/${id}/members/${PLAYER}`, { role: "admin" });
    return detail;
  }

  it("lets added admins promote others and remove the creator without restoring admin access on rejoin", async () => {
    const league = await adminTestLeague();
    try {
      await call(OUTSIDER, "POST", `/invites/${league.inviteCode}/join`);
      expect(
        (await call(PLAYER, "PATCH", `/leagues/${league.id}/members/${OUTSIDER}`, { role: "admin" })).status,
      ).toBe(200);
      expect((await call(PLAYER, "DELETE", `/leagues/${league.id}/members/${ADMIN}`)).status).toBe(200);
      expect((await call(ADMIN, "GET", `/leagues/${league.id}`)).status).toBe(404);
      expect(
        (await call(PLAYER, "PATCH", `/leagues/${league.id}/members/${ADMIN}`, { role: "admin" })).status,
      ).toBe(404);
      await call(ADMIN, "POST", `/invites/${league.inviteCode}/join`);
      expect((await call<LeagueDetail>(ADMIN, "GET", `/leagues/${league.id}`)).body.role).toBe("member");
      expect((await call(PLAYER, "DELETE", `/leagues/${league.id}/members/${OUTSIDER}`)).status).toBe(200);
      // Removed admins do not count toward the safeguard.
      expect((await call(PLAYER, "DELETE", `/leagues/${league.id}/members/${PLAYER}`)).status).toBe(409);
      expect(
        (await call(PLAYER, "PATCH", `/leagues/${league.id}/members/${PLAYER}`, { role: "member" })).status,
      ).toBe(409);
      await call(OUTSIDER, "POST", `/invites/${league.inviteCode}/join`);
      expect((await call<LeagueDetail>(OUTSIDER, "GET", `/leagues/${league.id}`)).body.role).toBe("member");
    } finally {
      await db.delete(leagues).where(eq(leagues.id, league.id));
    }
  });

  it.each([
    ["self-demotions", "PATCH", true, [200, 409]],
    ["self-removals", "DELETE", true, [200, 409]],
    ["mutual demotions", "PATCH", false, [200, 403]],
    ["mutual removals", "DELETE", false, [200, 404]],
  ] as const)("keeps one active admin during simultaneous %s", async (_, method, self, statuses) => {
    const league = await adminTestLeague();
    try {
      const results = await Promise.all(
        [ADMIN, PLAYER].map((actor, index) =>
          call(
            actor,
            method,
            `/leagues/${league.id}/members/${self ? actor : [PLAYER, ADMIN][index]}`,
            method === "PATCH" ? { role: "member" } : undefined,
          ),
        ),
      );
      expect(results.map((result) => result.status).sort()).toEqual(statuses);
      const members = await db.select().from(leagueMembers).where(eq(leagueMembers.leagueId, league.id));
      expect(members.filter((member) => member.role === "admin" && member.removedAt === null)).toHaveLength(
        1,
      );
    } finally {
      await db.delete(leagues).where(eq(leagues.id, league.id));
    }
  });

  it("imports the week's games, spreads and slot points from the provider", async () => {
    const created = await call<{ id: string; importError: string | null }>(
      ADMIN,
      "POST",
      `/leagues/${leagueId}/weeks`,
      { year: 2026, number: 10 },
    );
    expect(created).toMatchObject({ status: 201, body: { importError: null } });
    weekId = created.body.id;

    const view = (await call<WeekView>(ADMIN, "GET", `/weeks/${weekId}`)).body;
    expect(view.status).toBe("draft");
    expect(view.games.map((g) => [g.awayTeam, g.homeTeam, g.spread, g.points])).toEqual([
      ["WSH", "NYG", -2.5, 3],
      ["KC", "ATL", 3.5, 1],
      ["LAC", "BAL", null, 3],
    ]);
    const [thu, sun, mon] = view.games.map((g) => g.id);
    game = { thu: thu ?? "", sun: sun ?? "", mon: mon ?? "" };
    // The Monday night game is the tiebreaker.
    expect(view.tiebreakerGameId).toBe(game.mon);

    expect((await call(ADMIN, "POST", `/leagues/${leagueId}/weeks`, { year: 2026, number: 10 })).status).toBe(
      409,
    );

    // A game flexed into Sunday night by the schedule takes the new slot's points, and moves back with it.
    const original = provided;
    const pointsOf = (v: WeekView) => v.games.find((g) => g.id === game.sun)?.points;
    provided = original.map((g) =>
      g.externalId === "t2" ? { ...g, kickoff: new Date("2026-11-16T01:20:00Z") } : g,
    );
    expect(pointsOf((await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/import`)).body)).toBe(2);
    provided = original;
    expect(pointsOf((await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/import`)).body)).toBe(1);
    // Importing twice adds nothing.
    expect((await call<WeekView>(ADMIN, "GET", `/weeks/${weekId}`)).body.games).toHaveLength(3);
  });

  it("keeps a draft week hidden from members", async () => {
    expect((await call(PLAYER, "GET", `/weeks/${weekId}`)).status).toBe(404);
    expect((await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`)).body.weeks).toEqual([]);
    expect((await call<LeagueDetail>(ADMIN, "GET", `/leagues/${leagueId}`)).body.weeks).toMatchObject([
      { id: weekId, year: 2026, number: 10, status: "draft" },
    ]);
  });

  it("gives an added admin draft and week management access, and revokes it immediately", async () => {
    const path = `/leagues/${leagueId}/members/${PLAYER}`;
    await call(ADMIN, "PATCH", path, { role: "admin" });
    const view = await call<WeekView>(PLAYER, "GET", `/weeks/${weekId}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ role: "admin", status: "draft", results: null });
    expect((await call(PLAYER, "PATCH", `/games/${game.thu}`, { points: 3 })).status).toBe(200);
    // Revoking access changes permissions without changing membership or picks.
    await call(ADMIN, "PATCH", path, { role: "member" });
    expect((await call(PLAYER, "GET", `/weeks/${weekId}`)).status).toBe(404);
    expect((await call(PLAYER, "PATCH", `/games/${game.thu}`, { points: 3 })).status).toBe(404);
  });

  it("lets the admin add, edit and remove games", async () => {
    expect((await call(ADMIN, "POST", `/weeks/${weekId}/open`)).status).toBe(409); // Monday has no spread yet

    const edited = await call<WeekView>(ADMIN, "PATCH", `/games/${game.mon}`, { spread: -4.5, points: 5 });
    expect(edited.body.games.find((g) => g.id === game.mon)).toMatchObject({ spread: -4.5, points: 5 });
    await call(ADMIN, "PATCH", `/games/${game.mon}`, { points: 3 });

    const added = await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/games`, {
      homeTeam: "DAL",
      awayTeam: "SF",
      kickoff: "2026-11-15T21:25:00Z",
      spread: 3,
    });
    expect(added.status).toBe(201);
    const extra = added.body.games.find((g) => g.homeTeam === "DAL");
    expect(extra).toMatchObject({ points: 1, spread: 3 });

    // Moving the kickoff to another slot moves a default value with it; one the admin set by hand stays.
    const pointsAfter = async (change: object) =>
      (await call<WeekView>(ADMIN, "PATCH", `/games/${extra?.id}`, change)).body.games.find(
        (g) => g.id === extra?.id,
      )?.points;
    expect(await pointsAfter({ kickoff: "2026-11-16T01:20:00Z" })).toBe(2); // Sunday night
    expect(await pointsAfter({ kickoff: "2026-11-15T21:25:00Z" })).toBe(1);
    expect(await pointsAfter({ points: 4 })).toBe(4);
    expect(await pointsAfter({ kickoff: "2026-11-16T01:20:00Z" })).toBe(4);
    expect(await pointsAfter({ kickoff: "2026-11-15T21:25:00Z", points: 2 })).toBe(2);

    const removed = await call<WeekView>(ADMIN, "DELETE", `/games/${extra?.id}`);
    expect(removed.body.games).toHaveLength(3);

    expect((await call(PLAYER, "PATCH", `/games/${game.mon}`, { spread: 10 })).status).toBe(404);
    expect((await call(ADMIN, "PATCH", `/games/${game.mon}`, { spread: 1.25 })).status).toBe(400);
  });

  it("opens the week for picks", async () => {
    expect((await call(ADMIN, "PUT", `/weeks/${weekId}/picks`, picksBody({}))).status).toBe(409);
    expect((await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/open`)).body.status).toBe("open");
    expect((await call<WeekView>(PLAYER, "GET", `/weeks/${weekId}`)).body.status).toBe("open");
  });

  const picksBody = (input: {
    picks?: Partial<Record<"thu" | "sun" | "mon", "home" | "away">>;
    pow?: "thu" | "sun" | "mon" | null;
    total?: number | null;
  }) => ({
    picks: Object.entries(input.picks ?? {}).map(([key, side]) => ({ gameId: game[key as "thu"], side })),
    powGameId: input.pow ? game[input.pow] : null,
    tiebreakerTotal: input.total ?? null,
  });

  it("gives members a game's stats and prediction, and nothing when the source is down", async () => {
    const path = `/games/${game.thu}/insights`;
    const res = await call<GameInsights>(PLAYER, "GET", path);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      matchup: expect.objectContaining({
        url: "https://example.test/t1",
        prediction: { home: 0.6, away: 0.39 },
      }),
    });
    expect((await call(OUTSIDER, "GET", path)).status).toBe(404);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    insightsDown = true;
    const down = await call<GameInsights>(PLAYER, "GET", path);
    insightsDown = false;
    expect(down.status).toBe(200);
    expect(down.body).toEqual({ matchup: null });
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("saves picks, a POW and a tiebreaker guess", async () => {
    // The admin takes the home team on Thursday (POW) and Sunday, and guesses 41.
    const saved = await call<WeekView>(
      ADMIN,
      "PUT",
      `/weeks/${weekId}/picks`,
      picksBody({ picks: { thu: "home", sun: "home" }, pow: "thu", total: 41 }),
    );
    expect(saved.status).toBe(200);
    expect(saved.body.myTiebreakerTotal).toBe(41);
    expect(saved.body.myPicks).toEqual(
      expect.arrayContaining([
        { gameId: game.thu, side: "home", isPow: true },
        { gameId: game.sun, side: "home", isPow: false },
      ]),
    );

    // Early in the week both the pick and the POW can still move.
    const changed = await call<WeekView>(
      ADMIN,
      "PUT",
      `/weeks/${weekId}/picks`,
      picksBody({ picks: { sun: "away" }, pow: "sun", total: 41 }),
    );
    expect(changed.body.myPicks).toEqual(
      expect.arrayContaining([
        { gameId: game.thu, side: "home", isPow: false },
        { gameId: game.sun, side: "away", isPow: true },
      ]),
    );
    await call(
      ADMIN,
      "PUT",
      `/weeks/${weekId}/picks`,
      picksBody({ picks: { sun: "home" }, pow: "thu", total: 41 }),
    );
  });

  it("emails reminders the evening before a game day to players with games still to pick", async () => {
    sentEmails = [];

    // Wednesday noon: Thursday's reminder isn't due until 7pm.
    expect((await runJobs()).body.queued).toBe(0);

    // 7:05pm Eastern on Wednesday. The admin picked Thursday's game; the player hasn't.
    now = new Date("2026-11-12T00:05:00Z");
    expect((await runJobs()).body).toMatchObject({ queued: 1, sent: 1 });
    expect(emailsTo(ADMIN)).toEqual([]);
    const [reminder] = emailsTo(PLAYER);
    expect(reminder?.subject).toBe("Test League: 1 game to pick for Thursday");
    expect(reminder?.text).toContain("Hi Pat");
    expect(reminder?.text).toContain("Commanders at Giants, 8:15 PM EST");
    expect(reminder?.text).toContain(`https://picks.test/weeks/${weekId}`);
    expect(reminder?.listUnsubscribeUrl).toContain("/api/unsubscribe?token=");

    // Running again (the Cron Trigger runs every five minutes) sends nothing new.
    expect((await runJobs()).body).toMatchObject({ queued: 0, sent: 0 });
    expect(sentEmails).toHaveLength(1);

    // Saturday evening, for Sunday: the admin has picked it, and the player has turned reminders off.
    await call(PLAYER, "PUT", "/me/notifications", { pickReminders: false });
    now = new Date("2026-11-15T01:00:00Z");
    expect((await runJobs()).body.queued).toBe(0);
    await call(PLAYER, "PUT", "/me/notifications", { pickReminders: true });
    expect((await runJobs()).body.queued).toBe(1);
    expect(emailsTo(PLAYER).at(-1)?.subject).toBe("Test League: 1 game to pick for Sunday");
    now = WEDNESDAY;
  });

  it("locks each game at kickoff", async () => {
    now = SUNDAY_7AM;
    const put = (user: string, input: Parameters<typeof picksBody>[0]) =>
      call<WeekView>(user, "PUT", `/weeks/${weekId}/picks`, picksBody(input));

    // Thursday has been played: the admin's pick there can't change, and their POW is stuck on it.
    const locked = await put(ADMIN, { picks: { thu: "away" }, pow: "thu", total: 41 });
    expect(locked.status).toBe(409);
    expect(errorOf(locked)).toMatch(/already kicked off/);
    expect(errorOf(await put(ADMIN, { pow: "mon", picks: { mon: "home" }, total: 41 }))).toMatch(
      /can't be moved or removed/,
    );
    expect(errorOf(await put(ADMIN, { pow: null, total: 41 }))).toMatch(/can't be moved or removed/);
    // Their Sunday pick and tiebreaker guess can still change on game day.
    expect((await put(ADMIN, { picks: { sun: "away" }, pow: "thu", total: 44 })).status).toBe(200);
    expect((await put(ADMIN, { picks: { sun: "home" }, pow: "thu", total: 41 })).status).toBe(200);

    // The player is late: Thursday is gone and can't take the POW, but Sunday can on game day.
    expect(errorOf(await put(PLAYER, { picks: { thu: "away" } }))).toMatch(/already kicked off/);
    expect((await put(PLAYER, { picks: { sun: "away" }, pow: "sun" })).status).toBe(200);
    // Until Sunday kicks off, the POW can still move to Monday.
    const late = await put(PLAYER, { picks: { sun: "away", mon: "home" }, pow: "mon", total: 50 });
    expect(late.status).toBe(200);
    expect(late.body.myPicks).toHaveLength(2);
    expect(late.body.myPicks.find((p) => p.isPow)?.gameId).toBe(game.mon);

    // A rejected submission saves nothing.
    const adminView = (await call<WeekView>(ADMIN, "GET", `/weeks/${weekId}`)).body;
    expect(adminView.myPicks).toHaveLength(2);
  });

  it("closes a game to picks as soon as it has a result, even before kickoff", async () => {
    // Monday hasn't kicked off, but the admin has entered its score.
    await call(ADMIN, "PATCH", `/games/${game.mon}`, { homeScore: 27, awayScore: 20 });
    const put = (user: string, input: Parameters<typeof picksBody>[0]) =>
      call<WeekView>(user, "PUT", `/weeks/${weekId}/picks`, picksBody(input));

    const changed = await put(PLAYER, { picks: { mon: "away" }, pow: "mon", total: 50 });
    expect(changed.status).toBe(409);
    expect(errorOf(changed)).toMatch(/LAC at BAL is final/);
    expect(errorOf(await put(ADMIN, { picks: { mon: "home" }, pow: "thu", total: 41 }))).toMatch(/is final/);
    expect(errorOf(await put(PLAYER, { pow: "mon", total: 47 }))).toMatch(/tiebreaker game is final/);

    // Clearing the result reopens it.
    await call(ADMIN, "PATCH", `/games/${game.mon}`, { homeScore: null, awayScore: null });
    expect((await put(PLAYER, { picks: { mon: "home" }, pow: "mon", total: 50 })).status).toBe(200);
  });

  it("tells each player how many games they have picked", async () => {
    const weeks = (await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`)).body.weeks;
    expect(weeks).toMatchObject([{ id: weekId, status: "open", gameCount: 3, myPickCount: 2 }]);
  });

  it("hides other players' picks while the week is open", async () => {
    const playerView = (await call<WeekView>(PLAYER, "GET", `/weeks/${weekId}`)).body;
    expect(playerView.results).toBeNull();
    expect(playerView.submissions).toBeNull();
    expect(JSON.stringify(playerView)).not.toContain(ADMIN);

    // The admin sees who has picked, but not what.
    const adminView = (await call<WeekView>(ADMIN, "GET", `/weeks/${weekId}`)).body;
    expect(adminView.results).toBeNull();
    expect(adminView.submissions).toEqual([
      { userId: ADMIN, displayName: "Commish", pickCount: 2, hasPow: true },
      { userId: PLAYER, displayName: "Pat", pickCount: 2, hasPow: true },
    ]);

    const standings = (await call<Standings>(PLAYER, "GET", `/leagues/${leagueId}/standings`)).body;
    expect(standings.weeks).toEqual([]);
    expect(standings.entries.every((e) => e.points === 0)).toBe(true);
  });

  it("fills in results as games end, without overwriting a score the admin typed", async () => {
    const scores = async (user = PLAYER) =>
      (await call<WeekView>(user, "GET", `/weeks/${weekId}`)).body.games.map((g) => [
        g.homeScore,
        g.awayScore,
        g.spread,
      ]);
    const later = (ms: number) => {
      now = new Date(now.getTime() + ms);
    };
    // Sunday morning: Thursday's game is over but has no result yet.
    later(RESULTS_REFRESH_MS);
    await scores();
    const calls = providerCalls;

    // ESPN reports it final (NYG -2.5 wins by 7), with a line that has moved. Reads within the same minute
    // reuse the last fetch, however many players are looking.
    provided = provided.map((g) =>
      g.externalId === "t1" ? { ...g, spread: -7, homeScore: 24, awayScore: 17 } : g,
    );
    expect((await scores())[0]).toEqual([null, null, -2.5]);
    expect((await scores(ADMIN))[0]).toEqual([null, null, -2.5]);
    expect(providerCalls).toBe(calls);

    // An outage is logged once, remembered for the minute, and changes nothing.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    providerDown = true;
    later(RESULTS_REFRESH_MS);
    const down = await call<WeekView>(PLAYER, "GET", `/weeks/${weekId}`);
    providerDown = false;
    expect(down.status).toBe(200);
    expect(down.body.games[0]?.homeScore).toBeNull();
    expect((await scores())[0]).toEqual([null, null, -2.5]);
    expect(providerCalls).toBe(calls + 1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("results_autosync");
    log.mockRestore();

    // A minute on, the result is there for every player. The spread stays as the league set it, and other
    // players' picks stay private.
    later(RESULTS_REFRESH_MS);
    const view = (await call<WeekView>(PLAYER, "GET", `/weeks/${weekId}`)).body;
    expect(view.games.map((g) => [g.homeScore, g.awayScore, g.spread])).toEqual([
      [24, 17, -2.5],
      [null, null, 3.5],
      [null, null, -4.5],
    ]);
    expect(view.results).toBeNull();
    expect(JSON.stringify(view)).not.toContain(ADMIN);

    // With nothing else over yet (Sunday's game hasn't kicked off), the provider isn't asked again.
    const settled = providerCalls;
    later(RESULTS_REFRESH_MS);
    await scores();
    expect(providerCalls).toBe(settled);

    // A score the admin types in stands, even when the provider disagrees.
    await call(ADMIN, "PATCH", `/games/${game.thu}`, { homeScore: 21, awayScore: 17 });
    later(RESULTS_REFRESH_MS);
    expect((await scores())[0]).toEqual([21, 17, -2.5]);
    now = SUNDAY_7AM;
  });

  it("pulls results from the provider and closes the week", async () => {
    expect((await call(ADMIN, "POST", `/weeks/${weekId}/finalize`)).status).toBe(409); // no scores yet
    expect((await call(PLAYER, "POST", `/weeks/${weekId}/results`)).status).toBe(403);

    // Thursday: NYG (-2.5) wins by 7. Sunday: ATL (+3.5) loses by 10. Monday is still being played.
    // The provider's lines have moved since the week opened; players' spreads must not follow them.
    provided = provided.map((g) =>
      g.externalId === "t1"
        ? { ...g, spread: -7, homeScore: 24, awayScore: 17 }
        : g.externalId === "t2"
          ? { ...g, spread: 1, homeScore: 10, awayScore: 20 }
          : { ...g, spread: -6 },
    );
    const synced = (await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/results`)).body;
    expect(synced.games.map((g) => [g.homeScore, g.awayScore, g.spread])).toEqual([
      [24, 17, -2.5],
      [10, 20, 3.5],
      [null, null, -4.5],
    ]);
    expect((await call(ADMIN, "POST", `/weeks/${weekId}/finalize`)).status).toBe(409);

    // The admin enters Monday by hand: BAL (-4.5) wins 27–20, total 47.
    expect((await call(ADMIN, "PATCH", `/games/${game.mon}`, { homeScore: 27 })).status).toBe(400);
    await call(ADMIN, "PATCH", `/games/${game.mon}`, { homeScore: 27, awayScore: 20 });
    const awaiting = (await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`)).body.weeks.find(
      (week) => week.id === weekId,
    );
    expect(awaiting).toMatchObject({
      status: "open",
      phase: "awaiting",
      availablePickCount: 0,
      myAvailablePickCount: 0,
      myMissingPickCount: 0,
    });
    expect((await call<WeekView>(PLAYER, "GET", `/weeks/${weekId}`)).body.results).toBeNull();
    const recapOf = async (user: string) =>
      (await call<LeagueDetail>(user, "GET", `/leagues/${leagueId}`)).body.recapWeekId;
    expect(await recapOf(PLAYER)).toBeNull();
    // Marking a week that hasn't closed changes nothing.
    expect((await call(PLAYER, "POST", `/weeks/${weekId}/recap/seen`)).status).toBe(200);
    const closed = await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/finalize`);
    expect(closed.body.status).toBe("final");

    // The player is offered the recap until they have been shown it; the admin saw the results on closing.
    expect(await recapOf(ADMIN)).toBeNull();
    expect(await recapOf(PLAYER)).toBe(weekId);
    expect((await call(OUTSIDER, "POST", `/weeks/${weekId}/recap/seen`)).status).toBe(404);
    expect((await call(PLAYER, "POST", `/weeks/${weekId}/recap/seen`)).status).toBe(200);
    expect(await recapOf(PLAYER)).toBeNull();
    expect(closed.body.games.map((g) => g.spread)).toEqual([-2.5, 3.5, -4.5]);
  });

  it("reveals everyone's picks and the winner once the week is final", async () => {
    const view = (await call<WeekView>(PLAYER, "GET", `/weeks/${weekId}`)).body;
    // Admin: Thursday home wins (3 + 5 POW), Sunday home loses → 8.
    // Player: Sunday away wins (1), Monday home wins (3 + 5, the Monday POW chosen on Sunday morning) → 9.
    expect(view.results?.entries).toMatchObject([
      {
        displayName: "Pat",
        points: 9,
        wins: 2,
        losses: 0,
        powGameId: game.mon,
        powWon: true,
        isWinner: true,
      },
      {
        displayName: "Commish",
        points: 8,
        wins: 1,
        losses: 1,
        powGameId: game.thu,
        powWon: true,
        isWinner: false,
      },
    ]);
    expect(view.results?.picks).toHaveLength(4);

    // No more picks or edits once the week is closed.
    expect((await call(PLAYER, "PUT", `/weeks/${weekId}/picks`, picksBody({}))).status).toBe(409);
    expect((await call(ADMIN, "PATCH", `/games/${game.mon}`, { spread: 1 })).status).toBe(409);
  });

  it("builds season standings from final weeks", async () => {
    const standings = (await call<Standings>(PLAYER, "GET", `/leagues/${leagueId}/standings`)).body;
    expect(standings).toMatchObject({
      years: [2026],
      year: 2026,
      weeks: [{ id: weekId, number: 10, winners: ["Pat"], lowPointLosers: ["Commish"] }],
      entries: [
        { displayName: "Pat", points: 9, wins: 2, powWins: 1, mondayWins: 1, weeksWon: 1, rank: 1 },
        { displayName: "Commish", points: 8, wins: 1, powWins: 1, mondayWins: 0, weeksWon: 0, rank: 2 },
      ],
    });
  });

  it("adds week-by-week results, POW records and pick splits to the standings", async () => {
    const standings = (await call<Standings>(PLAYER, "GET", `/leagues/${leagueId}/standings`)).body;
    expect(standings.weeks).toMatchObject([{ topPoints: 9, averagePoints: 8.5 }]);
    const [pat, commish] = standings.entries;
    // Pat took the road favorite on Sunday (ATL +3.5 at home) and BAL -4.5 on Monday: both won.
    expect(pat).toMatchObject({
      weekly: [{ points: 9, rank: 1, isWinner: true }],
      powLosses: 0,
      rankChange: null,
      splits: {
        favorite: { wins: 2, losses: 0, pushes: 0 },
        underdog: { wins: 0, losses: 0, pushes: 0 },
        home: { wins: 1, losses: 0, pushes: 0 },
        away: { wins: 1, losses: 0, pushes: 0 },
      },
    });
    // The commissioner won with NYG -2.5 at home and lost with the home dog ATL.
    expect(commish?.splits).toEqual({
      favorite: { wins: 1, losses: 0, pushes: 0 },
      underdog: { wins: 0, losses: 1, pushes: 0 },
      home: { wins: 1, losses: 1, pushes: 0 },
      away: { wins: 0, losses: 0, pushes: 0 },
    });
  });

  it("keeps past results steady when membership changes", async () => {
    const membership = (userId: string) =>
      and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId));
    const names = async () => {
      const week = (await call<WeekView>(ADMIN, "GET", `/weeks/${weekId}`)).body;
      const standings = (await call<Standings>(ADMIN, "GET", `/leagues/${leagueId}/standings`)).body;
      return {
        week: week.results?.entries.map((e) => e.displayName),
        season: standings.entries.map((e) => [e.displayName, e.points, e.removed]),
        winners: standings.weeks[0]?.winners,
      };
    };

    // Someone who joins after the week was played is in the league, but not in that week's results.
    await call(OUTSIDER, "PUT", "/me", { displayName: "Newcomer", acceptTerms: true });
    await call(OUTSIDER, "POST", `/invites/${inviteCode}/join`);
    await db
      .update(leagueMembers)
      .set({ joinedAt: new Date("2026-12-01T00:00:00Z") })
      .where(membership(OUTSIDER));
    expect(await names()).toEqual({
      week: ["Pat", "Commish"],
      season: [
        ["Pat", 9, false],
        ["Commish", 8, false],
        ["Newcomer", 0, false],
      ],
      winners: ["Pat"],
    });

    // The week's winner is removed afterwards: they lose access but keep the win.
    expect((await call(ADMIN, "DELETE", `/leagues/${leagueId}/members/${PLAYER}`)).status).toBe(200);
    await db
      .update(leagueMembers)
      .set({ removedAt: new Date("2026-12-01T00:00:00Z") })
      .where(membership(PLAYER));
    expect((await call(PLAYER, "GET", `/leagues/${leagueId}`)).status).toBe(404);
    expect((await call(PLAYER, "GET", `/weeks/${weekId}`)).status).toBe(404);
    expect((await call<unknown[]>(PLAYER, "GET", "/leagues")).body).toEqual([]);
    const detail = (await call<LeagueDetail>(ADMIN, "GET", `/leagues/${leagueId}`)).body;
    expect(detail.members.map((m) => m.displayName)).toEqual(["Commish", "Newcomer"]);
    expect(await names()).toMatchObject({
      week: ["Pat", "Commish"],
      season: [
        ["Pat", 9, true],
        ["Commish", 8, false],
        ["Newcomer", 0, false],
      ],
      winners: ["Pat"],
    });

    // The week recorded its players when it closed, so even rewriting the membership history changes nothing.
    await db
      .update(leagueMembers)
      .set({ removedAt: new Date("2026-11-14T00:00:00Z") })
      .where(membership(PLAYER));
    expect(await names()).toMatchObject({ week: ["Pat", "Commish"], winners: ["Pat"] });

    // A week closed before players were recorded is worked out from the history instead: removed before the
    // week finished, Pat would not be in it.
    const recorded = await db.select().from(weekParticipants).where(eq(weekParticipants.weekId, weekId));
    expect(recorded.map((r) => r.userId).sort()).toEqual([ADMIN, PLAYER].sort());
    await db.delete(weekParticipants).where(eq(weekParticipants.weekId, weekId));
    expect(await names()).toMatchObject({ week: ["Commish"], winners: ["Commish"] });

    // Rejoining through the invite link restores access, and there the weeks they picked in.
    expect((await call(PLAYER, "POST", `/invites/${inviteCode}/join`)).status).toBe(200);
    expect((await call(PLAYER, "GET", `/leagues/${leagueId}`)).status).toBe(200);
    expect(await names()).toMatchObject({ week: ["Pat", "Commish"], winners: ["Pat"] });
    await db.insert(weekParticipants).values(recorded);
    await call(ADMIN, "DELETE", `/leagues/${leagueId}/members/${OUTSIDER}`);
  });

  it("keeps a closed week's players through leaving and rejoining, and a second close only adds", async () => {
    const before = now;
    now = WEDNESDAY;
    const created = await call<{ id: string }>(ADMIN, "POST", "/leagues", { name: "Recorded weeks" });
    const id = created.body.id;
    createdLeagues.push(id);
    const code = (await call<LeagueDetail>(ADMIN, "GET", `/leagues/${id}`)).body.inviteCode;
    await call(PLAYER, "POST", `/invites/${code}/join`);
    const week = await call<{ id: string }>(ADMIN, "POST", `/leagues/${id}/weeks`, {
      year: 2026,
      number: 1,
      importGames: false,
    });
    const recordedWeek = week.body.id;
    const addGame = async (homeTeam: string, awayTeam: string, kickoff: Date, spread: number) =>
      (
        await call<WeekView>(ADMIN, "POST", `/weeks/${recordedWeek}/games`, {
          homeTeam,
          awayTeam,
          kickoff: kickoff.toISOString(),
          spread,
        })
      ).body.games.find((g) => g.homeTeam === homeTeam)?.id ?? "";
    const pickHome = (user: string, gameId: string) =>
      call(user, "PUT", `/weeks/${recordedWeek}/picks`, {
        picks: [{ gameId, side: "home" }],
        powGameId: null,
        tiebreakerTotal: null,
      });
    const results = async () => {
      const view = (await call<WeekView>(ADMIN, "GET", `/weeks/${recordedWeek}`)).body;
      const standings = (await call<Standings>(ADMIN, "GET", `/leagues/${id}/standings?year=2026`)).body;
      return {
        week: view.results?.entries.map((e) => [e.displayName, e.points, e.removed]),
        lowPointLosers: standings.weeks[0]?.lowPointLosers,
      };
    };

    // Commish picks the one game (1 point, covered); Pat, in the league all along, picks nothing and is the LPL.
    const sunday = await addGame("PHI", "DAL", SUN, -3);
    await call(ADMIN, "POST", `/weeks/${recordedWeek}/open`);
    expect((await pickHome(ADMIN, sunday)).status).toBe(200);
    now = new Date("2026-11-16T12:00:00Z");
    await call(ADMIN, "PATCH", `/games/${sunday}`, { homeScore: 24, awayScore: 20 });
    await call(ADMIN, "POST", `/weeks/${recordedWeek}/finalize`);
    const closed = {
      week: [
        ["Commish", 1, false],
        ["Pat", 0, false],
      ],
      lowPointLosers: ["Pat"],
    };
    expect(await results()).toEqual(closed);

    // Pat leaves and rejoins. The new join date is after the week, but the week still has them, still last.
    expect((await call(PLAYER, "DELETE", `/leagues/${id}/members/${PLAYER}`)).status).toBe(200);
    expect((await call(PLAYER, "POST", `/invites/${code}/join`)).status).toBe(200);
    expect(await results()).toEqual(closed);

    // Reopened for a game added late: a newcomer picks it, and Pat leaves before it kicks off. Closing again
    // adds the newcomer and keeps Pat, who would drop out if the week were worked out afresh.
    await call(ADMIN, "POST", `/weeks/${recordedWeek}/reopen`);
    await call(OUTSIDER, "POST", `/invites/${code}/join`);
    const thursday = await addGame("NYG", "WSH", new Date("2026-11-20T01:15:00Z"), 1);
    expect((await pickHome(OUTSIDER, thursday)).status).toBe(200);
    await call(PLAYER, "DELETE", `/leagues/${id}/members/${PLAYER}`);
    now = new Date("2026-11-21T12:00:00Z");
    await call(ADMIN, "PATCH", `/games/${thursday}`, { homeScore: 20, awayScore: 10 });
    expect((await call(ADMIN, "POST", `/weeks/${recordedWeek}/finalize`)).status).toBe(200);
    expect(await results()).toEqual({
      week: [
        ["Newcomer", 3, false],
        ["Commish", 1, false],
        ["Pat", 0, true],
      ],
      lowPointLosers: ["Pat"],
    });

    // Posting needs a display name too.
    const thread = await call<{ id: string }>(ADMIN, "POST", `/leagues/${id}/messages`, {
      title: "Week 1",
      body: "Closed again.",
    });
    await settle();
    await db.delete(profiles).where(eq(profiles.userId, OUTSIDER));
    const base = `/leagues/${id}/messages`;
    for (const [path, json] of [
      [base, { title: "Hi", body: "Hello" }],
      [`${base}/${thread.body.id}/replies`, { body: "Hello" }],
    ] as const) {
      expect(await call(OUTSIDER, "POST", path, json)).toEqual({
        status: 409,
        body: { error: "Choose a display name first." },
      });
    }
    await call(OUTSIDER, "PUT", "/me", { displayName: "Newcomer", acceptTerms: true });
    now = before;
  });

  it("makes the Monday game the tiebreaker however the slate was built, unless the admin chooses", async () => {
    const created = await call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/weeks`, {
      year: 2026,
      number: 12,
      importGames: false,
    });
    const week12 = created.body.id;
    const add = (homeTeam: string, awayTeam: string, kickoff: string) =>
      call<WeekView>(ADMIN, "POST", `/weeks/${week12}/games`, { homeTeam, awayTeam, kickoff, spread: -3.5 });
    const idOf = (view: WeekView, homeTeam: string) => view.games.find((g) => g.homeTeam === homeTeam)?.id;

    // Thursday is added first and is the only game, so it is the tiebreaker for now.
    const thursdayOnly = (await add("DAL", "NYG", "2026-11-27T01:15:00Z")).body;
    expect(thursdayOnly.tiebreakerGameId).toBe(idOf(thursdayOnly, "DAL"));
    // Adding Sunday and Monday moves the default to Monday night.
    await add("GB", "CHI", "2026-11-29T18:00:00Z");
    const full = (await add("SEA", "SF", "2026-12-01T01:15:00Z")).body;
    expect(full.tiebreakerGameId).toBe(idOf(full, "SEA"));

    // An explicit choice sticks when the slate changes, and falls back if that game is removed.
    const sunday = idOf(full, "GB") ?? "";
    await call(ADMIN, "PATCH", `/weeks/${week12}`, { tiebreakerGameId: sunday });
    const more = (await add("LV", "DEN", "2026-12-01T03:00:00Z")).body;
    expect(more.tiebreakerGameId).toBe(sunday);
    const afterRemoval = (await call<WeekView>(ADMIN, "DELETE", `/games/${sunday}`)).body;
    expect(afterRemoval.tiebreakerGameId).toBe(idOf(afterRemoval, "LV"));
  });

  it("lets the POW go on any game that hasn't kicked off", async () => {
    // Week 12 from the test above: Thursday, then two Monday games (SEA is the earlier one, LV the tiebreaker).
    const week12 = (await call<LeagueDetail>(ADMIN, "GET", `/leagues/${leagueId}`)).body.weeks.find(
      (w) => w.number === 12,
    )?.id;
    const sunday = await call<WeekView>(ADMIN, "POST", `/weeks/${week12}/games`, {
      homeTeam: "GB",
      awayTeam: "CHI",
      kickoff: "2026-11-29T18:00:00Z",
      spread: -3.5,
    });
    const view = (await call<WeekView>(ADMIN, "POST", `/weeks/${week12}/open`)).body;
    expect(sunday.status).toBe(201);
    const idOf = (homeTeam: string) => view.games.find((g) => g.homeTeam === homeTeam)?.id ?? "";
    const put = (picks: Record<string, "home" | "away">, pow: string | null) =>
      call<WeekView>(ADMIN, "PUT", `/weeks/${week12}/picks`, {
        picks: Object.entries(picks).map(([homeTeam, side]) => ({ gameId: idOf(homeTeam), side })),
        powGameId: pow ? idOf(pow) : null,
        tiebreakerTotal: null,
      });

    now = new Date("2026-11-29T12:00:00Z"); // 7am Eastern on Sunday
    // On game day the Sunday game can still take the POW, and so can either Monday game.
    expect((await put({ GB: "home" }, "GB")).status).toBe(200);
    expect((await put({ SEA: "home", LV: "home" }, "SEA")).status).toBe(200);
    expect((await put({}, "LV")).status).toBe(200);
    // Leaving it unchosen is allowed too: there is no automatic POW.
    const none = await put({}, null);
    expect(none.status).toBe(200);
    expect(none.body.myPicks.some((p) => p.isPow)).toBe(false);

    // Once Sunday has kicked off it can't become the POW.
    now = new Date("2026-11-29T19:00:00Z");
    const rejected = await put({}, "GB");
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected)).toMatch(/can't be your POW: it has already kicked off/);
    now = WEDNESDAY;
  });

  it("applies simultaneous submissions one after the other", async () => {
    const week12 = (await call<LeagueDetail>(ADMIN, "GET", `/leagues/${leagueId}`)).body.weeks.find(
      (w) => w.number === 12,
    )?.id;
    const view = (await call<WeekView>(ADMIN, "GET", `/weeks/${week12}`)).body;
    const sunday = view.games.find((g) => g.homeTeam === "GB")?.id ?? "";
    const submit = (side: "home" | "away") =>
      call<WeekView>(ADMIN, "PUT", `/weeks/${week12}/picks`, {
        picks: [{ gameId: sunday, side }],
        powGameId: null,
        tiebreakerTotal: null,
      });

    // Both changes are allowed before kickoff; neither may fail or leave a second pick on the game.
    const results = await Promise.all([submit("home"), submit("away")]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const saved = (await call<WeekView>(ADMIN, "GET", `/weeks/${week12}`)).body.myPicks.filter(
      (p) => p.gameId === sunday,
    );
    expect(saved).toHaveLength(1);
    expect(results.map((r) => r.body.myPicks.find((p) => p.gameId === sunday)?.side)).toContain(
      saved[0]?.side,
    );
  });

  it("lets the admin reopen a week to correct it", async () => {
    expect((await call(PLAYER, "POST", `/weeks/${weekId}/reopen`)).status).toBe(403);
    expect((await call(ADMIN, "POST", `/weeks/${weekId}/import`)).status).toBe(409); // closed
    const reopened = (await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/reopen`)).body;
    expect(reopened).toMatchObject({ status: "open", results: null });

    // Players picked against these spreads: a reopened week can't re-pull them, only edit them by hand.
    expect(reopened.games.map((g) => g.spread)).toEqual([-2.5, 3.5, -4.5]);
    expect((await call(ADMIN, "POST", `/weeks/${weekId}/import`)).status).toBe(409);
    const corrected = await call<WeekView>(ADMIN, "PATCH", `/games/${game.sun}`, { spread: 3 });
    expect(corrected.body.games.find((g) => g.id === game.sun)?.spread).toBe(3);

    // Closing it again is news again: players who saw the first recap are offered the corrected one.
    const recapOf = async (user: string) =>
      (await call<LeagueDetail>(user, "GET", `/leagues/${leagueId}`)).body.recapWeekId;
    expect(await recapOf(PLAYER)).toBeNull();
    now = new Date("2026-12-02T12:00:00Z");
    await call(ADMIN, "POST", `/weeks/${weekId}/finalize`);
    expect(await recapOf(PLAYER)).toBe(weekId);
    expect(await recapOf(ADMIN)).toBeNull();
    await call(ADMIN, "POST", `/weeks/${weekId}/reopen`);
    now = WEDNESDAY;
  });

  it("lets the admin rename the league and change its time zone", async () => {
    expect((await call(PLAYER, "PATCH", `/leagues/${leagueId}`, { name: "Mine now" })).status).toBe(403);
    expect((await call(ADMIN, "PATCH", `/leagues/${leagueId}`, { timeZone: "Mars/Olympus" })).status).toBe(
      400,
    );
    expect((await call(ADMIN, "PATCH", `/leagues/${leagueId}`, {})).status).toBe(400);
    await call(ADMIN, "PATCH", `/leagues/${leagueId}`, { name: "Renamed", timeZone: "America/Chicago" });
    expect((await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`)).body).toMatchObject({
      name: "Renamed",
      timeZone: "America/Chicago",
    });
  });

  it("lets the admin remove a player, but not themselves", async () => {
    await call(OUTSIDER, "POST", `/invites/${inviteCode}/join`);
    const remove = (by: string, userId: string) =>
      call(by, "DELETE", `/leagues/${leagueId}/members/${userId}`);
    expect((await remove(PLAYER, OUTSIDER)).status).toBe(403);
    expect((await remove(ADMIN, ADMIN)).status).toBe(409);
    expect((await remove(ADMIN, OUTSIDER)).status).toBe(200);
    expect((await call(OUTSIDER, "GET", `/leagues/${leagueId}`)).status).toBe(404);
  });

  it("lets any player leave, except the league's only admin", async () => {
    await call(OUTSIDER, "POST", `/invites/${inviteCode}/join`);
    const leave = (userId: string) => call(userId, "DELETE", `/leagues/${leagueId}/members/${userId}`);
    // A member can remove themselves, but still nobody else.
    expect((await call(OUTSIDER, "DELETE", `/leagues/${leagueId}/members/${PLAYER}`)).status).toBe(403);
    expect((await leave(OUTSIDER)).status).toBe(200);
    expect((await call(OUTSIDER, "GET", `/leagues/${leagueId}`)).status).toBe(404);
    expect((await leave(OUTSIDER)).status).toBe(404);

    const refused = await leave(ADMIN);
    expect(refused.status).toBe(409);
    expect(errorOf(refused)).toMatch(/only commissioner/);
  });

  it("keeps future drafts out of default standings and respects an explicitly selected empty season", async () => {
    expect(
      (await call(ADMIN, "POST", `/leagues/${leagueId}/weeks`, { year: 2030, number: 1, importGames: false }))
        .status,
    ).toBe(201);
    expect((await call<Standings>(PLAYER, "GET", `/leagues/${leagueId}/standings`)).body.year).toBe(2026);
    const future = (await call<Standings>(PLAYER, "GET", `/leagues/${leagueId}/standings?year=2030`)).body;
    expect(future.year).toBe(2030);
    expect(future.weeks).toEqual([]);
    const unstarted = (await call<Standings>(ADMIN, "GET", `/leagues/${leagueId}/standings?year=2028`)).body;
    expect(unstarted.year).toBe(2028);
    expect(unstarted.weeks).toEqual([]);
    expect(
      (await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`)).body.weeks.some(
        (week) => week.year === 2030,
      ),
    ).toBe(false);
  });

  it("rotates the invite link", async () => {
    const rotated = await call<{ inviteCode: string }>(ADMIN, "POST", `/leagues/${leagueId}/invite`);
    expect(rotated.body.inviteCode).not.toBe(inviteCode);
    expect((await call(OUTSIDER, "POST", `/invites/${inviteCode}/join`)).status).toBe(404);
    expect((await call(PLAYER, "POST", `/leagues/${leagueId}/invite`)).status).toBe(403);
  });

  it("caps how many players a league can have", async () => {
    const limited = createApp({
      db,
      verifyToken,
      publicConfig,
      nfl: noGames,
      limits: { membersPerLeague: 2, leaguesPerUser: 100 },
    });
    const on = callOn(limited);
    const created = await on<{ id: string }>(ADMIN, "POST", "/leagues", { name: "Tiny League" });
    createdLeagues.push(created.body.id);
    const code = (await on<LeagueDetail>(ADMIN, "GET", `/leagues/${created.body.id}`)).body.inviteCode;

    expect((await on(PLAYER, "POST", `/invites/${code}/join`)).status).toBe(200);
    expect((await on(OUTSIDER, "GET", `/invites/${code}`)).body).toMatchObject({ full: true });
    const refused = await on(OUTSIDER, "POST", `/invites/${code}/join`);
    expect(refused.status).toBe(409);
    expect(errorOf(refused)).toMatch(/full/);
    // Members already in a full league aren't turned away, and don't see it as full.
    expect((await on(PLAYER, "POST", `/invites/${code}/join`)).status).toBe(200);
    expect((await on(PLAYER, "GET", `/invites/${code}`)).body).toMatchObject({ full: false });

    // Removing a player makes room, and the removed player then counts as a new join.
    await on(ADMIN, "DELETE", `/leagues/${created.body.id}/members/${PLAYER}`);
    expect((await on(OUTSIDER, "POST", `/invites/${code}/join`)).status).toBe(200);
    expect((await on(PLAYER, "POST", `/invites/${code}/join`)).status).toBe(409);
  });

  it("caps how many leagues a player can be in", async () => {
    const current = (await call<unknown[]>(OUTSIDER, "GET", "/leagues")).body.length;
    const limited = createApp({
      db,
      verifyToken,
      publicConfig,
      nfl: noGames,
      limits: { membersPerLeague: 100, leaguesPerUser: current + 1 },
    });
    const on = callOn(limited);
    const own = await on<{ id: string }>(OUTSIDER, "POST", "/leagues", { name: "Last One" });
    expect(own.status).toBe(201);
    createdLeagues.push(own.body.id);

    const tooMany = await on(OUTSIDER, "POST", "/leagues", { name: "One Too Many" });
    expect(tooMany.status).toBe(409);
    expect(errorOf(tooMany)).toMatch(/most one player can be in/);

    const other = await call<{ id: string }>(ADMIN, "POST", "/leagues", { name: "Another League" });
    createdLeagues.push(other.body.id);
    const code = (await call<LeagueDetail>(ADMIN, "GET", `/leagues/${other.body.id}`)).body.inviteCode;
    expect((await on(OUTSIDER, "POST", `/invites/${code}/join`)).status).toBe(409);
    expect((await call(OUTSIDER, "GET", "/leagues")).body).toHaveLength(current + 1);
  });

  it("still creates the week when the schedule can't be loaded", async () => {
    const offline = createApp({
      db,
      verifyToken,
      publicConfig,
      nfl: {
        getWeek: async () => {
          throw new Error("offline");
        },
      },
    });
    const res = await offline.request(`/api/leagues/${leagueId}/weeks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ year: 2026, number: 11 }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { importError: string }).importError).toMatch(/Couldn't load the schedule/);
  });
});

describe("parseEspnScoreboard", () => {
  const event = (over: { completed?: boolean; odds?: unknown; date?: string } = {}) => ({
    id: "401",
    date: over.date ?? "2026-11-15T18:00Z",
    competitions: [
      {
        competitors: [
          { homeAway: "home", score: "17", team: { abbreviation: "ATL" } },
          { homeAway: "away", score: "24", team: { abbreviation: "KC" } },
        ],
        status: { type: { completed: over.completed ?? false } },
        odds: over.odds,
      },
    ],
  });

  it("reads teams, kickoff and the home team's line", () => {
    expect(parseEspnScoreboard({ events: [event({ odds: [{ details: "KC -3.5", spread: 3.5 }] })] })).toEqual(
      [
        {
          externalId: "401",
          homeTeam: "ATL",
          awayTeam: "KC",
          kickoff: new Date("2026-11-15T18:00:00Z"),
          spread: 3.5,
          homeScore: null,
          awayScore: null,
        },
      ],
    );
  });

  it("reports scores only once the game is final, and tolerates missing odds", () => {
    expect(parseEspnScoreboard({ events: [event({ completed: true })] })).toMatchObject([
      { spread: null, homeScore: 17, awayScore: 24 },
    ]);
  });

  it("sorts by kickoff and accepts an empty week", () => {
    const games = parseEspnScoreboard({ events: [event(), event({ date: "2026-11-13T01:15Z" })] });
    expect(games.map((g) => g.kickoff.toISOString())).toEqual([
      "2026-11-13T01:15:00.000Z",
      "2026-11-15T18:00:00.000Z",
    ]);
    expect(parseEspnScoreboard({})).toEqual([]);
  });
});

describe("loadEnv", () => {
  const base = {
    DATABASE_URL: "postgresql://u:p@db.example.com:5432/postgres",
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  };

  it("accepts a single-line DATABASE_URL and trims surrounding whitespace", () => {
    expect(loadEnv({ ...base, DATABASE_URL: ` ${base.DATABASE_URL}\n` }).DATABASE_URL).toBe(
      base.DATABASE_URL,
    );
  });

  it("reads operator ids as a list, and refuses anything that isn't a user id", () => {
    expect(loadEnv(base).OPERATOR_USER_IDS).toEqual([]);
    expect(
      loadEnv({ ...base, OPERATOR_USER_IDS: ` ${ADMIN}, ${PLAYER.toUpperCase()} ,` }).OPERATOR_USER_IDS,
    ).toEqual([ADMIN, PLAYER]);
    expect(() => loadEnv({ ...base, OPERATOR_USER_IDS: "me@example.com" })).toThrow(/OPERATOR_USER_IDS/);
  });

  it("rejects a DATABASE_URL with a line break inside it", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: "postgresql://u:p\nq@db.example.com/postgres" })).toThrow(
      /line break/,
    );
  });
});
