import type { Game, WeekView } from "@picks/shared";
import { describe, expect, it } from "vitest";
import {
  favoriteLine,
  gameDays,
  lockedGameRow,
  pickStatus,
  sheetEditable,
  weekHasPow,
  weekUnit,
} from "./weekPresentation";

const game = (id: string, kickoff = "2026-11-16T00:00:00Z"): Game => ({
  id,
  homeTeam: "PHI",
  awayTeam: "DAL",
  kickoff,
  spread: -3.5,
  points: 2,
  homeScore: null,
  awayScore: null,
});
const view = (): WeekView => ({
  id: "week",
  leagueId: "league",
  leagueName: "League",
  timeZone: "America/New_York",
  role: "member",
  year: 2026,
  number: 11,
  status: "open",
  tiebreakerGameId: "b",
  games: [game("a"), game("b", "2026-11-17T01:15:00Z")],
  myPicks: [],
  myTiebreakerTotal: null,
  submissions: null,
  results: null,
});

describe("native week presentation behavior", () => {
  it("groups the slate by league calendar day rather than the phone timezone", () => {
    const games = [game("a"), game("b", "2026-11-16T03:00:00Z"), game("c", "2026-11-16T06:00:00Z")];
    expect(
      gameDays(games, "America/New_York").map((group) => ({
        day: group.day,
        ids: group.games.map((game) => game.id),
      })),
    ).toEqual([
      { day: "Sunday, Nov 15", ids: ["a", "b"] },
      { day: "Monday, Nov 16", ids: ["c"] },
    ]);
    expect(gameDays(games, "UTC")).toHaveLength(1);
  });
  it("counts only still-editable missing picks and separates locked misses", () => {
    const current = view();
    expect(pickStatus(current, new Date("2026-11-16T00:00:00Z"))).toEqual({
      savedCount: 0,
      left: 1,
      missed: 1,
      needsPow: true,
      needsTotal: true,
    });
  });
  it("calls a playoff league's week a round", () => {
    expect(weekUnit({ leagueType: "playoff" })).toBe("round");
    expect(weekUnit({ leagueType: "weekly" })).toBe("week");
    // An older API response without the type is weekly pick'em's.
    expect(weekUnit({})).toBe("week");
  });
  it("asks for no POW in a playoff league's Super Bowl", () => {
    const superBowl: WeekView = {
      ...view(),
      number: 22,
      playoff: { format: "guillotine", me: null, mayPick: true, pow: false },
    };
    expect(weekHasPow(superBowl)).toBe(false);
    expect(pickStatus(superBowl, new Date("2026-11-15T00:00:00Z")).needsPow).toBe(false);
    // An older API response without `pow` still has none in the Super Bowl, and a weekly week 22 can't exist.
    expect(weekHasPow({ number: 22, playoff: { format: "traditional", me: null, mayPick: true } })).toBe(
      false,
    );
    expect(weekHasPow({ number: 21, playoff: { format: "traditional", me: null, mayPick: true } })).toBe(
      true,
    );
    expect(weekHasPow(view())).toBe(true);
  });
  it("keeps POW and tiebreaker as remaining tasks after all sides have been saved", () => {
    const current = view();
    current.myPicks = [
      { gameId: "a", side: "home", isPow: false },
      { gameId: "b", side: "away", isPow: false },
    ];
    expect(pickStatus(current, new Date("2026-11-15T00:00:00Z"))).toMatchObject({
      savedCount: 2,
      left: 0,
      needsPow: true,
      needsTotal: true,
    });
  });
  it("does not nag for POW or tiebreaker once no game can take them", () => {
    expect(pickStatus(view(), new Date("2026-11-18T00:00:00Z"))).toMatchObject({
      left: 0,
      needsPow: false,
      needsTotal: false,
    });
  });
  it("treats an entered result as locked before kickoff in the task count", () => {
    const current = view();
    current.games = [{ ...game("a"), homeScore: 20, awayScore: 10 }];
    current.tiebreakerGameId = "a";
    expect(pickStatus(current, new Date("2026-11-15T00:00:00Z"))).toMatchObject({
      left: 0,
      missed: 1,
      needsPow: false,
      needsTotal: false,
    });
  });
  it("expresses a home-stored line as the favorite without reversing its meaning", () => {
    expect(favoriteLine(game("a"), 3.5)).toBe("Cowboys -3.5");
    expect(favoriteLine(game("a"), -3.5)).toBe("Eagles -3.5");
    expect(favoriteLine(game("a"), 0)).toBe("Pick'em");
  });
});

describe("what a pick sheet still lets the player change", () => {
  const before = new Date("2026-11-15T12:00:00Z");
  const between = new Date("2026-11-16T12:00:00Z");
  const after = new Date("2026-11-18T00:00:00Z");
  it("opens games and the guess until their kickoffs", () => {
    expect(sheetEditable(view(), before)).toEqual({ games: true, guess: true });
    expect(sheetEditable(view(), between)).toEqual({ games: true, guess: true });
    expect(sheetEditable(view(), after)).toEqual({ games: false, guess: false });
  });
  it("treats a game with a result as locked whatever the clock says", () => {
    const scored = view();
    scored.games = scored.games.map((g) => ({ ...g, homeScore: 20, awayScore: 17 }));
    expect(sheetEditable(scored, before)).toEqual({ games: false, guess: false });
  });
  it("leaves a player the guillotine put out only the guess", () => {
    const out = { ...view(), playoff: { mayPick: false } } as unknown as WeekView;
    expect(sheetEditable(out, before)).toEqual({ games: false, guess: true });
  });
  it("offers nothing on a week that isn't open", () => {
    expect(sheetEditable({ ...view(), status: "final" }, before)).toEqual({ games: false, guess: false });
  });
});

describe("the compact row of a game the player can no longer change", () => {
  // DAL at PHI, the Eagles giving 3.5 and worth 2 points.
  const locked = game("g");
  const final = (away: number, home: number): Game => ({ ...locked, awayScore: away, homeScore: home });
  const weekly = { hasPow: true, powBonus: 5 };
  it("says the pick against its line while the game is under way", () => {
    expect(lockedGameRow(locked, { sides: { g: "home" }, pow: null }, weekly)).toMatchObject({
      team: "PHI",
      pick: "Eagles -3.5",
      pow: false,
      outcome: "pending",
      score: null,
      result: null,
      label: "DAL at PHI, locked, your pick: Eagles (-3.5)",
    });
  });
  it("never contains a team button's name, so finding that button by name finds only it", () => {
    const row = lockedGameRow(locked, { sides: { g: "home" }, pow: null }, weekly);
    expect(row.pick).toBe("Eagles -3.5");
    expect(row.label).not.toContain("Eagles -3.5");
  });
  it("says when there is no pick", () => {
    expect(lockedGameRow(locked, { sides: {}, pow: null }, weekly)).toMatchObject({
      team: null,
      pick: null,
      outcome: "none",
      result: null,
      label: "DAL at PHI, locked, no pick",
    });
    expect(lockedGameRow(final(20, 10), { sides: {}, pow: null }, weekly).label).toBe(
      "DAL at PHI, final 20–10, no pick",
    );
  });
  it("marks the POW, and a winning POW's bonus", () => {
    const row = lockedGameRow(final(10, 27), { sides: { g: "home" }, pow: "g" }, weekly);
    expect(row).toMatchObject({ pow: true, outcome: "won", earned: 7, score: "10–27", result: "Won +7" });
    expect(row.label).toBe("DAL at PHI, final 10–27, your pick: Eagles (-3.5), POW, won 7 points");
    expect(lockedGameRow(locked, { sides: { g: "away" }, pow: "g" }, weekly).label).toBe(
      "DAL at PHI, locked, your pick: Cowboys (+3.5), POW",
    );
  });
  it("says lost and push in words", () => {
    const lost = lockedGameRow(final(24, 21), { sides: { g: "home" }, pow: null }, weekly);
    expect(lost).toMatchObject({ outcome: "lost", earned: 0, result: "Lost" });
    expect(lost.label).toBe("DAL at PHI, final 24–21, your pick: Eagles (-3.5), lost");
    const spread = { ...final(17, 20), spread: -3 };
    const push = lockedGameRow(spread, { sides: { g: "away" }, pow: null }, weekly);
    expect(push).toMatchObject({ outcome: "push", earned: 0, result: "Push", pick: "Cowboys +3" });
    expect(push.label).toBe("DAL at PHI, final 17–20, your pick: Cowboys (+3), push");
  });
  it("says one point, and a pick'em line", () => {
    const pickem = { ...final(13, 20), spread: 0, points: 1 };
    const row = lockedGameRow(pickem, { sides: { g: "home" }, pow: null }, weekly);
    expect(row).toMatchObject({ pick: "Eagles PK", result: "Won +1" });
    expect(row.label).toBe("DAL at PHI, final 13–20, your pick: Eagles (PK), won 1 point");
  });
  it("shows no POW in a playoff round without one, even one saved before", () => {
    const superBowl = { hasPow: false, powBonus: 1 };
    const row = lockedGameRow(final(10, 27), { sides: { g: "home" }, pow: "g" }, superBowl);
    expect(row).toMatchObject({ pow: false, earned: 2, result: "Won +2" });
    expect(row.label).toBe("DAL at PHI, final 10–27, your pick: Eagles (-3.5), won 2 points");
    // A Guillotine round's POW is worth its own bonus.
    expect(
      lockedGameRow(final(10, 27), { sides: { g: "home" }, pow: "g" }, { hasPow: true, powBonus: 1 }).result,
    ).toBe("Won +3");
  });
});
