import { readFileSync } from "node:fs";
import { games } from "@picks/db";
import type { Game, WeekView } from "@picks/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type ProviderGame, parseEspnScoreboard } from "../src/nfl";
import { gameLive, RESULTS_REFRESH_MS } from "../src/weekOps";
import { feedGame, pickemSetup } from "./pickemSetup";

/*
 * The live score on an open pick'em week: read from the scoreboard feed, never stored, never a result.
 *
 * The fixture is a real ESPN scoreboard (2026 week 11, Sunday Nov 22 during the early games) trimmed to the fields
 * the parser reads: two games being played in the 2nd quarter, one at halftime, one scheduled and one final.
 */
const scoreboard = JSON.parse(
  readFileSync(new URL("./fixtures/espn-scoreboard-live.json", import.meta.url), "utf8"),
) as { events: { id: string; competitions: { status: Record<string, unknown> }[] }[] };

const byId = (parsed: ProviderGame[], id: string) => {
  const game = parsed.find((g) => g.externalId === id);
  if (!game) throw new Error(`No game ${id}`);
  return game;
};

/** The fixture with one game's `status` changed. */
const withStatus = (id: string, change: (status: Record<string, unknown>) => Record<string, unknown>) => {
  const copy = structuredClone(scoreboard);
  const competition = copy.events.find((e) => e.id === id)?.competitions[0];
  if (!competition) throw new Error(`No game ${id}`);
  competition.status = change(competition.status);
  return copy;
};

const PLAYING = "401873070"; // MIA at BUF, 1:29 left in the 2nd quarter, 20–3.
const HALFTIME = "401873072"; // TB at DET, halftime, 10–7.
const SCHEDULED = "401873074"; // NYJ at LAC, later that afternoon.
const FINAL = "401873066"; // IND at HOU, Thursday's game, 26–3.

describe("the feed's game clock", () => {
  it("reads the clock and the period of a game being played, and never its score as a result", () => {
    const parsed = parseEspnScoreboard(scoreboard);
    expect(byId(parsed, PLAYING)).toMatchObject({
      status: "in_progress",
      period: 2,
      liveState: "playing",
      clock: "1:29",
      liveScore: { home: 20, away: 3 },
      homeScore: null,
      awayScore: null,
    });
    expect(byId(parsed, "401873067")).toMatchObject({ liveState: "playing", clock: "0:11" });
  });

  it("reads halftime as a break with no clock", () => {
    const halftime = byId(parseEspnScoreboard(scoreboard), HALFTIME);
    expect(halftime).toMatchObject({
      status: "in_progress",
      period: 2,
      liveState: "halftime",
      liveScore: { home: 10, away: 7 },
      homeScore: null,
    });
    // The feed prints "0:00" at the break.
    expect(halftime.clock).toBeUndefined();
  });

  it("gives a scheduled or final game no live state and no clock", () => {
    const parsed = parseEspnScoreboard(scoreboard);
    for (const id of [SCHEDULED, FINAL]) {
      const game = byId(parsed, id);
      expect(game.liveState).toBeUndefined();
      expect(game.clock).toBeUndefined();
      expect(game.liveScore).toBeUndefined();
    }
    expect(byId(parsed, SCHEDULED)).toMatchObject({ status: "scheduled", period: 0, spread: -3 });
    expect(byId(parsed, FINAL)).toMatchObject({ status: "final", homeScore: 26, awayScore: 3 });
  });

  it("never fails the scoreboard over a clock it can't read: the game just has none", () => {
    const odd: unknown[] = [null, 89, "", "  ", "1:29 - 2nd", "soon", { minutes: 1 }, ["1:29"]];
    for (const displayClock of odd) {
      const parsed = parseEspnScoreboard(withStatus(PLAYING, (status) => ({ ...status, displayClock })));
      // Every game is still read, with everything else as before.
      expect(parsed.map((g) => g.externalId)).toEqual(
        parseEspnScoreboard(scoreboard).map((g) => g.externalId),
      );
      expect(byId(parsed, PLAYING)).toMatchObject({
        status: "in_progress",
        liveState: "playing",
        liveScore: { home: 20, away: 3 },
      });
      expect(byId(parsed, PLAYING).clock, JSON.stringify(displayClock)).toBeUndefined();
    }
    const { displayClock: _, ...noClock } = scoreboard.events[0]?.competitions[0]?.status ?? {};
    const missing = parseEspnScoreboard(withStatus(PLAYING, () => noClock));
    expect(byId(missing, PLAYING)).toMatchObject({ liveState: "playing", period: 2 });
    expect(byId(missing, PLAYING).clock).toBeUndefined();
  });

  // A real payload: the same Sunday's TB at DET at the break after the 3rd quarter (17–14). The feed holds the
  // period at the quarter just ended and prints "0:00".
  it("reads the break after a quarter, with the period still the quarter just ended", () => {
    const endOfQuarter = JSON.parse(
      readFileSync(new URL("./fixtures/espn-scoreboard-end-of-quarter.json", import.meta.url), "utf8"),
    );
    const [game] = parseEspnScoreboard(endOfQuarter);
    expect(game).toMatchObject({
      status: "in_progress",
      period: 3,
      liveState: "end_of_period",
      liveScore: { home: 17, away: 14 },
      homeScore: null,
      periodScores: { q1: { home: 0, away: 0 }, half: { home: 10, away: 7 }, q3: { home: 17, away: 14 } },
    });
    expect(game?.clock).toBeUndefined();
    expect(game && gameLive(game)).toEqual({
      homeScore: 17,
      awayScore: 14,
      period: 3,
      clock: null,
      state: "end_of_period",
    });
  });

  // Not seen in a real payload yet (built from the shape we expect): the break after the 1st quarter, overtime, and
  // a status name the app doesn't know (a weather delay, say).
  it("reads the break after a quarter, overtime and an unknown status name (assumed shapes)", () => {
    const status = (name: string, period: number, displayClock: string) => (s: Record<string, unknown>) => ({
      ...s,
      displayClock,
      period,
      type: { name, state: "in", completed: false },
    });
    const endOfQ1 = byId(
      parseEspnScoreboard(withStatus(PLAYING, status("STATUS_END_PERIOD", 1, "0:00"))),
      PLAYING,
    );
    expect(endOfQ1).toMatchObject({ status: "in_progress", period: 1, liveState: "end_of_period" });
    expect(endOfQ1.clock).toBeUndefined();

    const overtime = byId(
      parseEspnScoreboard(withStatus(PLAYING, status("STATUS_IN_PROGRESS", 5, "8:12"))),
      PLAYING,
    );
    expect(overtime).toMatchObject({ period: 5, liveState: "playing", clock: "8:12" });

    const delayed = byId(
      parseEspnScoreboard(withStatus(PLAYING, status("STATUS_DELAYED", 3, "6:40"))),
      PLAYING,
    );
    expect(delayed).toMatchObject({ status: "in_progress", period: 3, liveState: "playing", clock: "6:40" });
  });
});

describe("gameLive", () => {
  const playing: ProviderGame = {
    ...feedGame("g", "BUF", "MIA", "2026-11-22T18:00:00Z", -6),
    status: "in_progress",
    period: 3,
    liveScore: { home: 20, away: 3 },
    liveState: "playing",
    clock: "4:12",
  };

  it("gives a game in progress its score, period, clock and state", () => {
    expect(gameLive(playing)).toEqual({
      homeScore: 20,
      awayScore: 3,
      period: 3,
      clock: "4:12",
      state: "playing",
    });
    expect(gameLive({ ...playing, liveState: "halftime", period: 2 })).toEqual({
      homeScore: 20,
      awayScore: 3,
      period: 2,
      // A clock scripted at a break is dropped: there is none.
      clock: null,
      state: "halftime",
    });
  });

  it("says nothing it doesn't know: no period before the feed gives one, playing when it doesn't say", () => {
    const { liveState: _, clock: __, ...bare } = playing;
    expect(gameLive({ ...bare, period: 0 })).toEqual({
      homeScore: 20,
      awayScore: 3,
      period: null,
      clock: null,
      state: "playing",
    });
    expect(gameLive({ ...bare, period: undefined })?.period).toBeNull();
  });

  it("is null for a game not in progress, or with no score", () => {
    expect(gameLive({ ...playing, status: "scheduled" })).toBeNull();
    expect(gameLive({ ...playing, status: "final", homeScore: 27, awayScore: 3 })).toBeNull();
    expect(gameLive({ ...playing, status: undefined })).toBeNull();
    expect(gameLive({ ...playing, liveScore: undefined })).toBeNull();
  });
});

// Week 13 of 2026: Thursday Dec 3, Sunday Dec 6 and Monday Dec 7 (Eastern).
const THU = "2026-12-04T01:15:00Z";
const SUN = "2026-12-06T18:00:00Z";
const MON = "2026-12-08T01:15:00Z";
const SLATE = [
  feedGame("lv-thu", "DAL", "NYG", THU, -3),
  feedGame("lv-sun", "PHI", "WAS", SUN, -6.5),
  feedGame("lv-mon", "KC", "BUF", MON, 1),
];
/** The slate as the feed has it while Thursday's game is being played. */
const thursdayUnderway = (thu: Partial<ProviderGame>, sun: Partial<ProviderGame> = {}): ProviderGame[] => [
  { ...feedGame("lv-thu", "DAL", "NYG", THU, -3), status: "in_progress", ...thu },
  { ...feedGame("lv-sun", "PHI", "WAS", SUN, -6.5), status: "scheduled", ...sun },
  { ...feedGame("lv-mon", "KC", "BUF", MON, 1), status: "scheduled" },
];

describe.skipIf(!process.env.DATABASE_URL)("live scores on the pick sheet (requires `pnpm db:start`)", () => {
  const t = pickemSetup(["Commish", "Pat"]);
  const [ADMIN = "", PAT = ""] = t.users;
  const at = (iso: string) => {
    t.state.now = new Date(iso);
  };
  const later = (ms = RESULTS_REFRESH_MS) => {
    t.state.now = new Date(t.state.now.getTime() + ms);
  };
  let leagueId = "";
  let weekId = "";
  let ids: Record<"thu" | "sun" | "mon" | "hand", string> = { thu: "", sun: "", mon: "", hand: "" };
  const read = async (user = PAT) => {
    const res = await t.call<WeekView>(user, "GET", `/weeks/${weekId}`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const gameIn = (view: WeekView, key: keyof typeof ids): Game => {
    const game = view.games.find((g) => g.id === ids[key]);
    if (!game) throw new Error(`No ${key} game`);
    return game;
  };
  /** Which games carry a live score, by key. */
  const liveIn = (view: WeekView) =>
    (Object.keys(ids) as (keyof typeof ids)[]).filter((key) => gameIn(view, key).live != null);
  const stored = async (key: keyof typeof ids) => {
    const [row] = await t.db.select().from(games).where(eq(games.id, ids[key]));
    return [row?.homeScore, row?.awayScore];
  };

  beforeAll(async () => {
    await t.setUp();
    at("2026-12-01T12:00:00Z");
    leagueId = await t.createLeague(ADMIN, { name: "Live scores", management: "manual" });
    await t.join(PAT, leagueId);
    t.feed.set("2026:13", SLATE);
    const created = await t.call<{ id: string }>(ADMIN, "POST", `/leagues/${leagueId}/weeks`, {
      year: 2026,
      number: 13,
      importGames: true,
    });
    expect(created.status).toBe(201);
    weekId = created.body.id;
    // A game the admin adds by hand, kicking off with Thursday's: it has no provider id, so never a live score.
    const added = await t.call<WeekView>(ADMIN, "POST", `/weeks/${weekId}/games`, {
      homeTeam: "SEA",
      awayTeam: "SF",
      kickoff: THU,
      spread: 2.5,
    });
    expect(added.status).toBe(201);
    const byTeam = (home: string) => added.body.games.find((g) => g.homeTeam === home)?.id ?? "";
    ids = { thu: byTeam("DAL"), sun: byTeam("PHI"), mon: byTeam("KC"), hand: byTeam("SEA") };
  });
  afterAll(t.tearDown);

  it("asks the feed nothing for a draft or for an open week before any of its games kicks off", async () => {
    // Thursday under way, but the week is still a draft.
    at("2026-12-04T02:00:00Z");
    t.feed.set("2026:13", thursdayUnderway({ period: 1, liveScore: { home: 7, away: 3 }, clock: "4:12" }));
    const asked = t.asked.length;
    const draft = await read(ADMIN);
    expect(draft.status).toBe("draft");
    expect(liveIn(draft)).toEqual([]);
    expect(t.asked.length).toBe(asked);

    // Open before anything has kicked off: still nothing to ask.
    at("2026-12-03T12:00:00Z");
    expect((await t.call(ADMIN, "POST", `/weeks/${weekId}/open`)).status).toBe(200);
    const open = await read();
    expect(open.status).toBe("open");
    expect(liveIn(open)).toEqual([]);
    expect(t.asked.length).toBe(asked);
  });

  it("gives a game being played its live score, and keeps its own score empty and unstored", async () => {
    // Pat picks Sunday's game before Thursday kicks off.
    const pick = await t.call<WeekView>(PAT, "PUT", `/weeks/${weekId}/picks`, {
      picks: [{ gameId: ids.sun, side: "home" }],
      powGameId: null,
      tiebreakerTotal: null,
    });
    expect(pick.status).toBe(200);

    // Thursday night, 4:12 left in the 1st. The feed also (wrongly) has Sunday's game under way already.
    at("2026-12-04T02:00:00Z");
    t.feed.set(
      "2026:13",
      thursdayUnderway(
        { period: 1, liveScore: { home: 7, away: 3 }, liveState: "playing", clock: "4:12" },
        { status: "in_progress", period: 1, liveScore: { home: 0, away: 0 }, clock: "15:00" },
      ),
    );
    const asked = t.asked.length;
    const view = await read();
    expect(t.asked.length).toBe(asked + 1);
    expect(gameIn(view, "thu")).toMatchObject({
      homeScore: null,
      awayScore: null,
      live: { homeScore: 7, awayScore: 3, period: 1, clock: "4:12", state: "playing" },
    });
    // Sunday's hasn't kicked off by the league's slate, the hand-added game has no feed, Monday's is to come.
    expect(liveIn(view)).toEqual(["thu"]);
    expect(await stored("thu")).toEqual([null, null]);

    // Another player in the same minute: the same answer, from the same read of the feed.
    expect(gameIn(await read(ADMIN), "thu").live).toMatchObject({ homeScore: 7, awayScore: 3 });
    expect(t.asked.length).toBe(asked + 1);

    // Saving picks, and every admin route, answers with no live score and never asks the feed.
    const saved = await t.call<WeekView>(PAT, "PUT", `/weeks/${weekId}/picks`, {
      picks: [{ gameId: ids.sun, side: "away" }],
      powGameId: null,
      tiebreakerTotal: null,
    });
    expect(saved.status).toBe(200);
    expect(liveIn(saved.body)).toEqual([]);
    const patched = await t.call<WeekView>(ADMIN, "PATCH", `/weeks/${weekId}`, { tiebreakerGameId: ids.mon });
    expect(patched.status).toBe(200);
    expect(liveIn(patched.body)).toEqual([]);
    expect(t.asked.length).toBe(asked + 1);
  });

  it("shows halftime, and nothing when the feed can't be reached", async () => {
    later();
    t.feed.set(
      "2026:13",
      thursdayUnderway({ period: 2, liveScore: { home: 14, away: 10 }, liveState: "halftime" }),
    );
    expect(gameIn(await read(), "thu").live).toEqual({
      homeScore: 14,
      awayScore: 10,
      period: 2,
      clock: null,
      state: "halftime",
    });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    t.state.feedDown = true;
    later();
    const down = await read();
    t.state.feedDown = false;
    expect(liveIn(down)).toEqual([]);
    expect(gameIn(down, "thu")).toMatchObject({ homeScore: null, awayScore: null });
    expect(log.mock.calls[0]?.[0]).toContain("results_autosync");
    log.mockRestore();
  });

  it("gives a game with a result no live score, whether typed in or from the feed", async () => {
    later();
    t.feed.set(
      "2026:13",
      thursdayUnderway({ period: 3, liveScore: { home: 21, away: 10 }, liveState: "playing", clock: "9:58" }),
    );
    expect(liveIn(await read())).toEqual(["thu"]);
    // The admin types a score in. A read in the same minute reuses the feed's answer, still "in progress", but a
    // game with a result has no live score.
    expect((await t.call(ADMIN, "PATCH", `/games/${ids.thu}`, { homeScore: 21, awayScore: 17 })).status).toBe(
      200,
    );
    const typed = await read();
    expect(gameIn(typed, "thu")).toMatchObject({ homeScore: 21, awayScore: 17 });
    expect(liveIn(typed)).toEqual([]);
    // Cleared again, and the feed calls the game final: the result is written, with no live score.
    expect(
      (await t.call(ADMIN, "PATCH", `/games/${ids.thu}`, { homeScore: null, awayScore: null })).status,
    ).toBe(200);
    later();
    t.feed.set("2026:13", [
      { ...feedGame("lv-thu", "DAL", "NYG", THU, -3, [24, 20]), status: "final", period: 4 },
      ...thursdayUnderway({}).slice(1),
    ]);
    const final = await read();
    expect(gameIn(final, "thu")).toMatchObject({ homeScore: 24, awayScore: 20 });
    expect(gameIn(final, "thu")).not.toHaveProperty("live");
    expect(liveIn(final)).toEqual([]);
    expect(await stored("thu")).toEqual([24, 20]);

    // Nothing from the feed is under way now (the hand-added game has no feed), so it isn't asked.
    const asked = t.asked.length;
    later();
    await read();
    expect(t.asked.length).toBe(asked);
  });

  it("gives a final week no live score, and asks the feed nothing for it", async () => {
    at("2026-12-08T02:00:00Z");
    for (const [key, score] of [
      ["hand", [20, 13]],
      ["sun", [27, 24]],
      ["mon", [10, 7]],
    ] as const) {
      const res = await t.call(ADMIN, "PATCH", `/games/${ids[key]}`, {
        homeScore: score[0],
        awayScore: score[1],
      });
      expect(res.status).toBe(200);
    }
    expect((await t.call(ADMIN, "POST", `/weeks/${weekId}/finalize`)).status).toBe(200);
    t.feed.set("2026:13", thursdayUnderway({ period: 2, liveScore: { home: 3, away: 0 }, clock: "1:00" }));
    const asked = t.asked.length;
    later();
    const view = await read();
    expect(view.status).toBe("final");
    expect(liveIn(view)).toEqual([]);
    expect(t.asked.length).toBe(asked);
  });
});
