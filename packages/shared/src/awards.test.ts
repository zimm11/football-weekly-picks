import { describe, expect, it } from "vitest";
import { lowPointLosers, weekAwards } from "./awards";
import { type ScoredGame, type ScoredPick, scoreWeek } from "./rules";

const game = (id: string, spread: number, homeScore: number, awayScore: number): ScoredGame => ({
  id,
  // A Sunday afternoon: 1 point.
  kickoff: new Date("2026-11-15T18:00:00Z"),
  spread,
  points: 1,
  homeScore,
  awayScore,
});
const pick = (userId: string, gameId: string, side: "home" | "away"): ScoredPick => ({
  userId,
  gameId,
  side,
  isPow: false,
});

// Home covers both games.
const games = [game("g1", -3, 27, 20), game("g2", 3, 20, 21)];

function awards(picks: ScoredPick[], userIds: string[], guesses: { userId: string; total: number }[] = []) {
  const entries = scoreWeek({ games, picks, guesses, userIds, tiebreakerGameId: "g2" });
  return weekAwards({ games, entries, picks, tiebreakerGameId: "g2" });
}

describe("lowPointLosers", () => {
  it("names last place, and shares it between players nothing separates", () => {
    const result = awards(
      [pick("a", "g1", "home"), pick("a", "g2", "home"), pick("b", "g1", "home"), pick("c", "g1", "away")],
      ["a", "b", "c", "d"],
    );
    expect(result.winners).toEqual(["a"]);
    // c lost a game and d never picked: both scored nothing and won nothing.
    expect(result.lowPointLosers).toEqual(["c", "d"]);
  });

  it("separates players level on points the way the winner is decided", () => {
    const picks = [pick("a", "g1", "home"), pick("b", "g1", "home"), pick("c", "g1", "home")];
    // The tiebreaker game totalled 41: c's guess was furthest off.
    const guesses = [
      { userId: "a", total: 41 },
      { userId: "b", total: 44 },
      { userId: "c", total: 20 },
    ];
    expect(awards(picks, ["a", "b", "c"], guesses).lowPointLosers).toEqual(["c"]);
  });

  it("names nobody when the whole league finished level", () => {
    expect(awards([pick("a", "g1", "home"), pick("b", "g1", "home")], ["a", "b"]).lowPointLosers).toEqual([]);
    expect(lowPointLosers([])).toEqual([]);
  });
});

describe("weekAwards", () => {
  it("credits a perfect week only when every game was picked and won", () => {
    const result = awards(
      [pick("a", "g1", "home"), pick("a", "g2", "home"), pick("b", "g1", "home")],
      ["a", "b"],
    );
    expect(result.perfectWeeks).toEqual(["a"]);
  });

  it("credits an exact tiebreaker guess", () => {
    const result = awards(
      [],
      ["a", "b"],
      [
        { userId: "a", total: 41 },
        { userId: "b", total: 40 },
      ],
    );
    expect(result.bullseyes).toEqual(["a"]);
  });

  it("finds the lone wolf: the only player on the covering side of a game three or more picked", () => {
    const result = awards(
      [
        pick("a", "g1", "home"),
        pick("b", "g1", "away"),
        pick("c", "g1", "away"),
        // Only two players picked this one, so being alone on it isn't remarkable.
        pick("a", "g2", "away"),
        pick("b", "g2", "home"),
      ],
      ["a", "b", "c"],
    );
    expect(result.loneWolves).toEqual([{ userId: "a", gameId: "g1" }]);
  });

  it("ignores picks from players who aren't scored in the week", () => {
    const result = awards(
      [pick("a", "g1", "home"), pick("b", "g1", "away"), pick("gone", "g1", "away")],
      ["a", "b"],
    );
    expect(result.loneWolves).toEqual([]);
  });
});
