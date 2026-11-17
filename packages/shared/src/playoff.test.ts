import { describe, expect, it } from "vitest";
import {
  guillotineLabel,
  guillotineStatus,
  mayPickRound,
  type PlayoffRound,
  playoffStandings,
  roundPoints,
  wildCardPollingStarts,
} from "./playoff";
import type { ScoredGame, ScoredPick, Side } from "./rules";
import { weekLabel } from "./seasons";

const game = (id: string, kickoff: string, spread: number, score?: [number, number], points = 1): ScoredGame => ({
  id,
  kickoff: new Date(kickoff),
  spread,
  points,
  homeScore: score ? score[0] : null,
  awayScore: score ? score[1] : null,
});
const pick = (userId: string, gameId: string, side: Side, isPow = false): ScoredPick => ({
  userId,
  gameId,
  side,
  isPow,
});

// Wild Card: home -3 in both. g1 home wins by 7 (home covers), g2 home wins by 3 (push).
const wildCard = [
  game("g1", "2027-01-16T21:30:00Z", -3, [24, 17]),
  game("g2", "2027-01-17T18:00:00Z", -3, [20, 17]),
];
const after = new Date("2027-01-20T00:00:00Z");

describe("rounds", () => {
  it("are worth 1, 2, 3 and 4 points", () => {
    expect([19, 20, 21, 22].map(roundPoints)).toEqual([1, 2, 3, 4]);
    expect(() => roundPoints(18)).toThrow();
  });

  it("start polling the feed for the Wild Card round on Week 18's Sunday", () => {
    // 2026: Labor Day is Sep 7, Week 1 Thursday Sep 10, Week 18 Sunday Jan 10, 2027 (midnight EST = 05:00 UTC).
    expect(wildCardPollingStarts(2026).toISOString()).toBe("2027-01-10T05:00:00.000Z");
    // 2025: Week 18's Sunday was Jan 4, 2026.
    expect(wildCardPollingStarts(2025).toISOString()).toBe("2026-01-04T05:00:00.000Z");
  });
});

describe("guillotineStatus", () => {
  const status = (picks: ScoredPick[], now = after, games = wildCard, number = 19) =>
    guillotineStatus({ rounds: [{ number, games, picks }], userIds: ["pat"], now })[0];

  it("keeps a player whose POW won or pushed", () => {
    expect(status([pick("pat", "g1", "home", true)])).toMatchObject({ state: "in", outIn: null });
    // A push survives.
    expect(status([pick("pat", "g2", "away", true)])).toMatchObject({ state: "in", outIn: null });
  });

  it("puts out a player whose POW lost, from the next round, and their picks still stand", () => {
    const out = status([pick("pat", "g1", "away", true), pick("pat", "g2", "home")]);
    expect(out).toEqual({ userId: "pat", state: "out", outIn: 19, reason: "pow_lost" });
    expect(out && mayPickRound(out, 19)).toBe(true);
    expect(out && mayPickRound(out, 20)).toBe(false);
    expect(out && guillotineLabel(out, weekLabel)).toBe("Out: Wild Card");
  });

  it("puts out a player with no POW once the round's last game has kicked off, not before", () => {
    const unplayed = [game("g1", "2027-01-16T21:30:00Z", -3), game("g2", "2027-01-17T18:00:00Z", -3)];
    expect(status([pick("pat", "g1", "home")], new Date("2027-01-17T17:59:00Z"), unplayed)).toMatchObject({
      state: "in",
    });
    expect(status([pick("pat", "g1", "home")], new Date("2027-01-17T18:00:00Z"), unplayed)).toEqual({
      userId: "pat",
      state: "out",
      outIn: 19,
      reason: "no_pow",
    });
  });

  it("decides nothing while the POW's game has no result", () => {
    const pending = [game("g1", "2027-01-16T21:30:00Z", -3), wildCard[1] as ScoredGame];
    expect(status([pick("pat", "g1", "away", true)], after, pending)).toMatchObject({ state: "in" });
  });

  it("puts out a late joiner, who has no POW for a round already locked", () => {
    expect(status([])).toMatchObject({ state: "out", outIn: 19, reason: "no_pow" });
  });

  it("puts nobody out in the Super Bowl", () => {
    const superBowl = [game("sb", "2027-02-14T23:30:00Z", -1, [10, 20])];
    expect(status([pick("pat", "sb", "home", true)], after, superBowl, 22)).toMatchObject({ state: "in" });
    expect(guillotineLabel({ state: "in", outIn: null }, weekLabel)).toBe("In");
  });

  it("judges rounds in order: the first loss is the one that counts", () => {
    const divisional = [game("d1", "2027-01-23T21:30:00Z", 0, [10, 20])];
    const [result] = guillotineStatus({
      rounds: [
        { number: 20, games: divisional, picks: [pick("pat", "d1", "home", true)] },
        { number: 19, games: wildCard, picks: [pick("pat", "g1", "home", true)] },
      ],
      userIds: ["pat"],
      now: after,
    });
    expect(result).toMatchObject({ state: "out", outIn: 20, reason: "pow_lost" });
    expect(mayPickRound(null, 21)).toBe(true);
  });
});

describe("playoffStandings", () => {
  const superBowl: PlayoffRound = {
    number: 22,
    // Home -1, final 27–24: home covers. Total 51.
    games: [game("sb", "2027-02-14T23:30:00Z", -1, [27, 24], 4)],
    picks: [],
    guesses: [],
    userIds: ["pat", "sam", "lee"],
    tiebreakerGameId: "sb",
  };
  const round19: PlayoffRound = {
    number: 19,
    games: wildCard,
    picks: [pick("pat", "g1", "home", true), pick("sam", "g1", "home"), pick("lee", "g1", "away", true)],
    guesses: [],
    userIds: ["pat", "sam", "lee"],
    tiebreakerGameId: null,
  };

  it("adds the format's POW bonus: 3 in Traditional, 1 in Guillotine", () => {
    const standings = (format: "traditional" | "guillotine") =>
      playoffStandings({ rounds: [round19], userIds: ["pat", "sam", "lee"], format, now: after });
    expect(standings("traditional").map((e) => [e.userId, e.points])).toEqual([
      ["pat", 4],
      ["sam", 1],
      ["lee", 0],
    ]);
    expect(standings("guillotine").find((e) => e.userId === "pat")?.points).toBe(2);
    expect(standings("guillotine").find((e) => e.userId === "lee")?.status).toMatchObject({ state: "out" });
    expect(standings("traditional").every((e) => e.status === null && !e.champion)).toBe(true);
  });

  it("crowns the champion after the Super Bowl: points, wins, then the closest guess that didn't go over", () => {
    const even: PlayoffRound = {
      ...round19,
      picks: [pick("pat", "g1", "home"), pick("sam", "g1", "home"), pick("lee", "g1", "home")],
    };
    const rounds = (guesses: { userId: string; total: number }[]) => [
      even,
      {
        ...superBowl,
        picks: ["pat", "sam", "lee"].map((u) => pick(u, "sb", "home", true)),
        guesses,
      },
    ];
    // All level on points and wins; Sam's 53 and Lee's 49 are both 2 away, and Lee's didn't go over.
    const table = playoffStandings({
      rounds: rounds([
        { userId: "pat", total: 40 },
        { userId: "sam", total: 53 },
        { userId: "lee", total: 49 },
      ]),
      userIds: ["pat", "sam", "lee"],
      format: "traditional",
      now: after,
    });
    expect(table.map((e) => [e.userId, e.rank, e.champion])).toEqual([
      ["lee", 1, true],
      ["sam", 2, false],
      ["pat", 3, false],
    ]);
    // Still level after the guess: they share the title.
    const shared = playoffStandings({
      rounds: rounds([
        { userId: "pat", total: 51 },
        { userId: "sam", total: 51 },
      ]),
      userIds: ["pat", "sam", "lee"],
      format: "traditional",
      now: after,
    });
    expect(shared.filter((e) => e.champion).map((e) => e.userId)).toEqual(["pat", "sam"]);
  });

  it("lets points decide the title when nobody survives the guillotine", () => {
    const allOut: PlayoffRound = {
      ...round19,
      picks: [pick("pat", "g1", "away", true), pick("sam", "g1", "away", true), pick("sam", "g2", "home")],
    };
    const table = playoffStandings({
      rounds: [allOut, { ...superBowl, picks: [] }],
      userIds: ["pat", "sam", "lee"],
      format: "guillotine",
      now: after,
    });
    expect(table.every((e) => e.status?.state === "out")).toBe(true);
    // Nobody scored: everyone shares the title on points.
    expect(table.every((e) => e.champion)).toBe(true);
  });
});
