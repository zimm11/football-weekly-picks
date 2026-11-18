import { randomUUID } from "node:crypto";
import {
  createDb,
  games,
  leagues,
  messagePosts,
  messageReads,
  messageThreads,
  picks,
  profiles,
  schema,
  seasons,
  squareBoards,
  squareClaims,
  squareScores,
  survivorPicks,
  userBlocks,
  weekParticipants,
  weeks,
} from "@picks/db";
import type {
  BoardSummary,
  BoardView,
  CreateLeagueResult,
  InvitePreview,
  LeagueSummary,
  LeagueType,
} from "@picks/shared";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { NflProvider } from "../src/nfl";

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };

/*
 * Your leagues (`GET /leagues`): what is waiting for each player in each league (`todo`), and whether the board has
 * a thread they haven't read; the invite preview's type and member count; and the boards list's latest score. The
 * leagues are made through the API and their weeks, games, picks, boards and threads written straight to the
 * database, so every state is exact at a fixed clock.
 */

describe.skipIf(!process.env.DATABASE_URL)("Your leagues with a database (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  const ADMIN = randomUUID();
  const PAT = randomUUID();
  const SAM = randomUUID();
  const ALEX = randomUUID();
  const users: string[] = [ADMIN, PAT, SAM, ALEX];
  const names = ["Commish", "Pat", "Sam", "Alex"];
  const verifyToken = async (token: string) => (users.includes(token) ? { id: token } : null);
  const now = new Date("2026-11-20T12:00:00Z");
  const at = (iso: string) => new Date(iso);

  // The same app twice: once as usual, once on a connection that counts the queries it sends.
  let queries = 0;
  const countingDb = Object.assign(
    drizzle({ client: db.$client, schema, casing: "snake_case", logger: { logQuery: () => void queries++ } }),
    { $close: async () => undefined, $check: db.$check },
  ) as unknown as typeof db;
  // Nothing here asks the feed: Your leagues never does, and the boards are typed by hand.
  const nfl: NflProvider = { getWeek: async () => [] };
  const deps = { verifyToken, publicConfig, nfl, now: () => now, background: () => undefined };
  const app = createApp({ ...deps, db });
  const countingApp = createApp({ ...deps, db: countingDb });

  const call = async <T = unknown>(user: string, method: string, path: string, json?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const listFor = async (user: string) => {
    const res = await call<LeagueSummary[]>(user, "GET", "/leagues");
    expect(res.status).toBe(200);
    return res.body;
  };
  const created: string[] = [];

  async function createLeague(name: string, type: LeagueType, members: string[]) {
    const res = await call<CreateLeagueResult>(ADMIN, "POST", "/leagues", {
      name,
      type,
      ...(type === "weekly" && { management: "manual" }),
    });
    expect(res.status).toBe(201);
    created.push(res.body.id);
    const [league] = await db.select().from(leagues).where(eq(leagues.id, res.body.id));
    for (const user of members) {
      expect((await call(user, "POST", `/invites/${league?.inviteCode}/join`)).status).toBe(200);
    }
    return { id: res.body.id, code: league?.inviteCode ?? "" };
  }

  /** The league's 2026 season (made if the type doesn't make one), with `settings`. */
  async function seasonOf(leagueId: string, settings: Record<string, unknown> = {}) {
    await db.insert(seasons).values({ leagueId, year: 2026, settings }).onConflictDoNothing();
    const [season] = await db
      .update(seasons)
      .set({ settings })
      .where(eq(seasons.leagueId, leagueId))
      .returning({ id: seasons.id });
    if (!season) throw new Error("no season");
    await db.delete(weeks).where(eq(weeks.seasonId, season.id));
    return season.id;
  }
  async function week(seasonId: string, number: number, status: "draft" | "open" | "final") {
    const [row] = await db.insert(weeks).values({ seasonId, number, status }).returning({ id: weeks.id });
    if (!row) throw new Error("no week");
    return row.id;
  }
  type GameInput = {
    home: string;
    away: string;
    kickoff: string;
    spread?: number;
    score?: [number, number];
  };
  async function game(weekId: string, g: GameInput) {
    const [row] = await db
      .insert(games)
      .values({
        weekId,
        homeTeam: g.home,
        awayTeam: g.away,
        kickoff: at(g.kickoff),
        spread: g.spread ?? -3,
        points: 1,
        homeScore: g.score?.[0] ?? null,
        awayScore: g.score?.[1] ?? null,
      })
      .returning({ id: games.id });
    if (!row) throw new Error("no game");
    return row.id;
  }
  const pick = (weekId: string, userId: string, gameId: string, side: "home" | "away", isPow = false) =>
    db.insert(picks).values({ weekId, userId, gameId, side, isPow });

  /** A thread whose opening message is by `authorId`, at version 1. */
  async function thread(leagueId: string, authorId: string, { hidden = false } = {}) {
    const [row] = await db
      .insert(messageThreads)
      .values({ leagueId, authorId, title: "Week talk" })
      .returning({ id: messageThreads.id });
    if (!row) throw new Error("no thread");
    await db.insert(messagePosts).values({
      threadId: row.id,
      authorId,
      body: "Hello",
      position: 1,
      ...(hidden && { hiddenAt: now }),
    });
    return row.id;
  }
  const read = (threadId: string, userId: string) =>
    db.insert(messageReads).values({ threadId, userId, version: 1 });

  /**
   * One league of each type, all at the clock above:
   * - weekly, Week 11 open: a game kicked off, three still to come, one to come that already has a result;
   *   Commish picked one of the three, Sam all three, Pat none. Week 10 is final and Week 12 a draft.
   * - playoff, Guillotine: the Wild Card round final, where Commish's POW lost and Pat's and Sam's won; the
   *   Divisional round open with two games to come, all picked by Sam.
   * - survivor, one life, from Week 10: Commish won with the Chiefs, Pat won, Sam lost (out); Week 11 open, with
   *   one game kicked off and two to come; Pat has picked. Alex joined after the pool began (watching).
   * - squares: two open boards (Commish holds a square on the first, Sam on both), one drawn, one past kickoff.
   */
  async function makeLeagues(label: string, members: string[]) {
    const weekly = await createLeague(`${label} Sunday`, "weekly", members);
    const weeklySeason = await seasonOf(weekly.id);
    const week10 = await week(weeklySeason, 10, "final");
    await game(week10, { home: "KC", away: "BUF", kickoff: "2026-11-15T18:00:00Z", score: [20, 10] });
    const week11 = await week(weeklySeason, 11, "open");
    await week(weeklySeason, 12, "draft");
    const kickedOff = await game(week11, { home: "NE", away: "NYJ", kickoff: "2026-11-20T01:15:00Z" });
    const sunday = await game(week11, { home: "KC", away: "DEN", kickoff: "2026-11-22T18:00:00Z" });
    const late = await game(week11, { home: "DAL", away: "NYG", kickoff: "2026-11-22T21:25:00Z" });
    const monday = await game(week11, { home: "SEA", away: "LAR", kickoff: "2026-11-24T01:20:00Z" });
    // Still to kick off by the clock, but its result is in: locked.
    await game(week11, { home: "MIA", away: "BUF", kickoff: "2026-11-23T18:00:00Z", score: [17, 14] });

    const playoff = await createLeague(`${label} Bracket`, "playoff", members);
    const playoffSeason = await seasonOf(playoff.id, { format: "guillotine" });
    const wildCard = await week(playoffSeason, 19, "final");
    const wcGame = await game(wildCard, {
      home: "PHI",
      away: "GB",
      kickoff: "2026-11-15T18:00:00Z",
      spread: -3,
      score: [24, 10],
    });
    const divisional = await week(playoffSeason, 20, "open");
    const div1 = await game(divisional, { home: "PHI", away: "SF", kickoff: "2026-11-22T18:00:00Z" });
    const div2 = await game(divisional, { home: "BAL", away: "HOU", kickoff: "2026-11-23T01:15:00Z" });

    const survivor = await createLeague(`${label} Pool`, "survivor", members);
    const survivorSeason = await seasonOf(survivor.id, { lives: 1, startWeek: 10 });
    const sWeek10 = await week(survivorSeason, 10, "final");
    const s1 = await game(sWeek10, {
      home: "KC",
      away: "BUF",
      kickoff: "2026-11-15T18:00:00Z",
      score: [27, 20],
    });
    const s2 = await game(sWeek10, {
      home: "DAL",
      away: "NYG",
      kickoff: "2026-11-15T21:25:00Z",
      score: [10, 17],
    });
    const sWeek11 = await week(survivorSeason, 11, "open");
    await game(sWeek11, { home: "PIT", away: "CLE", kickoff: "2026-11-20T01:15:00Z" });
    // Commish used the Chiefs in Week 10, but the Broncos are still free.
    await game(sWeek11, { home: "KC", away: "DEN", kickoff: "2026-11-22T18:00:00Z" });
    const s4 = await game(sWeek11, { home: "MIA", away: "NYJ", kickoff: "2026-11-23T01:20:00Z" });

    const squares = await createLeague(`${label} Squares`, "squares", members);
    const board = async (kickoff: string, drawn = false) => {
      const [row] = await db
        .insert(squareBoards)
        .values({
          leagueId: squares.id,
          homeTeam: "SEA",
          awayTeam: "BUF",
          kickoff: at(kickoff),
          ...(drawn && {
            drawnAt: at("2026-11-19T12:00:00Z"),
            homeDigits: [1, 2, 3, 4, 5, 6, 7, 8, 9, 0],
            awayDigits: [1, 2, 3, 4, 5, 6, 7, 8, 9, 0],
          }),
        })
        .returning({ id: squareBoards.id });
      if (!row) throw new Error("no board");
      return row.id;
    };
    const boardA = await board("2026-11-22T18:00:00Z");
    const boardB = await board("2026-11-29T18:00:00Z");
    const drawnBoard = await board("2026-11-23T18:00:00Z", true);
    const pastBoard = await board("2026-11-19T18:00:00Z", true);

    return {
      weekly,
      week11,
      playoff,
      divisional,
      survivor,
      sWeek11,
      squares,
      boardA,
      boardB,
      drawnBoard,
      pastBoard,
      games: { kickedOff, sunday, late, monday, wcGame, div1, div2, s1, s2, s4 },
      weeks: { week10, wildCard, sWeek10 },
    };
  }

  let main: Awaited<ReturnType<typeof makeLeagues>>;
  let other: Awaited<ReturnType<typeof makeLeagues>>;
  const todoOf = (list: LeagueSummary[], leagueId: string) => list.find((l) => l.id === leagueId)?.todo;
  const summaryOf = (list: LeagueSummary[], leagueId: string) => list.find((l) => l.id === leagueId);

  beforeAll(async () => {
    for (const [i, id] of users.entries()) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}, ${`list-${i}-${id}@example.com`})`,
      );
    }
    await db
      .insert(profiles)
      .values(users.map((userId, i) => ({ userId, displayName: names[i] ?? "Player" })));
    main = await makeLeagues("Main", [PAT, SAM]);
    // A second set Pat is in and Sam isn't, to show the query count doesn't grow with the number of leagues.
    other = await makeLeagues("Other", [PAT]);
    const g = main.games;

    await pick(main.week11, ADMIN, g.sunday, "home");
    for (const id of [g.sunday, g.late, g.monday]) await pick(main.week11, SAM, id, "away");

    await pick(main.weeks.wildCard, ADMIN, g.wcGame, "away", true);
    await pick(main.weeks.wildCard, PAT, g.wcGame, "home", true);
    await pick(main.weeks.wildCard, SAM, g.wcGame, "home", true);
    for (const id of [g.div1, g.div2]) await pick(main.divisional, SAM, id, "home");

    await db.insert(survivorPicks).values([
      { weekId: main.weeks.sWeek10, userId: ADMIN, gameId: g.s1, side: "home" },
      { weekId: main.weeks.sWeek10, userId: PAT, gameId: g.s2, side: "away" },
      { weekId: main.weeks.sWeek10, userId: SAM, gameId: g.s1, side: "away" },
      { weekId: main.sWeek11, userId: PAT, gameId: g.s4, side: "home" },
    ]);
    await db
      .insert(weekParticipants)
      .values([ADMIN, PAT, SAM].map((userId) => ({ weekId: main.weeks.sWeek10, userId })));
    // Alex joins the pool after it began: they watch.
    expect((await call(ALEX, "POST", `/invites/${main.survivor.code}/join`)).status).toBe(200);

    await db.insert(squareClaims).values([
      { boardId: main.boardA, row: 0, col: 0, userId: ADMIN },
      { boardId: main.boardA, row: 1, col: 1, userId: SAM },
      { boardId: main.boardB, row: 1, col: 1, userId: SAM },
    ]);

    // The board: Commish's thread, read by Commish; Sam has blocked Commish. A survivor thread by Sam, read by
    // Pat. A playoff thread whose opening message is hidden for review: its admins still see it.
    const weeklyThread = await thread(main.weekly.id, ADMIN);
    await read(weeklyThread, ADMIN);
    await db.insert(userBlocks).values({ blockerId: SAM, blockedId: ADMIN });
    const survivorThread = await thread(main.survivor.id, SAM);
    await read(survivorThread, PAT);
    await read(survivorThread, SAM);
    await thread(main.playoff.id, SAM, { hidden: true });
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

  describe("weekly pick'em", () => {
    it("counts the open week's games still to pick, and when the first of them locks", async () => {
      expect(todoOf(await listFor(ADMIN), main.weekly.id)).toEqual({
        kind: "picks",
        weekId: main.week11,
        weekNumber: 11,
        count: 2,
        locksAt: "2026-11-22T21:25:00.000Z",
      });
      // The game already kicked off and the one with a result entered aren't counted.
      expect(todoOf(await listFor(PAT), main.weekly.id)).toEqual({
        kind: "picks",
        weekId: main.week11,
        weekNumber: 11,
        count: 3,
        locksAt: "2026-11-22T18:00:00.000Z",
      });
    });

    it("says nothing once every game that can be picked is", async () => {
      expect(summaryOf(await listFor(SAM), main.weekly.id)).not.toHaveProperty("todo");
    });

    it("says nothing without an open week", async () => {
      const quiet = await createLeague("Quiet", "weekly", []);
      const season = await seasonOf(quiet.id);
      const done = await week(season, 10, "final");
      await game(done, { home: "KC", away: "BUF", kickoff: "2026-11-15T18:00:00Z", score: [20, 10] });
      const draft = await week(season, 12, "draft");
      await game(draft, { home: "KC", away: "LV", kickoff: "2026-11-29T18:00:00Z" });
      expect(summaryOf(await listFor(ADMIN), quiet.id)).toMatchObject({ name: "Quiet" });
      expect(summaryOf(await listFor(ADMIN), quiet.id)).not.toHaveProperty("todo");
      await db.delete(leagues).where(eq(leagues.id, quiet.id));
    });
  });

  describe("playoff pick'em", () => {
    it("counts the round for players still in, and nothing for one the guillotine put out", async () => {
      expect(todoOf(await listFor(PAT), main.playoff.id)).toEqual({
        kind: "picks",
        weekId: main.divisional,
        weekNumber: 20,
        count: 2,
        locksAt: "2026-11-22T18:00:00.000Z",
      });
      // Commish's Wild Card POW lost: out of picking from the Divisional round.
      expect(todoOf(await listFor(ADMIN), main.playoff.id)).toBeUndefined();
      expect(todoOf(await listFor(SAM), main.playoff.id)).toBeUndefined();
    });
  });

  describe("survivor", () => {
    it("asks a player still in with no pick, from the first team they may pick", async () => {
      expect(todoOf(await listFor(ADMIN), main.survivor.id)).toEqual({
        kind: "survivor-pick",
        weekId: main.sWeek11,
        weekNumber: 11,
        locksAt: "2026-11-22T18:00:00.000Z",
      });
    });

    it("says nothing to a player who has picked, one who is out, or one watching", async () => {
      expect(todoOf(await listFor(PAT), main.survivor.id)).toBeUndefined();
      expect(todoOf(await listFor(SAM), main.survivor.id)).toBeUndefined();
      expect(summaryOf(await listFor(ALEX), main.survivor.id)).toMatchObject({ type: "survivor" });
      expect(todoOf(await listFor(ALEX), main.survivor.id)).toBeUndefined();
    });
  });

  describe("squares", () => {
    it("counts the open boards without a square of the player's, naming the one kicking off first", async () => {
      expect(todoOf(await listFor(PAT), main.squares.id)).toEqual({
        kind: "squares",
        boardId: main.boardA,
        count: 2,
        locksAt: "2026-11-22T18:00:00.000Z",
      });
      expect(todoOf(await listFor(ADMIN), main.squares.id)).toEqual({
        kind: "squares",
        boardId: main.boardB,
        count: 1,
        locksAt: "2026-11-29T18:00:00.000Z",
      });
      // Sam holds a square on both open boards; the drawn board and the one past kickoff are locked.
      expect(todoOf(await listFor(SAM), main.squares.id)).toBeUndefined();
    });
  });

  describe("unread", () => {
    it("is the Messages tab's rule: read markers, blocks, and threads hidden from members", async () => {
      const unread = (list: LeagueSummary[]) =>
        Object.fromEntries(
          [main.weekly, main.playoff, main.survivor, main.squares].map((l) => [
            l.id,
            summaryOf(list, l.id)?.unread,
          ]),
        );
      const [admin, pat, sam] = [await listFor(ADMIN), await listFor(PAT), await listFor(SAM)];
      expect(unread(admin)).toEqual({
        [main.weekly.id]: false,
        // Hidden for review: a commissioner still sees it.
        [main.playoff.id]: true,
        [main.survivor.id]: true,
        [main.squares.id]: false,
      });
      expect(unread(pat)).toEqual({
        [main.weekly.id]: true,
        [main.playoff.id]: false,
        [main.survivor.id]: false,
        [main.squares.id]: false,
      });
      // Sam blocked Commish, so Commish's thread isn't on Sam's board. Sam's own hidden thread is.
      expect(unread(sam)).toEqual({
        [main.weekly.id]: false,
        [main.playoff.id]: true,
        [main.survivor.id]: false,
        [main.squares.id]: false,
      });
    });
  });

  it("says nothing about anyone else's picks or squares", async () => {
    const before = await listFor(PAT);
    // Commish picks the rest of the week and the pool, and takes a square on the other board.
    await pick(main.week11, ADMIN, main.games.late, "home");
    await db
      .insert(survivorPicks)
      .values({ weekId: main.sWeek11, userId: ADMIN, gameId: main.games.s4, side: "away" });
    await db.insert(squareClaims).values({ boardId: main.boardB, row: 5, col: 5, userId: ADMIN });
    expect(await listFor(PAT)).toEqual(before);
    expect(JSON.stringify(before)).not.toContain(ADMIN);
    expect(todoOf(await listFor(ADMIN), main.weekly.id)).toMatchObject({ count: 1 });
    expect(todoOf(await listFor(ADMIN), main.survivor.id)).toBeUndefined();
    expect(todoOf(await listFor(ADMIN), main.squares.id)).toBeUndefined();
    await db.delete(picks).where(eq(picks.gameId, main.games.late));
    await db.delete(survivorPicks).where(eq(survivorPicks.weekId, main.sWeek11));
    await db
      .insert(survivorPicks)
      .values({ weekId: main.sWeek11, userId: PAT, gameId: main.games.s4, side: "home" });
    await db.delete(squareClaims).where(eq(squareClaims.userId, ADMIN));
    await db.insert(squareClaims).values({ boardId: main.boardA, row: 0, col: 0, userId: ADMIN });
  });

  it("sends the same number of queries however many leagues the player is in", async () => {
    const count = async (user: string) => {
      queries = 0;
      const res = await countingApp.request("/api/leagues", { headers: { Authorization: `Bearer ${user}` } });
      expect(res.status).toBe(200);
      return { leagues: ((await res.json()) as LeagueSummary[]).length, queries };
    };
    const sam = await count(SAM);
    const pat = await count(PAT);
    expect(sam.leagues).toBe(4);
    expect(pat.leagues).toBe(8);
    expect(pat.queries).toBe(sam.queries);
    // The list, the unread board, the weeks that matter, their games, the player's picks, a survivor season's
    // picks, members and recorded players, and the open boards.
    expect(sam.queries).toBe(9);
  });

  it("previews an invite with the league's type and member count", async () => {
    const member = await call<InvitePreview>(PAT, "GET", `/invites/${main.weekly.code}`);
    expect(member.body).toEqual({
      leagueId: main.weekly.id,
      leagueName: "Main Sunday",
      alreadyMember: true,
      full: false,
      type: "weekly",
      memberCount: 3,
    });
    const stranger = await call<InvitePreview>(ALEX, "GET", `/invites/${main.squares.code}`);
    expect(stranger.body).toMatchObject({
      alreadyMember: false,
      full: false,
      type: "squares",
      memberCount: 3,
    });
  });

  it("gives each board on the list its latest stored score, and the board the same", async () => {
    const boards = async () => {
      const res = await call<BoardSummary[]>(ADMIN, "GET", `/leagues/${other.squares.id}/boards`);
      expect(res.status).toBe(200);
      return res.body.find((b) => b.id === other.pastBoard);
    };
    expect(await boards()).not.toHaveProperty("latestScore");
    await db
      .insert(squareScores)
      .values({ boardId: other.pastBoard, period: "q1", homeScore: 7, awayScore: 3 });
    expect((await boards())?.latestScore).toEqual({ period: "q1", away: 3, home: 7 });
    await db
      .insert(squareScores)
      .values({ boardId: other.pastBoard, period: "half", homeScore: 14, awayScore: 10 });
    expect((await boards())?.latestScore).toEqual({ period: "half", away: 10, home: 14 });
    const view = await call<BoardView>(ADMIN, "GET", `/boards/${other.pastBoard}`);
    expect(view.body.latestScore).toEqual({ period: "half", away: 10, home: 14 });
    // The other boards have no score.
    const all = await call<BoardSummary[]>(ADMIN, "GET", `/leagues/${other.squares.id}/boards`);
    expect(all.body.filter((b) => b.latestScore).map((b) => b.id)).toEqual([other.pastBoard]);
  });
});
