import { leagueMembers, leagues } from "@picks/db";
import type { LeagueDetail, Standings, WeekView } from "@picks/shared";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { advanceLeague, NOTHING_DONE } from "../src/automation";
import { providerWeeks } from "../src/weekOps";
import { feedGame, pickemSetup } from "./pickemSetup";

// Weekly pick'em run by the feed (Automatic): draft and open, sync and finalize with no admin action, on a scripted
// feed and a clock the test moves. Week 13 of 2026: Thursday Dec 3, Sunday Dec 6 and Monday Dec 7 (Eastern), so its
// slate is drawn and it opens on Tuesday Dec 1 at 9 AM Eastern (14:00 UTC). Week 14 follows on Tuesday Dec 8.
const WEEK_13 = [
  feedGame("w13-thu", "DAL", "NYG", "2026-12-04T01:15:00Z", -3),
  feedGame("w13-sun", "PHI", "WAS", "2026-12-06T18:00:00Z", -6.5),
  feedGame("w13-mon", "KC", "BUF", "2026-12-08T01:15:00Z", 1),
];
const WEEK_13_FINALS = [
  feedGame("w13-thu", "DAL", "NYG", "2026-12-04T01:15:00Z", -3, [27, 20]),
  feedGame("w13-sun", "PHI", "WAS", "2026-12-06T18:00:00Z", -6.5, [17, 14]),
  feedGame("w13-mon", "KC", "BUF", "2026-12-08T01:15:00Z", 1, [24, 30]),
];
const WEEK_14 = [
  feedGame("w14-thu", "DET", "CHI", "2026-12-11T01:15:00Z", -4),
  feedGame("w14-sun", "SF", "SEA", "2026-12-13T21:25:00Z", -2.5),
];
const OPENS = new Date("2026-12-01T14:00:00Z");
const WEEK_14_OPENS = new Date("2026-12-08T14:00:00Z");

describe.skipIf(!process.env.DATABASE_URL)("Automatic weekly pick'em (requires `pnpm db:start`)", () => {
  const t = pickemSetup(["Commish", "Pat", "Sam"]);
  const [ADMIN = "", PAT = "", SAM = ""] = t.users;
  const at = (iso: string) => {
    t.state.now = new Date(iso);
  };
  const week = async (leagueId: string, number: number) => {
    const found = (await t.weeksOf(leagueId)).find((w) => w.number === number);
    if (!found) throw new Error(`No week ${number}`);
    return found;
  };
  let started = 0;
  /**
   * A fresh Automatic league with Pat in it, started at week 13 on Saturday, Nov 28. Each a few minutes after the
   * last, so the app's once-a-minute feed cache doesn't hand one test another's slate.
   */
  async function startedLeague(name: string) {
    at(new Date(Date.parse("2026-11-28T15:00:00Z") + started++ * 5 * 60_000).toISOString());
    const leagueId = await t.createLeague(ADMIN, { name, management: "auto" });
    await t.join(PAT, leagueId);
    expect(
      (await t.call(ADMIN, "POST", `/leagues/${leagueId}/seasons`, { year: 2026, startWeek: 13 })).status,
    ).toBe(201);
    return leagueId;
  }

  beforeAll(t.setUp);
  afterAll(t.tearDown);
  beforeEach(() => {
    t.feed.clear();
    t.feed.set("2026:13", WEEK_13);
  });

  it("runs a whole week with no admin action: draft and open on Tuesday, results, finalize, the next Tuesday", async () => {
    const leagueId = await startedLeague("Runs itself");
    // Start season made the start week an empty draft: nothing is drawn from the feed before its Tuesday.
    let w13 = await week(leagueId, 13);
    expect(w13.status).toBe("draft");
    expect(w13.games).toEqual([]);

    // The lines move before Tuesday: nobody ever sees Saturday's.
    t.feed.set(
      "2026:13",
      WEEK_13.map((g) => ({ ...g, spread: (g.spread ?? 0) + 10 })),
    );
    at(new Date(OPENS.getTime() - 60_000).toISOString());
    await t.runAutomation("weekly", [leagueId]);
    w13 = await week(leagueId, 13);
    expect([w13.status, w13.games.length]).toEqual(["draft", 0]);
    // Tuesday 9 AM Eastern: the slate is drawn with that morning's lines and opens in the same run.
    t.feed.set("2026:13", WEEK_13);
    at(OPENS.toISOString());
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([leagueId]);
    w13 = await week(leagueId, 13);
    expect(w13.status).toBe("open");
    // Worth the usual slot points.
    expect(w13.games.map((g) => [g.externalId, g.spread, g.points])).toEqual([
      ["w13-thu", -3, 3],
      ["w13-sun", -6.5, 1],
      ["w13-mon", 1, 3],
    ]);
    expect(await t.events(leagueId)).toEqual(
      [`${ADMIN} week-open:${w13.id}`, `${PAT} week-open:${w13.id}`].sort(),
    );

    // Spreads froze at opening: a new line from the feed changes nothing.
    t.feed.set(
      "2026:13",
      WEEK_13.map((g) => ({ ...g, spread: (g.spread ?? 0) - 1 })),
    );
    at("2026-12-02T12:00:00Z");
    await t.runAutomation("weekly", [leagueId]);
    expect((await week(leagueId, 13)).games.map((g) => g.spread)).toEqual([-3, -6.5, 1]);

    // Pat picks.
    const [thu, sun, mon] = w13.games;
    const picks = await t.call<WeekView>(PAT, "PUT", `/weeks/${w13.id}/picks`, {
      picks: [
        { gameId: thu?.id, side: "home" },
        { gameId: sun?.id, side: "away" },
        { gameId: mon?.id, side: "away" },
      ],
      powGameId: mon?.id,
      tiebreakerTotal: 50,
    });
    expect(picks.status).toBe(200);

    // The admin types Thursday's score in by hand; the feed's own final never replaces it.
    at("2026-12-04T05:00:00Z");
    expect((await t.call(ADMIN, "PATCH", `/games/${thu?.id}`, { homeScore: 30, awayScore: 20 })).status).toBe(
      200,
    );
    t.feed.set("2026:13", [...WEEK_13_FINALS.slice(0, 2), ...WEEK_13.slice(2)]);
    at("2026-12-06T21:00:00Z");
    await t.runAutomation("weekly", [leagueId]);
    w13 = await week(leagueId, 13);
    expect(w13.status).toBe("open");
    expect(w13.games.map((g) => [g.homeScore, g.awayScore])).toEqual([
      [30, 20],
      [17, 14],
      [null, null],
    ]);

    // Monday's game ends: the week finalizes and "final" is announced once. Week 14 waits for its Tuesday.
    t.feed.set("2026:13", WEEK_13_FINALS);
    t.feed.set("2026:14", WEEK_14);
    at("2026-12-08T05:00:00Z");
    await t.runAutomation("weekly", [leagueId]);
    w13 = await week(leagueId, 13);
    expect(w13.status).toBe("final");
    expect(w13.finalizedAt).toEqual(t.state.now);
    expect((await t.weeksOf(leagueId)).map((w) => w.number)).toEqual([13]);
    const finalEvent = `week-final:${w13.id}:${t.state.now.getTime()}`;
    expect(await t.events(leagueId)).toEqual(
      [
        `${ADMIN} week-open:${w13.id}`,
        `${PAT} week-open:${w13.id}`,
        `${ADMIN} ${finalEvent}`,
        `${PAT} ${finalEvent}`,
      ].sort(),
    );

    // Running it again leaves the same state: until Tuesday morning there is nothing due.
    const before = { weeks: await t.weeksOf(leagueId), events: await t.events(leagueId) };
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([]);
    at(new Date(WEEK_14_OPENS.getTime() - 60_000).toISOString());
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([]);
    expect({ weeks: await t.weeksOf(leagueId), events: await t.events(leagueId) }).toEqual(before);

    // Tuesday 9 AM Eastern: Week 14 is created, drawn and opened in one run.
    at(WEEK_14_OPENS.toISOString());
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([leagueId]);
    const w14 = await week(leagueId, 14);
    expect(w14.status).toBe("open");
    expect(w14.games.map((g) => [g.externalId, g.spread])).toEqual([
      ["w14-thu", -4],
      ["w14-sun", -2.5],
    ]);
    expect((await t.events(leagueId)).filter((e) => e.endsWith(`week-open:${w14.id}`))).toHaveLength(2);
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([]);

    // The results and the recap: Pat won all three, Monday (BUF +1) as the POW.
    const view = await t.call<WeekView>(PAT, "GET", `/weeks/${w13.id}`);
    expect(view.body.results?.entries.find((e) => e.userId === PAT)).toMatchObject({
      points: 3 + 1 + 3 + 5,
      wins: 3,
    });
    expect((await t.call<LeagueDetail>(PAT, "GET", `/leagues/${leagueId}`)).body.recapWeekId).toBe(w13.id);

    // A final week is corrected in place, without reopening it: standings follow, and the recap shows again.
    await t.call(PAT, "POST", `/weeks/${w13.id}/recap/seen`);
    expect((await t.call<LeagueDetail>(PAT, "GET", `/leagues/${leagueId}`)).body.recapWeekId).toBeNull();
    at("2026-12-08T15:00:00Z");
    expect((await t.call(ADMIN, "PATCH", `/games/${sun?.id}`, { homeScore: 30, awayScore: 14 })).status).toBe(
      200,
    );
    expect((await week(leagueId, 13)).status).toBe("final");
    const standings = await t.call<Standings>(PAT, "GET", `/leagues/${leagueId}/standings?year=2026`);
    expect(standings.body.entries.find((e) => e.userId === PAT)?.points).toBe(3 + 3 + 5);
    expect((await t.call<LeagueDetail>(PAT, "GET", `/leagues/${leagueId}`)).body.recapWeekId).toBe(w13.id);
    // Only scores: a final week's spread stands, and a score can't be cleared.
    expect((await t.call(ADMIN, "PATCH", `/games/${sun?.id}`, { spread: -1 })).status).toBe(409);
    expect(
      (await t.call(ADMIN, "PATCH", `/games/${sun?.id}`, { homeScore: null, awayScore: null })).status,
    ).toBe(409);
  });

  it("tells the admins once about a missing line a day before kickoff, and opens as soon as it is typed in", async () => {
    t.feed.set(
      "2026:13",
      WEEK_13.map((g) => (g.externalId === "w13-sun" ? { ...g, spread: null } : g)),
    );
    const leagueId = await startedLeague("Missing line");
    at("2026-12-01T15:00:00Z");
    await t.runAutomation("weekly", [leagueId]);
    expect((await week(leagueId, 13)).status).toBe("draft");
    expect(await t.events(leagueId)).toEqual([]);

    // 24 hours before Thursday's kickoff: the admins hear of it, once. Players don't.
    at("2026-12-03T01:15:00Z");
    await t.runAutomation("weekly", [leagueId]);
    await t.runAutomation("weekly", [leagueId]);
    const w13 = await week(leagueId, 13);
    expect(await t.events(leagueId)).toEqual([`${ADMIN} missing-line:${w13.id}`]);

    // The admin types the line in, and the week opens right then.
    const sunday = w13.games.find((g) => g.externalId === "w13-sun");
    expect((await t.call(ADMIN, "PATCH", `/games/${sunday?.id}`, { spread: -7 })).status).toBe(200);
    expect((await week(leagueId, 13)).status).toBe("open");
    expect((await t.events(leagueId)).filter((e) => e.includes("week-open"))).toHaveLength(2);
  });

  it("never overwrites an admin's spread, points, tiebreaker or removed game on a re-import", async () => {
    const leagueId = await startedLeague("Admin's choices");
    // The admin sets the week up by hand ahead of its Tuesday: the draft has games, and keeps following the feed.
    let w13 = await week(leagueId, 13);
    expect((await t.call(ADMIN, "POST", `/weeks/${w13.id}/import`)).status).toBe(200);
    w13 = await week(leagueId, 13);
    const [thu, sun, mon] = w13.games;
    expect((await t.call(ADMIN, "PATCH", `/games/${thu?.id}`, { spread: -7 })).status).toBe(200);
    expect((await t.call(ADMIN, "PATCH", `/games/${sun?.id}`, { points: 5 })).status).toBe(200);
    expect((await t.call(ADMIN, "PATCH", `/weeks/${w13.id}`, { tiebreakerGameId: thu?.id })).status).toBe(
      200,
    );
    expect((await t.call(ADMIN, "DELETE", `/games/${mon?.id}`)).status).toBe(200);

    // The feed moves every line and Sunday's kickoff.
    t.feed.set("2026:13", [
      { ...WEEK_13[0], spread: -2 },
      { ...WEEK_13[1], spread: -3, kickoff: new Date("2026-12-07T01:20:00Z") },
      { ...WEEK_13[2], spread: 4 },
    ] as typeof WEEK_13);
    at("2026-11-30T12:00:00Z");
    await t.runAutomation("weekly", [leagueId]);
    w13 = await week(leagueId, 13);
    expect(w13.games.map((g) => [g.externalId, g.spread, g.points])).toEqual([
      ["w13-thu", -7, 3],
      ["w13-sun", -3, 5],
    ]);
    expect(w13.tiebreakerGameId).toBe(thu?.id);

    // Once the first game kicks off, spreads and points stand.
    await t.runAutomation("weekly", [leagueId]);
    at("2026-12-04T02:00:00Z");
    await t.runAutomation("weekly", [leagueId]);
    expect((await week(leagueId, 13)).status).toBe("open");
    expect((await t.call(ADMIN, "PATCH", `/games/${sun?.id}`, { spread: -1 })).status).toBe(409);
    expect((await t.call(ADMIN, "PATCH", `/games/${sun?.id}`, { points: 2 })).status).toBe(409);
  });

  it("picks the weeks up as they stand when a hands-on league switches, and stops when it switches back", async () => {
    at("2026-12-01T15:00:00Z");
    const leagueId = await t.createLeague(ADMIN, { name: "Switcher" });
    await t.join(SAM, leagueId);
    // Week 13, imported as a ready draft; week 12, open by hand with every score typed in.
    const created = await t.call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/weeks`, {
      year: 2026,
      number: 13,
    });
    expect(created.status).toBe(201);
    const w12 = (
      await t.call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/weeks`, {
        year: 2026,
        number: 12,
        importGames: false,
      })
    ).body.id;
    await t.call(ADMIN, "POST", `/weeks/${w12}/games`, {
      homeTeam: "MIA",
      awayTeam: "NYJ",
      kickoff: "2026-11-29T18:00:00Z",
      spread: -3,
    });
    await t.call(ADMIN, "POST", `/weeks/${w12}/open`);
    const [game12] = (await week(leagueId, 12)).games;
    await t.call(ADMIN, "PATCH", `/games/${game12?.id}`, { homeScore: 21, awayScore: 10 });

    // Hands-on: never due, and advancing it does nothing.
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([]);
    const [league] = await t.db.select().from(leagues).where(eq(leagues.id, leagueId));
    if (!league) throw new Error("No league");
    const ctx = {
      db: t.db,
      nfl: { getWeek: async () => WEEK_13 },
      now: t.state.now,
      results: providerWeeks({ getWeek: async () => WEEK_13 }, () => t.state.now),
      notify: {},
    };
    expect(await advanceLeague(ctx, league)).toEqual(NOTHING_DONE);
    expect((await t.weeksOf(leagueId)).map((w) => [w.number, w.status])).toEqual([
      [12, "open"],
      [13, "draft"],
    ]);

    // Mid-week, the admin switches to Automatic: the ready draft opens and the finished week finalizes.
    expect((await t.call(ADMIN, "PATCH", `/leagues/${leagueId}`, { management: "auto" })).status).toBe(200);
    await t.runAutomation("weekly", [leagueId]);
    expect((await t.weeksOf(leagueId)).map((w) => [w.number, w.status])).toEqual([
      [12, "final"],
      [13, "open"],
    ]);

    // Back to hands-on: automation stops and leaves every week as it is, results included.
    expect((await t.call(ADMIN, "PATCH", `/leagues/${leagueId}`, { management: "manual" })).status).toBe(200);
    t.feed.set("2026:13", WEEK_13_FINALS);
    at("2026-12-08T05:00:00Z");
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([]);
    const w13 = await week(leagueId, 13);
    expect(w13.status).toBe("open");
    expect(w13.games.every((g) => g.homeScore === null)).toBe(true);
    // A hands-on league starts its season with its first week, not Start season.
    expect(
      (await t.call(ADMIN, "POST", `/leagues/${leagueId}/seasons`, { year: 2027, startWeek: 1 })).status,
    ).toBe(409);
  });

  it("asks the feed once per NFL week per run, however many leagues wait on it", async () => {
    const first = await startedLeague("Shared feed 1");
    const second = await startedLeague("Shared feed 2");
    at("2026-11-30T12:00:00Z");
    t.asked.length = 0;
    expect((await t.runAutomation("weekly", [first, second])).sort()).toEqual([first, second].sort());
    expect(t.asked).toEqual(["2026:13"]);
  });

  it("refuses Start season twice, for a season that is over, without a start week, and in a squares league", async () => {
    const leagueId = await startedLeague("Started");
    expect(
      (await t.call(ADMIN, "POST", `/leagues/${leagueId}/seasons`, { year: 2026, startWeek: 14 })).status,
    ).toBe(409);
    // Automation never runs a past season, so it can't be started.
    const past = await t.createLeague(ADMIN, { name: "Last year", management: "auto" });
    expect(
      (await t.call(ADMIN, "POST", `/leagues/${past}/seasons`, { year: 2025, startWeek: 14 })).status,
    ).toBe(409);
    expect(await t.weeksOf(past)).toEqual([]);
    const other = await t.createLeague(ADMIN, { name: "No week", management: "auto" });
    expect((await t.call(ADMIN, "POST", `/leagues/${other}/seasons`, { year: 2026 })).status).toBe(400);
    expect(
      (await t.call(PAT, "POST", `/leagues/${leagueId}/seasons`, { year: 2027, startWeek: 1 })).status,
    ).toBe(403);
    const squares = await t.createLeague(ADMIN, { name: "Board", type: "squares" });
    expect((await t.call(ADMIN, "POST", `/leagues/${squares}/seasons`, { year: 2026 })).status).toBe(409);
    // The admin is still a member of everything they made; nothing else was created.
    const memberships = await t.db
      .select()
      .from(leagueMembers)
      .where(and(eq(leagueMembers.leagueId, other), eq(leagueMembers.userId, ADMIN)));
    expect(memberships).toHaveLength(1);
    expect(await t.weeksOf(other)).toEqual([]);
  });

  it("moves an open week's game to the feed's new kickoff, and never its line", async () => {
    const leagueId = await startedLeague("Flexed");
    at(OPENS.toISOString());
    await t.runAutomation("weekly", [leagueId]);
    const w13 = await week(leagueId, 13);
    const game = async (externalId: string) =>
      (await week(leagueId, 13)).games.find((g) => g.externalId === externalId);

    // Sunday afternoon's game is flexed to Sunday night, with a new line.
    const sundayNight = new Date("2026-12-07T01:20:00Z");
    t.feed.set(
      "2026:13",
      WEEK_13.map((g) => (g.externalId === "w13-sun" ? { ...g, kickoff: sundayNight, spread: -9 } : g)),
    );
    at("2026-12-02T12:00:00Z");
    // Nothing for the cron to score yet; a player's read follows the feed.
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([]);
    expect((await t.call(PAT, "GET", `/weeks/${w13.id}`)).status).toBe(200);
    // It locks at the new time and takes Sunday night's points; the line players picked against stands.
    expect(await game("w13-sun")).toMatchObject({ kickoff: sundayNight, spread: -6.5, points: 2 });

    // Once the week is under way, a postponed game still moves, but the slate's points stand.
    const tuesday = new Date("2026-12-09T01:15:00Z");
    t.feed.set(
      "2026:13",
      WEEK_13.map((g) =>
        g.externalId === "w13-sun"
          ? { ...g, kickoff: sundayNight }
          : g.externalId === "w13-mon"
            ? { ...g, kickoff: tuesday }
            : g,
      ),
    );
    at("2026-12-04T02:00:00Z");
    expect((await t.call(PAT, "GET", `/weeks/${w13.id}`)).status).toBe(200);
    expect(await game("w13-mon")).toMatchObject({ kickoff: tuesday, spread: 1, points: 3 });
  });

  it("is due only with something to do", async () => {
    // A start week far ahead has nothing to do until its own week comes round.
    at("2026-11-28T14:00:00Z");
    const later = await t.createLeague(ADMIN, { name: "Starts later", management: "auto" });
    expect(
      (await t.call(ADMIN, "POST", `/leagues/${later}/seasons`, { year: 2026, startWeek: 16 })).status,
    ).toBe(201);
    const leagueId = await startedLeague("Due set");
    at("2026-11-30T12:00:00Z");
    // An empty draft in its own week is looked at each run, so it opens on time.
    expect(await t.runAutomation("weekly", [leagueId, later])).toEqual([leagueId]);
    // Open, nothing kicked off long enough ago to be over: not due.
    at(OPENS.toISOString());
    await t.runAutomation("weekly", [leagueId]);
    at("2026-12-02T12:00:00Z");
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([]);
    // A game that could be over: due.
    at("2026-12-04T04:00:00Z");
    expect(await t.runAutomation("weekly", [leagueId])).toEqual([leagueId]);
  });
});
