import { describe, expect, it } from "vitest";
import { type ScoredGame, type ScoredPick, scoreWeek } from "./rules";
import { favoredSide, seasonStats, weekSummary, winRate } from "./stats";

const game = (id: string, spread: number, homeScore: number, awayScore: number): ScoredGame => ({
  id,
  // A Sunday afternoon: 1 point.
  kickoff: new Date("2026-11-15T18:00:00Z"),
  spread,
  points: 1,
  homeScore,
  awayScore,
});

/** Scores one week and returns it in the shape `seasonStats` takes. */
function week(games: ScoredGame[], picks: ScoredPick[], userIds: string[]) {
  return { games, picks, entries: scoreWeek({ games, picks, guesses: [], userIds, tiebreakerGameId: null }) };
}

describe("winRate", () => {
  it("leaves pushes out and is null with nothing decided", () => {
    expect(winRate({ wins: 3, losses: 1 })).toBe(0.75);
    expect(winRate({ wins: 0, losses: 0 })).toBeNull();
  });
});

describe("favoredSide", () => {
  it("reads the home line", () => {
    expect(favoredSide(-3.5)).toBe("home");
    expect(favoredSide(2)).toBe("away");
    expect(favoredSide(0)).toBeNull();
    expect(favoredSide(null)).toBeNull();
  });
});

describe("weekSummary", () => {
  it("gives the top and average points", () => {
    const entries = week(
      [game("a", -3, 30, 10), game("b", 0, 10, 20)],
      [
        { userId: "pat", gameId: "a", side: "home", isPow: true },
        { userId: "pat", gameId: "b", side: "away", isPow: false },
        { userId: "sam", gameId: "a", side: "away", isPow: false },
      ],
      ["pat", "sam"],
    ).entries;
    // Pat: 1 + 5 POW + 1 = 7. Sam: 0.
    expect(weekSummary(entries)).toEqual({ topPoints: 7, averagePoints: 3.5 });
    expect(weekSummary([])).toEqual({ topPoints: null, averagePoints: null });
  });
});

describe("seasonStats", () => {
  // Week 1: the home favorite covers in `a`, the road dog covers in `b`, `c` pushes (home -3, wins by 3).
  const w1 = week(
    [game("a", -3, 30, 10), game("b", -7, 20, 17), game("c", -3, 13, 10)],
    [
      { userId: "pat", gameId: "a", side: "home", isPow: true },
      { userId: "pat", gameId: "b", side: "home", isPow: false },
      { userId: "pat", gameId: "c", side: "away", isPow: false },
      { userId: "sam", gameId: "a", side: "away", isPow: true },
      { userId: "sam", gameId: "b", side: "away", isPow: false },
    ],
    ["pat", "sam"],
  );
  // Week 2: Sam wins big; Lee is new and only plays this week.
  const w2 = week(
    [game("d", 4, 30, 10), game("e", -1, 30, 10)],
    [
      { userId: "pat", gameId: "d", side: "away", isPow: true },
      { userId: "sam", gameId: "d", side: "home", isPow: true },
      { userId: "sam", gameId: "e", side: "home", isPow: false },
      { userId: "lee", gameId: "e", side: "home", isPow: false },
    ],
    ["pat", "sam", "lee"],
  );
  const stats = seasonStats([w1, w2], ["pat", "sam", "lee"]);
  const of = (id: string) => stats.find((s) => s.userId === id);

  it("lists each week's result, with null for weeks a player wasn't in", () => {
    // Pat: week 1 = 1 + 5 (a, POW) = 6; week 2 = 0. Sam: week 1 = 1 (b); week 2 = 1 + 5 + 1 = 7.
    expect(of("pat")?.weekly).toEqual([
      { points: 6, rank: 1, isWinner: true },
      { points: 0, rank: 3, isWinner: false },
    ]);
    expect(of("sam")?.weekly.map((w) => w?.points)).toEqual([1, 7]);
    expect(of("lee")?.weekly).toEqual([null, { points: 1, rank: 2, isWinner: false }]);
  });

  it("counts POW losses", () => {
    expect(of("pat")).toMatchObject({ powLosses: 1, powPushes: 0 });
    expect(of("sam")).toMatchObject({ powLosses: 1, powPushes: 0 });
  });

  it("splits picks by favorite, underdog, home and away", () => {
    expect(of("pat")?.splits).toEqual({
      // a (home -3) won, b (home -7) lost, d (away -4: road favorite) lost.
      favorite: { wins: 1, losses: 2, pushes: 0 },
      // c: the road dog, pushed.
      underdog: { wins: 0, losses: 0, pushes: 1 },
      home: { wins: 1, losses: 1, pushes: 0 },
      away: { wins: 0, losses: 1, pushes: 1 },
    });
  });

  it("tracks movement in the season table since the previous week", () => {
    // After week 1: Pat 6, Sam 1, Lee 0. After week 2: Sam 8, Pat 6, Lee 1.
    expect(stats.map((s) => [s.userId, s.rankChange])).toEqual([
      ["pat", -1],
      ["sam", 1],
      ["lee", 0],
    ]);
    expect(seasonStats([w1], ["pat"])[0]?.rankChange).toBeNull();
  });
});
