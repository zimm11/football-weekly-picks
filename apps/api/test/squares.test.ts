import { randomUUID } from "node:crypto";
import {
  createDb,
  emailOutbox,
  leagues,
  profiles,
  pushDeliveries,
  pushSubscriptions,
  squareBoards,
  squareClaims,
  squareScores,
} from "@picks/db";
import {
  type BoardSummary,
  type BoardView,
  type CreateLeagueResult,
  MODERATION_MESSAGES,
  type RandomSource,
} from "@picks/shared";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { type AutomationContext, advanceLeagues } from "../src/automation";
import { squaresAutomation } from "../src/automation/squares";
import { type NflProvider, type ProviderGame, parseEspnScoreboard } from "../src/nfl";
import { type EmailDeps, queueReminders } from "../src/outbox";
import { queuePickPush } from "../src/pushQueue";
import type { PushSender } from "../src/pushSender";
import { reminderStillApplies } from "../src/reminderTargets";
import type { Screener } from "../src/screening";
import { providerWeeks } from "../src/weekOps";

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };

/*
 * Squares against a real database, with a scripted feed and a clock the tests move. The draw's random source is
 * fixed: zero every time draws [1, 2, …, 9, 0] for both teams, so a score's square is (digit − 1) mod 10.
 */
const ZERO: RandomSource = () => 0;
const squareFor = (home: number, away: number) => ({ row: (away + 9) % 10, col: (home + 9) % 10 });

describe("the feed's live score", () => {
  const event = (state: string, completed = false) => ({
    events: [
      {
        id: "g",
        date: "2027-02-14T23:30Z",
        competitions: [
          {
            competitors: [
              { homeAway: "home", score: "10", team: { abbreviation: "SEA" } },
              { homeAway: "away", score: "7", team: { abbreviation: "BUF" } },
            ],
            status: { period: 2, type: { completed, state } },
          },
        ],
      },
    ],
  });
  it("is read only while the game is in progress", () => {
    expect(parseEspnScoreboard(event("in"))[0]?.liveScore).toEqual({ home: 10, away: 7 });
    expect(parseEspnScoreboard(event("pre"))[0]?.liveScore).toBeUndefined();
    expect(parseEspnScoreboard(event("post", true))[0]?.liveScore).toBeUndefined();
  });
});

describe.skipIf(!process.env.DATABASE_URL)("squares with a database (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  const ADMIN = randomUUID();
  const PAT = randomUUID();
  const SAM = randomUUID();
  const STRANGER = randomUUID();
  const users: string[] = [ADMIN, PAT, SAM, STRANGER];
  const names = ["Commish", "Pat", "Sam", "Stranger"];
  const verifyToken = async (token: string) => (users.includes(token) ? { id: token } : null);

  let now = new Date("2027-02-10T12:00:00Z");
  const KICKOFF = new Date("2027-02-14T23:30:00Z");
  /** The scripted feed, by "year:week". A week set to "fail" throws, as an outage would. */
  const feed = new Map<string, ProviderGame[] | "fail">();
  const nfl: NflProvider = {
    async getWeek(year, week) {
      const games = feed.get(`${year}:${week}`);
      if (games === "fail") throw new Error("feed down");
      return games ?? [];
    },
  };
  const email: EmailDeps = {
    mailer: { send: async () => undefined },
    appUrl: "https://picks.test",
    unsubscribeSecret: "test-unsubscribe-secret-that-is-long-enough",
    limits: { daily: 10_000, monthly: 100_000 },
  };
  const push: PushSender = { publicKey: `B${"a".repeat(86)}`, send: vi.fn(async () => "sent" as const) };
  /** Screening, faked: the placeholder `forbiddenword` is blocked, everything else allowed. */
  const screener: Screener = {
    screen: async ({ text }) =>
      text.includes("forbiddenword") ? { allow: 0.05, block: 0.95 } : { allow: 0.95, block: 0.05 },
  };
  // Nothing is sent after the response: the tests read what was queued.
  const build = () =>
    createApp({
      screener,
      db,
      verifyToken,
      publicConfig,
      nfl,
      now: () => now,
      email,
      push,
      random: ZERO,
      background: () => undefined,
    });
  let app = build();
  const call = async <T = unknown>(user: string, method: string, path: string, json?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const created: string[] = [];
  /** The cron's automation run, at the current clock, for this file's own leagues only. */
  const cron = (overrides: Partial<AutomationContext> = {}) =>
    advanceLeagues({
      db,
      nfl,
      now,
      results: providerWeeks(nfl, () => now),
      notify: { email, push },
      random: ZERO,
      onlyLeagues: new Set(created),
      ...overrides,
    });

  async function squaresLeague(name = "Super Bowl Squares") {
    const res = await call<CreateLeagueResult>(ADMIN, "POST", "/leagues", { name, type: "squares" });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    const [league] = await db.select().from(leagues).where(eq(leagues.id, res.body.id));
    for (const user of [PAT, SAM]) {
      expect((await call(user, "POST", `/invites/${league?.inviteCode}/join`)).status).toBe(200);
    }
    return res.body.id;
  }
  async function manualBoard(leagueId: string, maxPerPlayer = 10, kickoff = KICKOFF) {
    const res = await call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/boards`, {
      game: { source: "manual", homeTeam: "KC", awayTeam: "PHI", kickoff: kickoff.toISOString() },
      maxPerPlayer,
    });
    expect(res.status).toBe(201);
    return res.body.id;
  }
  const claim = (user: string, boardId: string, row: number, col: number, guestName?: string) =>
    call<BoardView>(user, "PUT", `/boards/${boardId}/squares/${row}/${col}`, guestName ? { guestName } : {});
  const board = async (boardId: string) =>
    (await db.select().from(squareBoards).where(eq(squareBoards.id, boardId)))[0];
  const eventEmails = (leagueId: string, event: string) =>
    db
      .select()
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `league_event:${leagueId}:%:${event}`));
  const eventPushes = (leagueId: string, event: string) =>
    db
      .select()
      .from(pushDeliveries)
      .where(and(eq(pushDeliveries.leagueId, leagueId), eq(pushDeliveries.eventKey, `${leagueId}:${event}`)));
  const feedGame = (patch: Partial<ProviderGame> = {}): ProviderGame => ({
    externalId: "sb-61",
    homeTeam: "SEA",
    awayTeam: "BUF",
    kickoff: KICKOFF,
    spread: -1.5,
    homeScore: null,
    awayScore: null,
    status: "scheduled",
    period: 0,
    ...patch,
  });

  beforeAll(async () => {
    for (const [i, id] of users.entries()) {
      await db.execute(sql`insert into auth.users (id, email) values (${id}, ${`squares-${i}@example.com`})`);
    }
    await db
      .insert(profiles)
      .values(users.map((userId, i) => ({ userId, displayName: names[i] ?? "Player" })));
    // One device each, so league events and reminders queue push rows.
    await db.insert(pushSubscriptions).values(
      users.map((userId) => ({
        userId,
        endpoint: `https://web.push.apple.com/${randomUUID()}`,
        p256dh: "k",
        auth: "a",
      })),
    );
  });
  beforeEach(() => {
    now = new Date("2027-02-10T12:00:00Z");
    feed.clear();
    // A fresh app per test, so the one-minute advance-on-read throttle starts empty.
    app = build();
  });
  afterAll(async () => {
    if (created.length) await db.delete(leagues).where(inArray(leagues.id, created));
    await db.execute(
      sql`delete from auth.users where id in (${sql.join(
        users.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    await db.$close();
  });

  it("holds board routes to squares leagues and their current members", async () => {
    const weekly = await call<CreateLeagueResult>(ADMIN, "POST", "/leagues", { name: "Weekly" });
    created.push(weekly.body.id);
    expect((await call(ADMIN, "GET", `/leagues/${weekly.body.id}/boards`)).status).toBe(404);
    expect((await call(ADMIN, "POST", `/leagues/${weekly.body.id}/boards`, {})).status).toBe(404);
    const [stray] = await db
      .insert(squareBoards)
      .values({ leagueId: weekly.body.id, homeTeam: "KC", awayTeam: "PHI", kickoff: KICKOFF })
      .returning();
    for (const [method, path] of [
      ["GET", `/boards/${stray?.id}`],
      ["PUT", `/boards/${stray?.id}/squares/0/0`],
      ["POST", `/boards/${stray?.id}/lock`],
    ] as const) {
      expect((await call(ADMIN, method, path, method === "PUT" ? {} : undefined)).status).toBe(404);
    }

    const leagueId = await squaresLeague("Guarded");
    const boardId = await manualBoard(leagueId);
    expect((await call(STRANGER, "GET", `/boards/${boardId}`)).status).toBe(404);
    expect((await claim(STRANGER, boardId, 0, 0)).status).toBe(404);
    expect((await call(PAT, "POST", `/leagues/${leagueId}/boards`, {})).status).toBe(403);
    expect((await call(PAT, "POST", `/boards/${boardId}/lock`)).status).toBe(403);
    expect((await claim(PAT, boardId, 10, 0)).status).toBe(404);
  });

  it("creates boards on the Super Bowl by default, a feed game, or a game typed by hand", async () => {
    const leagueId = await squaresLeague("Choosing");
    // 2027-02-10 is in the 2026 season; its Super Bowl is week 22.
    expect((await call(ADMIN, "POST", `/leagues/${leagueId}/boards`, {})).status).toBe(409);
    feed.set("2026:22", [feedGame()]);
    app = build();
    const sb = await call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/boards`, {});
    expect(sb.status).toBe(201);
    expect(await board(sb.body.id)).toMatchObject({
      externalId: "sb-61",
      year: 2026,
      week: 22,
      homeTeam: "SEA",
      awayTeam: "BUF",
      maxPerPlayer: 10,
    });
    const games = await call<{ externalId: string }[]>(
      ADMIN,
      "GET",
      `/leagues/${leagueId}/boards/games?year=2026&week=22`,
    );
    expect(games.body.map((g) => g.externalId)).toEqual(["sb-61"]);
    expect(
      (
        await call(ADMIN, "POST", `/leagues/${leagueId}/boards`, {
          game: { source: "feed", year: 2026, week: 22, externalId: "gone" },
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(ADMIN, "POST", `/leagues/${leagueId}/boards`, { game: { source: "superbowl" } })).status,
    ).toBe(201);
    const manual = await manualBoard(leagueId, 4);
    expect(await board(manual)).toMatchObject({ externalId: null, year: null, week: null, maxPerPlayer: 4 });

    const list = await call<BoardSummary[]>(PAT, "GET", `/leagues/${leagueId}/boards`);
    expect(list.body.map((b) => [b.phase, b.claimed, b.mine])).toEqual([
      ["open", 0, 0],
      ["open", 0, 0],
      ["open", 0, 0],
    ]);
  });

  it("lets two players race for one square: one gets it", async () => {
    const leagueId = await squaresLeague("Race");
    const boardId = await manualBoard(leagueId);
    const results = await Promise.all([claim(PAT, boardId, 4, 4), claim(SAM, boardId, 4, 4)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = await db.select().from(squareClaims).where(eq(squareClaims.boardId, boardId));
    expect(rows).toHaveLength(1);
  });

  it("holds each player to the limit, even claiming many at once, and raises it but never lowers it", async () => {
    const leagueId = await squaresLeague("Limit");
    const boardId = await manualBoard(leagueId, 2);
    const results = await Promise.all([0, 1, 2, 3, 4].map((col) => claim(PAT, boardId, 0, col)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(results.find((r) => r.status === 409)?.body).toEqual({
      error: "You can hold 2 squares on this board.",
    });

    expect((await call(ADMIN, "PATCH", `/boards/${boardId}`, { maxPerPlayer: 1 })).status).toBe(409);
    const raised = await call<BoardView>(ADMIN, "PATCH", `/boards/${boardId}`, { maxPerPlayer: 3 });
    expect(raised.body.maxPerPlayer).toBe(3);
    expect((await claim(PAT, boardId, 1, 0)).status).toBe(200);
    expect((await call(PAT, "PATCH", `/boards/${boardId}`, { maxPerPlayer: 5 })).status).toBe(403);
  });

  it("lets an admin claim guest squares outside every limit, and release any square before the lock", async () => {
    const leagueId = await squaresLeague("Guests");
    const boardId = await manualBoard(leagueId, 1);
    expect((await claim(PAT, boardId, 0, 0, "Uncle Ray")).status).toBe(403);
    for (const col of [0, 1, 2]) expect((await claim(ADMIN, boardId, 0, col, "Uncle Ray")).status).toBe(200);
    // Guest squares don't count against the admin's own limit.
    expect((await claim(ADMIN, boardId, 1, 0)).status).toBe(200);
    expect((await claim(PAT, boardId, 2, 0)).status).toBe(200);

    const view = (await call<BoardView>(SAM, "GET", `/boards/${boardId}`)).body;
    expect(view.players).toEqual([
      { userId: null, name: "Uncle Ray", avatarId: null, guest: true, count: 3 },
      { userId: ADMIN, name: "Commish", avatarId: null, guest: false, count: 1 },
      { userId: PAT, name: "Pat", avatarId: null, guest: false, count: 1 },
    ]);
    expect(view.squares.find((s) => s.row === 0 && s.col === 1)).toMatchObject({
      name: "Uncle Ray",
      guest: true,
    });

    expect((await call(SAM, "DELETE", `/boards/${boardId}/squares/2/0`)).status).toBe(409);
    expect((await call(PAT, "DELETE", `/boards/${boardId}/squares/2/0`)).status).toBe(200);
    expect((await call(ADMIN, "DELETE", `/boards/${boardId}/squares/0/2`)).status).toBe(200);
    expect((await call(PAT, "DELETE", `/boards/${boardId}/squares/0/2`)).status).toBe(409);
  });

  it("screens a guest's name like any name players see, and only for an admin", async () => {
    const leagueId = await squaresLeague("Guest names");
    const boardId = await manualBoard(leagueId);
    const refused = await claim(ADMIN, boardId, 0, 0, "forbiddenword");
    expect(refused.status).toBe(400);
    expect((refused.body as unknown as { error: string }).error).toBe(MODERATION_MESSAGES.rejectedName);
    expect(await db.select().from(squareClaims).where(eq(squareClaims.boardId, boardId))).toEqual([]);
    // A member is turned away before anything is screened.
    expect((await claim(PAT, boardId, 0, 0, "forbiddenword")).status).toBe(403);
    expect((await claim(ADMIN, boardId, 0, 0, "Uncle Ray")).status).toBe(200);
    // A suspended admin can't put a name in front of the league.
    await db.update(profiles).set({ suspendedAt: now }).where(eq(profiles.userId, ADMIN));
    expect((await claim(ADMIN, boardId, 1, 1, "Aunt May")).status).toBe(403);
    await db.update(profiles).set({ suspendedAt: null }).where(eq(profiles.userId, ADMIN));
    // Their own square needs no name, so nothing is screened.
    expect((await claim(ADMIN, boardId, 1, 1)).status).toBe(200);
  });

  it("draws once, however many admins press Lock and draw", async () => {
    const leagueId = await squaresLeague("Draw once");
    const boardId = await manualBoard(leagueId);
    await claim(PAT, boardId, 3, 3);
    const results = await Promise.all([
      call(ADMIN, "POST", `/boards/${boardId}/lock`),
      call(ADMIN, "POST", `/boards/${boardId}/lock`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const locked = await board(boardId);
    expect(locked?.homeDigits).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    expect(locked?.drawnAt).toEqual(now);
    // "The numbers are drawn" to the other members, by email and push, once.
    const event = `squares-drawn:${boardId}`;
    expect((await eventEmails(leagueId, event)).map((r) => r.userId).sort()).toEqual([PAT, SAM].sort());
    expect(await eventPushes(leagueId, event)).toHaveLength(2);
    expect((await eventPushes(leagueId, event))[0]?.payload).toEqual({
      title: "Draw once",
      body: "The numbers are drawn",
      url: `/boards/${boardId}`,
    });

    // Locked: no claims, no releases, no limit changes, no new game.
    expect((await claim(SAM, boardId, 5, 5)).status).toBe(409);
    expect((await call(PAT, "DELETE", `/boards/${boardId}/squares/3/3`)).status).toBe(409);
    expect((await call(ADMIN, "PATCH", `/boards/${boardId}`, { maxPerPlayer: 20 })).status).toBe(409);
    const view = (await call<BoardView>(PAT, "GET", `/boards/${boardId}`)).body;
    expect(view).toMatchObject({ phase: "locked", homeDigits: [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] });
  });

  it("gives back a leaving member's squares before the lock, and keeps them after", async () => {
    const leagueId = await squaresLeague("Leaving");
    const open = await manualBoard(leagueId);
    const locked = await manualBoard(leagueId);
    await claim(SAM, open, 1, 1);
    await claim(SAM, locked, 1, 1);
    await call(ADMIN, "POST", `/boards/${locked}/lock`);
    expect((await call(SAM, "DELETE", `/leagues/${leagueId}/members/${SAM}`)).status).toBe(200);
    const left = await db
      .select({ boardId: squareClaims.boardId })
      .from(squareClaims)
      .where(eq(squareClaims.userId, SAM));
    expect(left.map((r) => r.boardId)).toEqual([locked]);
    expect((await call<BoardView>(ADMIN, "GET", `/boards/${locked}`)).body.squares).toEqual([
      { row: 1, col: 1, userId: SAM, avatarId: null, name: "Sam", guest: false },
    ]);
  });

  it("locks and draws at kickoff when no admin has, once, and never redraws an admin's draw", async () => {
    const leagueId = await squaresLeague("Kickoff lock");
    const boardId = await manualBoard(leagueId);
    const adminLocked = await manualBoard(leagueId);
    await claim(PAT, boardId, 0, 0);
    await call(ADMIN, "POST", `/boards/${adminLocked}/lock`);
    const before = await board(adminLocked);

    // Before kickoff nothing is due.
    await cron();
    expect((await board(boardId))?.drawnAt).toBeNull();

    now = new Date(KICKOFF.getTime() + 60_000);
    // At kickoff a claim is refused even before automation has run.
    expect((await claim(SAM, boardId, 9, 9)).status).toBe(409);
    const first = await cron({ random: () => 7 });
    expect(first.steps).toBeGreaterThanOrEqual(1);
    const drawn = await board(boardId);
    expect(drawn?.drawnAt).toEqual(now);
    expect(drawn?.homeDigits).toHaveLength(10);
    // The admin's board kept its numbers.
    expect(await board(adminLocked)).toMatchObject({
      homeDigits: before?.homeDigits,
      drawnAt: before?.drawnAt,
    });

    // Again, and the cron and a read at once: still one draw and one event.
    now = new Date(now.getTime() + 2 * 60_000);
    await Promise.all([cron({ random: () => 3 }), call(PAT, "GET", `/boards/${boardId}`), cron()]);
    expect((await board(boardId))?.homeDigits).toEqual(drawn?.homeDigits);
    const event = `squares-drawn:${boardId}`;
    expect(await eventEmails(leagueId, event)).toHaveLength(3);
    expect(await eventPushes(leagueId, event)).toHaveLength(3);
  });

  it("plays a simulated game to four quarter results, an empty square's included: each from the feed once settled, final with overtime, never over an admin's score", async () => {
    feed.set("2026:22", [feedGame()]);
    const leagueId = await squaresLeague("Feed scores");
    const created = await call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/boards`, {});
    const boardId = created.body.id;
    // Pat holds the Q1 square, Sam the half's; the Q3 square stays empty.
    await claim(PAT, boardId, squareFor(7, 3).row, squareFor(7, 3).col);
    await claim(SAM, boardId, squareFor(14, 10).row, squareFor(14, 10).col);
    await claim(ADMIN, boardId, squareFor(23, 23).row, squareFor(23, 23).col, "Uncle Ray");

    const step = async (minutesAfterKickoff: number, patch: Partial<ProviderGame>) => {
      now = new Date(KICKOFF.getTime() + minutesAfterKickoff * 60_000);
      feed.set("2026:22", [feedGame(patch)]);
      return cron();
    };
    const scores = async () =>
      (await db.select().from(squareScores).where(eq(squareScores.boardId, boardId)))
        .map((s) => [s.period, s.homeScore, s.awayScore, s.byAdmin])
        .sort();

    // Kickoff: the board locks; nothing is settled.
    await step(1, { status: "in_progress", period: 1, liveScore: { home: 7, away: 0 } });
    expect((await board(boardId))?.drawnAt).not.toBeNull();
    expect(await scores()).toEqual([]);
    // The square that would win now follows the live score.
    app = build();
    const live = (await call<BoardView>(PAT, "GET", `/boards/${boardId}`)).body;
    expect(live).toMatchObject({
      phase: "underway",
      live: { homeScore: 7, awayScore: 0 },
      current: squareFor(7, 0),
    });

    await step(20, { status: "in_progress", period: 2, periodScores: { q1: { home: 7, away: 3 } } });
    expect(await scores()).toEqual([["q1", 7, 3, false]]);
    // The admin corrects the half before the feed has it; the feed never replaces it.
    expect(
      (await call(ADMIN, "PUT", `/boards/${boardId}/scores/half`, { homeScore: 14, awayScore: 10 })).status,
    ).toBe(200);
    expect(
      (await call(PAT, "PUT", `/boards/${boardId}/scores/half`, { homeScore: 1, awayScore: 1 })).status,
    ).toBe(403);
    await step(80, {
      status: "in_progress",
      period: 3,
      periodScores: { q1: { home: 7, away: 3 }, half: { home: 17, away: 10 } },
    });
    await step(130, {
      status: "in_progress",
      period: 4,
      periodScores: { q1: { home: 7, away: 3 }, half: { home: 17, away: 10 }, q3: { home: 23, away: 23 } },
    });
    // 30–30 after regulation, 36–30 after overtime: the final pays 6 and 0.
    const full = {
      q1: { home: 7, away: 3 },
      half: { home: 17, away: 10 },
      q3: { home: 23, away: 23 },
      final: { home: 36, away: 30 },
    };
    await step(240, { status: "final", period: 5, homeScore: 36, awayScore: 30, periodScores: full });
    // Twice more, as the cron and a read would: nothing changes.
    await step(245, { status: "final", period: 5, homeScore: 36, awayScore: 30, periodScores: full });
    await step(250, { status: "final", period: 5, homeScore: 36, awayScore: 30, periodScores: full });
    expect(await scores()).toEqual([
      ["final", 36, 30, false],
      ["half", 14, 10, true],
      ["q1", 7, 3, false],
      ["q3", 23, 23, false],
    ]);

    const view = (await call<BoardView>(PAT, "GET", `/boards/${boardId}`)).body;
    expect(view.phase).toBe("final");
    expect(view.current).toBeNull();
    expect(view.quarters.map((q) => [q.period, q.square, q.winner?.name ?? null])).toEqual([
      ["q1", squareFor(7, 3), "Pat"],
      ["half", squareFor(14, 10), "Sam"],
      ["q3", squareFor(23, 23), "Uncle Ray"],
      // Nobody holds the final's square: no winner for that quarter.
      ["final", squareFor(36, 30), null],
    ]);

    // Each quarter's result went out once, by push only.
    for (const period of ["q1", "half", "q3", "final"]) {
      const event = `squares-result:${boardId}:${period}`;
      expect(await eventPushes(leagueId, event)).toHaveLength(3);
      expect(await eventEmails(leagueId, event)).toHaveLength(0);
    }
    const [final] = await eventPushes(leagueId, `squares-result:${boardId}:final`);
    expect(final?.payload).toEqual({
      title: "Feed scores",
      body: "The final square is in",
      url: `/boards/${boardId}`,
    });
    expect(final?.boardId).toBe(boardId);
    // Done: the board leaves the due set.
    expect(await squaresAutomation.due({ db, now } as AutomationContext, 100)).not.toContainEqual(
      expect.objectContaining({ id: leagueId }),
    );
  });

  it("follows a feed game's new kickoff until the draw, so the board locks when the game starts", async () => {
    feed.set("2026:22", [feedGame()]);
    const leagueId = await squaresLeague("Flexed");
    const postponed = (await call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/boards`, {})).body.id;
    const typed = await manualBoard(leagueId);

    // The game is put back a day. At the old kickoff the board moves instead of drawing.
    const later = new Date(KICKOFF.getTime() + 24 * 60 * 60_000);
    feed.set("2026:22", [feedGame({ kickoff: later })]);
    now = new Date(KICKOFF.getTime() + 60_000);
    await cron();
    expect(await board(postponed)).toMatchObject({ kickoff: later, drawnAt: null });
    expect((await claim(PAT, postponed, 0, 0)).status).toBe(200);
    // A game typed by hand has no feed to follow: it locked at the kickoff the admin gave it.
    expect((await board(typed))?.drawnAt).toEqual(now);

    // Moved earlier: the next read brings the kickoff forward, and the board is locked from then.
    const earlier = new Date(now.getTime() + 3 * 60_000);
    feed.set("2026:22", [feedGame({ kickoff: earlier })]);
    now = new Date(now.getTime() + 2 * 60_000);
    expect((await call<BoardView>(SAM, "GET", `/boards/${postponed}`)).body.kickoff).toBe(
      earlier.toISOString(),
    );
    now = new Date(earlier.getTime() + 1_000);
    expect((await claim(SAM, postponed, 1, 1)).status).toBe(409);

    // Once drawn, the kickoff stands whatever the feed says.
    now = new Date(earlier.getTime() + 2 * 60_000);
    await cron();
    expect((await board(postponed))?.drawnAt).toEqual(now);
    feed.set("2026:22", [feedGame({ kickoff: later })]);
    now = new Date(now.getTime() + 2 * 60_000);
    await cron();
    expect((await board(postponed))?.kickoff).toEqual(earlier);
  });

  it("lets an admin delete a board, with everything on it", async () => {
    const leagueId = await squaresLeague("Deleting");
    const boardId = await manualBoard(leagueId);
    const kept = await manualBoard(leagueId);
    await claim(PAT, boardId, 0, 0);
    await claim(ADMIN, boardId, 1, 1, "Uncle Ray");
    expect((await call(PAT, "DELETE", `/boards/${boardId}`)).status).toBe(403);
    expect((await call(STRANGER, "DELETE", `/boards/${boardId}`)).status).toBe(404);
    // Drawn or not: the admin's call.
    await call(ADMIN, "POST", `/boards/${boardId}/lock`);
    const deleted = await call<{ leagueId: string }>(ADMIN, "DELETE", `/boards/${boardId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.leagueId).toBe(leagueId);
    expect(await board(boardId)).toBeUndefined();
    expect(await db.select().from(squareClaims).where(eq(squareClaims.boardId, boardId))).toEqual([]);
    expect((await call(PAT, "GET", `/boards/${boardId}`)).status).toBe(404);
    expect((await call(ADMIN, "DELETE", `/boards/${boardId}`)).status).toBe(404);
    const left = await call<{ id: string }[]>(PAT, "GET", `/leagues/${leagueId}/boards`);
    expect(left.body.map((b) => b.id)).toEqual([kept]);
  });

  it("advances a board on read, behind the one-minute throttle", async () => {
    const leagueId = await squaresLeague("On read");
    const boardId = await manualBoard(leagueId);
    now = new Date(KICKOFF.getTime() - 30_000);
    expect((await call<BoardView>(PAT, "GET", `/boards/${boardId}`)).body.phase).toBe("open");
    now = new Date(KICKOFF.getTime() + 1_000);
    // Read again within the minute: the throttle holds automation back, though claims are already refused.
    expect((await call<BoardView>(PAT, "GET", `/boards/${boardId}`)).body.drawnAt).toBeNull();
    now = new Date(KICKOFF.getTime() + 31_000);
    const view = (await call<BoardView>(PAT, "GET", `/boards/${boardId}`)).body;
    expect(view.drawnAt).not.toBeNull();
    expect(view.homeDigits).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  });

  it("catches a failing board on its own and still advances the others", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    feed.set("2026:21", [feedGame({ externalId: "bad", kickoff: KICKOFF })]);
    feed.set("2026:22", [feedGame()]);
    const leagueId = await squaresLeague("Failing");
    const bad = await call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/boards`, {
      game: { source: "feed", year: 2026, week: 21, externalId: "bad" },
    });
    const good = await call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/boards`, {});
    const down = await squaresLeague("Feed down");
    const downBoard = await call<{ id: string }>(ADMIN, "POST", `/leagues/${down}/boards`, {
      game: { source: "feed", year: 2026, week: 21, externalId: "bad" },
    });

    now = new Date(KICKOFF.getTime() + 30 * 60_000);
    // A score the database refuses on one board; the other board's feed is fine.
    feed.set("2026:21", [feedGame({ externalId: "bad", periodScores: { q1: { home: -1, away: 0 } } })]);
    feed.set("2026:22", [feedGame({ periodScores: { q1: { home: 3, away: 0 } } })]);
    await cron();
    expect(errors.mock.calls.some(([line]) => String(line).includes('"operation":"squares_board"'))).toBe(
      true,
    );
    expect(await db.select().from(squareScores).where(eq(squareScores.boardId, good.body.id))).toHaveLength(
      1,
    );
    expect((await board(bad.body.id))?.drawnAt).not.toBeNull();
    expect((await board(downBoard.body.id))?.drawnAt).not.toBeNull();

    // A feed outage: logged with its fixed code, nothing written, nothing thrown.
    errors.mockClear();
    now = new Date(now.getTime() + 2 * 60_000);
    feed.set("2026:21", "fail");
    const run = await cron();
    expect(run.failed).toBe(0);
    expect(errors.mock.calls.some(([line]) => String(line).includes('"operation":"results_autosync"'))).toBe(
      true,
    );
    errors.mockRestore();
  });

  it("reminds members with no square the evening before kickoff, and nobody once the board locks", async () => {
    const leagueId = await squaresLeague("Reminders");
    const boardId = await manualBoard(leagueId);
    await claim(PAT, boardId, 0, 0);
    const reminders = () =>
      db
        .select()
        .from(emailOutbox)
        .where(like(emailOutbox.dedupeKey, `reminder:${boardId}:%`));
    // 2027-02-14 18:30 in New York; the reminder is due from 7pm the evening before.
    now = new Date("2027-02-13T23:59:00Z");
    expect(await queueReminders(db, email, now)).toBe(0);
    now = new Date("2027-02-14T00:00:00Z");
    await queueReminders(db, email, now);
    await queueReminders(db, email, now);
    const queued = await reminders();
    expect(queued.map((r) => r.userId).sort()).toEqual([ADMIN, SAM].sort());
    expect(queued[0]?.dedupeKey).toBe(`reminder:${boardId}:2027-02-14:${queued[0]?.userId}`);
    expect(queued[0]?.expiresAt).toEqual(KICKOFF);
    await queuePickPush(db, now);
    const pushes = await db.select().from(pushDeliveries).where(eq(pushDeliveries.boardId, boardId));
    expect(pushes.filter((p) => p.kind === "pick_reminder")).toHaveLength(2);

    // Claiming a square before it is sent cancels Sam's (the send-time recheck); the admin's still applies.
    await claim(SAM, boardId, 5, 5);
    const ref = (userId: string) => ({ subjectId: boardId, date: "2027-02-14", userId });
    expect(await reminderStillApplies(db, ref(SAM), now)).toBeNull();
    expect(await reminderStillApplies(db, ref(ADMIN), now)).toMatchObject({
      message: { kind: "text", path: `/boards/${boardId}` },
    });
    expect(await reminderStillApplies(db, ref(ADMIN), KICKOFF)).toBeNull();

    // Once locked, a later board in the league reminds nobody.
    const later = await manualBoard(leagueId, 10, new Date("2027-02-15T23:30:00Z"));
    now = new Date("2027-02-15T00:30:00Z");
    await call(ADMIN, "POST", `/boards/${later}/lock`);
    await queueReminders(db, email, now);
    expect(
      await db
        .select()
        .from(emailOutbox)
        .where(like(emailOutbox.dedupeKey, `reminder:${later}:%`)),
    ).toHaveLength(0);
  });
});
