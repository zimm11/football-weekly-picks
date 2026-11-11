import { createDb, leagueMembers, leagues, profiles } from "@picks/db";
import type { LeagueDetail, Standings, WeekView } from "@picks/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { loadEnv } from "../src/env";
import { type NflProvider, type ProviderGame, parseEspnScoreboard } from "../src/nfl";

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

  it("rejects requests with an invalid token", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it("reports the database as down when it is unreachable", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(503);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("with a database (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL ?? "");

  // Week 10 of 2026 in Eastern time (UTC-5): Thursday night, Sunday 1pm, Monday night.
  const THU = new Date("2026-11-13T01:15:00Z");
  const SUN = new Date("2026-11-15T18:00:00Z");
  const MON = new Date("2026-11-17T01:15:00Z");
  const WEDNESDAY = new Date("2026-11-11T17:00:00Z");
  const SUNDAY_7AM = new Date("2026-11-15T12:00:00Z");

  let now = WEDNESDAY;
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
  const app = createApp({
    db,
    verifyToken,
    publicConfig,
    nfl: { getWeek: async () => provided },
    now: () => now,
  });

  async function call<T = unknown>(user: string, method: string, path: string, json?: unknown) {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: res.status, body: (await res.json()) as T };
  }
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
  };

  beforeAll(async () => {
    for (const [i, id] of USERS.entries()) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}, ${`api-test-${i}@example.com`}) on conflict do nothing`,
      );
    }
    await db.delete(profiles).where(inArray(profiles.userId, USERS));
  });

  afterAll(async () => {
    await cleanUp();
    await db.$close();
  });

  it("reports healthy", async () => {
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({ ok: true, db: "up" });
  });

  it("stores a display name", async () => {
    expect((await call(ADMIN, "GET", "/me")).body).toEqual({ id: ADMIN, displayName: null });
    expect((await call(ADMIN, "PUT", "/me", { displayName: "  Commish  " })).body).toMatchObject({
      displayName: "Commish",
    });
    await call(PLAYER, "PUT", "/me", { displayName: "Pat" });
    expect((await call(ADMIN, "PUT", "/me", { displayName: "" })).status).toBe(400);
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
    });
    expect((await call(PLAYER, "POST", `/invites/${inviteCode}/join`)).body).toEqual({ leagueId });
    // Joining twice is harmless.
    expect((await call(PLAYER, "POST", `/invites/${inviteCode}/join`)).status).toBe(200);

    const detail = await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`);
    expect(detail.body).toMatchObject({ role: "member", inviteCode: null });
    expect(detail.body.members.map((m) => m.displayName)).toEqual(["Commish", "Pat"]);
    expect((await call(PLAYER, "GET", "/invites/bogus")).status).toBe(404);
  });

  it("only lets the admin set up weeks", async () => {
    const res = await call(PLAYER, "POST", `/leagues/${leagueId}/weeks`, { year: 2026, number: 10 });
    expect(res.status).toBe(403);
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
  });

  it("keeps a draft week hidden from members", async () => {
    expect((await call(PLAYER, "GET", `/weeks/${weekId}`)).status).toBe(404);
    expect((await call<LeagueDetail>(PLAYER, "GET", `/leagues/${leagueId}`)).body.weeks).toEqual([]);
    expect((await call<LeagueDetail>(ADMIN, "GET", `/leagues/${leagueId}`)).body.weeks).toMatchObject([
      { id: weekId, year: 2026, number: 10, status: "draft" },
    ]);
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

  it("enforces the 6am game-day lock", async () => {
    now = SUNDAY_7AM;
    const put = (user: string, input: Parameters<typeof picksBody>[0]) =>
      call<WeekView>(user, "PUT", `/weeks/${weekId}/picks`, picksBody(input));

    // The admin's Sunday pick and Thursday POW are frozen.
    const frozen = await put(ADMIN, { picks: { sun: "away" }, pow: "thu", total: 41 });
    expect(frozen.status).toBe(409);
    expect(errorOf(frozen)).toMatch(/can't be changed after 6am/);
    expect(errorOf(await put(ADMIN, { pow: "mon", picks: { mon: "home" }, total: 41 }))).toMatch(
      /can't be moved or removed/,
    );

    // The player is late: Thursday is gone, and Sunday can be picked but not as the POW.
    expect(errorOf(await put(PLAYER, { picks: { thu: "away" } }))).toMatch(/already kicked off/);
    expect(errorOf(await put(PLAYER, { picks: { sun: "away" }, pow: "sun" }))).toMatch(/can't be your POW/);
    const late = await put(PLAYER, { picks: { sun: "away", mon: "home" }, total: 50 });
    expect(late.status).toBe(200);
    expect(late.body.myPicks).toHaveLength(2);

    // A rejected submission saves nothing.
    const adminView = (await call<WeekView>(ADMIN, "GET", `/weeks/${weekId}`)).body;
    expect(adminView.myPicks).toHaveLength(2);
  });

  it("closes a game to picks as soon as it has a result, even before kickoff", async () => {
    // Monday hasn't kicked off, but the admin has entered its score.
    await call(ADMIN, "PATCH", `/games/${game.mon}`, { homeScore: 27, awayScore: 20 });
    const put = (user: string, input: Parameters<typeof picksBody>[0]) =>
      call<WeekView>(user, "PUT", `/weeks/${weekId}/picks`, picksBody(input));

    const changed = await put(PLAYER, { picks: { mon: "away" }, total: 50 });
    expect(changed.status).toBe(409);
    expect(errorOf(changed)).toMatch(/LAC at BAL is final/);
    expect(errorOf(await put(ADMIN, { picks: { mon: "home" }, pow: "thu", total: 41 }))).toMatch(/is final/);
    expect(errorOf(await put(PLAYER, { total: 47 }))).toMatch(/tiebreaker game is final/);

    // Clearing the result reopens it.
    await call(ADMIN, "PATCH", `/games/${game.mon}`, { homeScore: null, awayScore: null });
    expect((await put(PLAYER, { picks: { mon: "home" }, total: 50 })).status).toBe(200);
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
      { userId: PLAYER, displayName: "Pat", pickCount: 2, hasPow: false },
    ]);

    const standings = (await call<Standings>(PLAYER, "GET", `/leagues/${leagueId}/standings`)).body;
    expect(standings.weeks).toEqual([]);
    expect(standings.entries.every((e) => e.points === 0)).toBe(true);
  });

  it("pulls results from the provider and closes the week", async () => {
    expect((await call(ADMIN, "POST", `/weeks/${weekId}/finalize`)).status).toBe(409); // no scores yet
    expect((await call(PLAYER, "POST", `/weeks/${weekId}/results`)).status).toBe(403);

    // Thursday: NYG (-2.5) wins by 7. Sunday: ATL (+3.5) loses by 10. Monday is still being played.
    provided = provided.map((g) =>
      g.externalId === "t1"
        ? { ...g, homeScore: 24, awayScore: 17 }
        : g.externalId === "t2"
          ? { ...g, homeScore: 10, awayScore: 20 }
          : g,
    );
    const synced = (await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/results`)).body;
    expect(synced.games.map((g) => [g.homeScore, g.awayScore])).toEqual([
      [24, 17],
      [10, 20],
      [null, null],
    ]);
    expect((await call(ADMIN, "POST", `/weeks/${weekId}/finalize`)).status).toBe(409);

    // The admin enters Monday by hand: BAL (-4.5) wins 27–20, total 47.
    expect((await call(ADMIN, "PATCH", `/games/${game.mon}`, { homeScore: 27 })).status).toBe(400);
    await call(ADMIN, "PATCH", `/games/${game.mon}`, { homeScore: 27, awayScore: 20 });
    const closed = await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/finalize`);
    expect(closed.body.status).toBe("final");
  });

  it("reveals everyone's picks and the winner once the week is final", async () => {
    const view = (await call<WeekView>(PLAYER, "GET", `/weeks/${weekId}`)).body;
    // Admin: Thursday home wins (3 + 5 POW), Sunday home loses → 8.
    // Player: Sunday away wins (1), Monday home wins (3 + 5, the automatic Monday POW) → 9.
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
      weeks: [{ id: weekId, number: 10, winners: ["Pat"] }],
      entries: [
        { displayName: "Pat", points: 9, wins: 2, powWins: 1, mondayWins: 1, weeksWon: 1, rank: 1 },
        { displayName: "Commish", points: 8, wins: 1, powWins: 1, mondayWins: 0, weeksWon: 0, rank: 2 },
      ],
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
    await call(OUTSIDER, "PUT", "/me", { displayName: "Newcomer" });
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

    // Had they been removed before the week finished, they would not be in it.
    await db
      .update(leagueMembers)
      .set({ removedAt: new Date("2026-11-14T00:00:00Z") })
      .where(membership(PLAYER));
    expect(await names()).toMatchObject({ week: ["Commish"], winners: ["Commish"] });

    // Rejoining through the invite link restores access and the weeks they picked in.
    expect((await call(PLAYER, "POST", `/invites/${inviteCode}/join`)).status).toBe(200);
    expect((await call(PLAYER, "GET", `/leagues/${leagueId}`)).status).toBe(200);
    expect(await names()).toMatchObject({ week: ["Pat", "Commish"], winners: ["Pat"] });
    await call(ADMIN, "DELETE", `/leagues/${leagueId}/members/${OUTSIDER}`);
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

  it("gives late players the Monday night POW after 6am on Sunday", async () => {
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
    // The earlier Monday game is still wide open, but it can't be chosen as the POW any more.
    const rejected = await put({ SEA: "home" }, "SEA");
    expect(rejected.status).toBe(409);
    expect(errorOf(rejected)).toMatch(/POW is automatically SF at LV|POW is automatically DEN at LV/);
    expect((await put({ SEA: "home", LV: "home" }, null)).status).toBe(200);
  });

  it("lets only one of two simultaneous late picks through", async () => {
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

    // It is game day for the Sunday game, so the first pick saved is final.
    const results = await Promise.all([submit("home"), submit("away")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)?.body.myPicks.find((p) => p.gameId === sunday)?.side;
    const saved = (await call<WeekView>(ADMIN, "GET", `/weeks/${week12}`)).body.myPicks.find(
      (p) => p.gameId === sunday,
    );
    expect(saved?.side).toBe(winner);
    now = WEDNESDAY;
  });

  it("lets the admin reopen a week to correct it", async () => {
    expect((await call(PLAYER, "POST", `/weeks/${weekId}/reopen`)).status).toBe(403);
    const reopened = (await call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/reopen`)).body;
    expect(reopened).toMatchObject({ status: "open", results: null });
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

  it("rotates the invite link", async () => {
    const rotated = await call<{ inviteCode: string }>(ADMIN, "POST", `/leagues/${leagueId}/invite`);
    expect(rotated.body.inviteCode).not.toBe(inviteCode);
    expect((await call(OUTSIDER, "POST", `/invites/${inviteCode}/join`)).status).toBe(404);
    expect((await call(PLAYER, "POST", `/leagues/${leagueId}/invite`)).status).toBe(403);
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
    SUPABASE_PUBLISHABLE_KEY: "pk",
  };

  it("accepts a single-line DATABASE_URL and trims surrounding whitespace", () => {
    expect(loadEnv({ ...base, DATABASE_URL: ` ${base.DATABASE_URL}\n` }).DATABASE_URL).toBe(
      base.DATABASE_URL,
    );
  });

  it("rejects a DATABASE_URL with a line break inside it", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: "postgresql://u:p\nq@db.example.com/postgres" })).toThrow(
      /line break/,
    );
  });
});
