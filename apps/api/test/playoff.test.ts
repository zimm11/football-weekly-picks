import type { LeagueDetail, PlayoffStandingsView, WeekView } from "@picks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REMINDERS, reminderStillApplies } from "../src/reminderTargets";
import { feedGame, pickemSetup } from "./pickemSetup";

// A whole postseason with no admin action, on a scripted feed and a clock the test moves: Wild Card to champion in
// a Guillotine league. Every game's line is home -3 (the Super Bowl's -1); the home team covers unless noted.
const wildCard = (scores = false) =>
  [
    ["wc1", "BUF", "MIA", "2027-01-16T21:30:00Z"],
    ["wc2", "PIT", "CLE", "2027-01-17T01:15:00Z"],
    ["wc3", "PHI", "WAS", "2027-01-17T18:00:00Z"],
    ["wc4", "DET", "CHI", "2027-01-17T21:30:00Z"],
    ["wc5", "SF", "SEA", "2027-01-18T01:15:00Z"],
    // Monday night: home by 3, a push.
    ["wc6", "KC", "DEN", "2027-01-19T01:15:00Z"],
  ].map(([id = "", home = "", away = "", kickoff = ""]) =>
    feedGame(id, home, away, kickoff, -3, scores ? (id === "wc6" ? [20, 17] : [24, 17]) : undefined),
  );
const divisional = (scores = false) =>
  [
    ["dv1", "BUF", "PIT", "2027-01-23T21:30:00Z"],
    ["dv2", "PHI", "DET", "2027-01-24T01:15:00Z"],
    ["dv3", "KC", "SF", "2027-01-24T20:00:00Z"],
    // The away team covers.
    ["dv4", "LAR", "GB", "2027-01-24T23:30:00Z"],
  ].map(([id = "", home = "", away = "", kickoff = ""]) =>
    feedGame(id, home, away, kickoff, -3, scores ? (id === "dv4" ? [17, 24] : [27, 20]) : undefined),
  );
const conference = (scores = false) =>
  [
    ["cf1", "BUF", "KC", "2027-01-31T20:00:00Z"],
    ["cf2", "PHI", "LAR", "2027-01-31T23:30:00Z"],
  ].map(([id = "", home = "", away = "", kickoff = ""]) =>
    feedGame(id, home, away, kickoff, -3, scores ? [30, 20] : undefined),
  );
const superBowl = (scores = false) => [
  feedGame("sb", "PHI", "BUF", "2027-02-14T23:30:00Z", -1, scores ? [27, 24] : undefined),
];

describe.skipIf(!process.env.DATABASE_URL)("Playoff pick'em (requires `pnpm db:start`)", () => {
  const t = pickemSetup(["Commish", "Pat", "Sam", "Lee", "Kim", "Outsider"]);
  const [ADMIN = "", PAT = "", SAM = "", LEE = "", KIM = "", OUTSIDER = ""] = t.users;
  const at = (iso: string) => {
    t.state.now = new Date(iso);
  };
  const round = async (leagueId: string, number: number) => {
    const found = (await t.weeksOf(leagueId)).find((w) => w.number === number);
    if (!found) throw new Error(`No round ${number}`);
    return found;
  };
  /** Saves picks: every game's home side, the POW on `pow` (a feed id), and an optional guess. */
  async function pick(
    user: string,
    leagueId: string,
    number: number,
    pow: string | null,
    guess: number | null = null,
  ) {
    const r = await round(leagueId, number);
    return t.call<WeekView>(user, "PUT", `/weeks/${r.id}/picks`, {
      picks: r.games.map((g) => ({ gameId: g.id, side: "home" })),
      powGameId: pow ? (r.games.find((g) => g.externalId === pow)?.id ?? null) : null,
      tiebreakerTotal: guess,
    });
  }
  const standings = async (user: string, leagueId: string) =>
    (await t.call<PlayoffStandingsView>(user, "GET", `/leagues/${leagueId}/playoff/standings`)).body;
  const statusOf = (view: PlayoffStandingsView, user: string) => view.entries.find((e) => e.userId === user);

  beforeAll(t.setUp);
  afterAll(t.tearDown);

  it("runs a Guillotine postseason from Wild Card to champion with no admin action", async () => {
    at("2026-11-20T12:00:00Z");
    const leagueId = await t.createLeague(ADMIN, {
      name: "Bracket",
      type: "playoff",
      settings: { format: "guillotine" },
    });
    for (const user of [PAT, SAM, LEE]) await t.join(user, leagueId);
    t.feed.set("2026:19", wildCard());

    // Before Week 18's Sunday the feed isn't asked for the Wild Card round at all.
    at("2027-01-09T12:00:00Z");
    t.asked.length = 0;
    expect(await t.runAutomation("playoff", [leagueId])).toEqual([]);
    expect(t.asked).toEqual([]);

    // After it, the round is created once the feed lists all six games, and opens: every game has a line.
    at("2027-01-11T12:00:00Z");
    await t.runAutomation("playoff", [leagueId]);
    let wc = await round(leagueId, 19);
    expect(wc.status).toBe("open");
    expect(wc.games.map((g) => g.points)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(await t.events(leagueId)).toEqual(
      [ADMIN, PAT, SAM, LEE].map((u) => `${u} week-open:${wc.id}`).sort(),
    );

    // Picks: Pat's POW wins, Sam's pushes, Lee has none, the admin doesn't play.
    at("2027-01-12T12:00:00Z");
    expect((await pick(PAT, leagueId, 19, "wc1")).status).toBe(200);
    expect((await pick(SAM, leagueId, 19, "wc6")).status).toBe(200);
    expect((await pick(LEE, leagueId, 19, null)).status).toBe(200);

    // Monday night is under way: Lee sees for himself that he's out, but nobody else learns it yet.
    at("2027-01-19T02:00:00Z");
    await t.runAutomation("playoff", [leagueId]);
    const leeView = (await t.call<WeekView>(LEE, "GET", `/weeks/${wc.id}`)).body;
    expect(leeView.playoff?.me).toMatchObject({ state: "out", outIn: 19, reason: "no_pow" });
    const patView = (await t.call<WeekView>(PAT, "GET", `/weeks/${wc.id}`)).body;
    expect(patView.results).toBeNull();
    expect(patView.myPicks.length).toBe(6);
    expect(JSON.stringify(patView)).not.toContain(SAM);
    expect(statusOf(await standings(PAT, leagueId), LEE)?.status).toMatchObject({ state: "in" });

    // The results are in: the round is final, and the Divisional round is prepared and opened.
    t.feed.set("2026:19", wildCard(true));
    t.feed.set("2026:20", divisional());
    at("2027-01-19T05:00:00Z");
    await t.runAutomation("playoff", [leagueId]);
    wc = await round(leagueId, 19);
    expect(wc.status).toBe("final");
    const dv = await round(leagueId, 20);
    expect(dv.status).toBe("open");
    expect(dv.games.map((g) => g.points)).toEqual([2, 2, 2, 2]);
    let table = await standings(PAT, leagueId);
    expect(statusOf(table, LEE)?.status).toMatchObject({ state: "out", outIn: 19 });
    expect(statusOf(table, SAM)?.status).toMatchObject({ state: "in" });
    expect(statusOf(table, PAT)).toMatchObject({ points: 6, status: { state: "in" } });
    // No round winner and no Low Point Loser.
    const results = (await t.call<WeekView>(PAT, "GET", `/weeks/${wc.id}`)).body.results;
    expect(results?.entries.every((e) => !e.isWinner)).toBe(true);

    // Kim joins during the Divisional round: no POW for the Wild Card, so out of picking.
    at("2027-01-20T12:00:00Z");
    await t.join(KIM, leagueId);
    expect((await pick(KIM, leagueId, 20, "dv1")).status).toBe(409);
    expect((await pick(LEE, leagueId, 20, "dv1")).status).toBe(409);
    expect((await pick(PAT, leagueId, 20, "dv1")).status).toBe(200);
    expect((await pick(SAM, leagueId, 20, "dv4")).status).toBe(200);

    t.feed.set("2026:20", divisional(true));
    t.feed.set("2026:21", conference());
    at("2027-01-25T05:00:00Z");
    await t.runAutomation("playoff", [leagueId]);
    expect((await round(leagueId, 20)).status).toBe("final");
    expect((await round(leagueId, 21)).status).toBe("open");
    table = await standings(PAT, leagueId);
    expect(statusOf(table, SAM)?.status).toMatchObject({ state: "out", outIn: 20, reason: "pow_lost" });
    expect(statusOf(table, KIM)?.status).toMatchObject({ state: "out", outIn: 19 });

    at("2027-01-27T12:00:00Z");
    expect((await pick(SAM, leagueId, 21, "cf1")).status).toBe(409);
    expect((await pick(PAT, leagueId, 21, "cf1")).status).toBe(200);
    t.feed.set("2026:21", conference(true));
    t.feed.set("2026:22", superBowl());
    at("2027-02-01T05:00:00Z");
    await t.runAutomation("playoff", [leagueId]);
    const sb = await round(leagueId, 22);
    expect(sb.status).toBe("open");
    expect(sb.games.map((g) => g.points)).toEqual([4]);

    // The Super Bowl has no POW: Pat's one pick is a plain pick. Eliminated players still guess the total.
    at("2027-02-10T12:00:00Z");
    expect((await pick(PAT, leagueId, 22, "sb", 45)).status).toBe(409);
    const patSb = await pick(PAT, leagueId, 22, null, 45);
    expect(patSb.status).toBe(200);
    expect(patSb.body.myPicks).toEqual([expect.objectContaining({ isPow: false })]);
    expect(patSb.body.playoff?.pow).toBe(false);
    expect(patSb.body.powBonus).toBe(0);
    for (const [user, guess] of [
      [SAM, 51],
      [LEE, 52],
    ] as const) {
      const saved = await t.call<WeekView>(user, "PUT", `/weeks/${sb.id}/picks`, {
        picks: [],
        powGameId: null,
        tiebreakerTotal: guess,
      });
      expect(saved.status).toBe(200);
      expect(saved.body.myTiebreakerTotal).toBe(guess);
      expect(saved.body.playoff?.mayPick).toBe(false);
    }

    t.feed.set("2026:22", superBowl(true));
    at("2027-02-15T05:00:00Z");
    await t.runAutomation("playoff", [leagueId]);
    expect((await round(leagueId, 22)).status).toBe("final");
    table = await standings(LEE, leagueId);
    expect(table.champions).toEqual(["Pat"]);
    expect(table.superBowlTotal).toBe(51);
    expect(table.entries.map((e) => [e.displayName, e.points, e.wins])).toEqual([
      // Wild Card 5 + 1, Divisional 6 + 1, Conference 6 + 1, Super Bowl 4 (no POW).
      ["Pat", 24, 11],
      ["Sam", 11, 8],
      ["Lee", 5, 5],
      ["Commish", 0, 0],
      ["Kim", 0, 0],
    ]);
    expect(table.entries.find((e) => e.userId === SAM)?.superBowlGuess).toBe(51);

    // Each round's open and final was announced once, and running again changes nothing.
    const events = await t.events(leagueId);
    expect(events.filter((e) => e.startsWith(`${PAT} week-open`))).toHaveLength(4);
    expect(events.filter((e) => e.startsWith(`${PAT} week-final`))).toHaveLength(4);
    const before = { rounds: await t.weeksOf(leagueId), events };
    expect(await t.runAutomation("playoff", [leagueId])).toEqual([]);
    await t.call(PAT, "GET", `/leagues/${leagueId}`);
    expect({ rounds: await t.weeksOf(leagueId), events: await t.events(leagueId) }).toEqual(before);
    // The recap points at the Super Bowl.
    expect((await t.call<LeagueDetail>(PAT, "GET", `/leagues/${leagueId}`)).body.recapWeekId).toBe(sb.id);
  });

  it("has no POW in a Traditional Super Bowl: one saved anyway scores as a plain pick", async () => {
    at("2026-11-22T12:00:00Z");
    const leagueId = await t.createLeague(ADMIN, { name: "Plain bracket", type: "playoff" });
    await t.join(PAT, leagueId);
    t.feed.set("2026:19", wildCard());
    t.feed.set("2026:22", superBowl());
    for (const number of [19, 22]) {
      const made = await t.call(ADMIN, "POST", `/leagues/${leagueId}/playoff/rounds`, { year: 2026, number });
      expect(made.status).toBe(201);
    }
    // Both rounds have every line, so automation opens them.
    await t.runAutomation("playoff", [leagueId]);
    expect((await round(leagueId, 22)).status).toBe("open");
    at("2027-01-12T12:00:00Z");
    // Earlier rounds keep the format's optional POW, worth 3.
    const wc = await pick(PAT, leagueId, 19, "wc1");
    expect(wc.body).toMatchObject({ powBonus: 3, playoff: { format: "traditional", pow: true } });
    expect(wc.body.myPicks.some((p) => p.isPow)).toBe(true);

    expect((await pick(PAT, leagueId, 22, "sb", 44)).status).toBe(409);
    const sb = await pick(PAT, leagueId, 22, null, 44);
    expect(sb.status).toBe(200);
    expect(sb.body).toMatchObject({ powBonus: 0, playoff: { pow: false } });
    expect(sb.body.myPicks).toEqual([expect.objectContaining({ isPow: false })]);
  });

  it("reminds a Guillotine player who picked every game but no POW, on the round's last game day", async () => {
    at("2026-11-22T12:00:00Z");
    const leagueId = await t.createLeague(ADMIN, {
      name: "POW reminder",
      type: "playoff",
      timeZone: "America/New_York",
      settings: { format: "guillotine" },
    });
    for (const user of [PAT, SAM, LEE]) await t.join(user, leagueId);
    t.feed.set("2026:19", wildCard());
    at("2027-01-11T12:30:00Z");
    await t.runAutomation("playoff", [leagueId]);
    const wc = await round(leagueId, 19);
    // Pat has a POW. Sam picks every game but no POW. Lee and the admin pick nothing.
    expect((await pick(PAT, leagueId, 19, "wc1")).status).toBe(200);
    expect((await pick(SAM, leagueId, 19, null)).status).toBe(200);
    const due = async () => {
      const [target] = (await REMINDERS.playoff.due(t.db, t.state.now)).filter(
        (r) => r.league.id === leagueId,
      );
      return new Map((target?.players ?? []).map((p) => [p.userId, p.message]));
    };

    // Saturday's reminder: only the players with games to pick. Sam can still put a POW on a later day.
    at("2027-01-16T12:00:00Z");
    let reminded = await due();
    expect([...reminded.keys()].sort()).toEqual([ADMIN, LEE].sort());
    expect(reminded.get(LEE)?.kind).toBe("games");

    // Monday's, the round's last game day (Sunday night's game has kicked off): Sam hears about the POW.
    at("2027-01-18T03:00:00Z");
    reminded = await due();
    expect([...reminded.keys()].sort()).toEqual([ADMIN, LEE, SAM].sort());
    expect(reminded.get(LEE)?.kind).toBe("games");
    expect(reminded.get(SAM)).toMatchObject({
      kind: "text",
      heading: "Choose your POW",
      path: `/weeks/${wc.id}`,
    });
    // It names the round and the rule, never a pick or a team.
    const text = JSON.stringify(reminded.get(SAM));
    expect(text).toContain("Wild Card round");
    for (const team of ["KC", "DEN", "Chiefs", "Broncos"]) expect(text).not.toContain(team);

    // The send-time recheck: still due for Sam, not for Pat, and gone once Sam chooses one.
    const ref = (userId: string) => ({ subjectId: wc.id, date: "2027-01-18", userId });
    expect((await reminderStillApplies(t.db, ref(SAM), t.state.now))?.message.kind).toBe("text");
    expect(await reminderStillApplies(t.db, ref(PAT), t.state.now)).toBeNull();
    expect((await pick(SAM, leagueId, 19, "wc6")).status).toBe(200);
    expect(await reminderStillApplies(t.db, ref(SAM), t.state.now)).toBeNull();
    expect([...(await due()).keys()].sort()).toEqual([ADMIN, LEE].sort());

    // Traditional has no such rule: all games picked means no reminder.
    const plain = await t.createLeague(ADMIN, {
      name: "No POW rule",
      type: "playoff",
      timeZone: "America/New_York",
    });
    await t.join(SAM, plain);
    at("2027-01-18T03:05:00Z");
    await t.runAutomation("playoff", [plain]);
    const open = await round(plain, 19);
    expect(
      (
        await t.call(SAM, "PUT", `/weeks/${open.id}/picks`, {
          picks: open.games
            .filter((g) => g.externalId === "wc6")
            .map((g) => ({ gameId: g.id, side: "home" })),
          powGameId: null,
          tiebreakerTotal: null,
        })
      ).status,
    ).toBe(200);
    const others = (await REMINDERS.playoff.due(t.db, t.state.now)).filter((r) => r.league.id === plain);
    expect(others.flatMap((r) => r.players.map((p) => p.userId))).toEqual([ADMIN]);
  });

  it("keeps the format until the first Wild Card kickoff, and guards its routes by type", async () => {
    at("2026-11-21T12:00:00Z");
    const leagueId = await t.createLeague(ADMIN, { name: "Format", type: "playoff" });
    const start = (format: string) =>
      t.call(ADMIN, "POST", `/leagues/${leagueId}/seasons`, { year: 2026, settings: { format } });
    expect((await start("guillotine")).status).toBe(201);
    expect((await start("nonsense")).status).toBe(400);
    // The manual fallback creates a round by hand, worth the round's points.
    t.feed.set("2026:19", wildCard());
    const created = await t.call<{ id: string; importError: string | null }>(
      ADMIN,
      "POST",
      `/leagues/${leagueId}/playoff/rounds`,
      { year: 2026, number: 19 },
    );
    expect(created.status).toBe(201);
    expect((await round(leagueId, 19)).games.every((g) => g.points === 1)).toBe(true);
    expect(
      (await t.call(ADMIN, "POST", `/leagues/${leagueId}/playoff/rounds`, { year: 2026, number: 19 })).status,
    ).toBe(409);
    expect(
      (await t.call(PAT, "POST", `/leagues/${leagueId}/playoff/rounds`, { year: 2026, number: 20 })).status,
    ).toBe(404);

    at("2027-01-16T22:00:00Z");
    expect((await start("traditional")).status).toBe(409);
    expect((await start("guillotine")).status).toBe(201);

    // Another type's league, or a stranger, gets a 404.
    const weekly = await t.createLeague(ADMIN, { name: "Plain weekly" });
    expect(
      (await t.call(ADMIN, "POST", `/leagues/${weekly}/playoff/rounds`, { year: 2026, number: 19 })).status,
    ).toBe(404);
    expect((await t.call(ADMIN, "GET", `/leagues/${weekly}/playoff/standings`)).status).toBe(404);
    expect((await t.call(OUTSIDER, "GET", `/leagues/${leagueId}/playoff/standings`)).status).toBe(404);
    // And weekly pick'em's season table, scored with its own POW bonus, isn't a playoff league's.
    expect((await t.call(ADMIN, "GET", `/leagues/${leagueId}/standings`)).status).toBe(404);
    expect((await t.call(ADMIN, "GET", `/leagues/${weekly}/standings`)).status).toBe(200);
  });
});
