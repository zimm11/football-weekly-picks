import { describe, expect, it } from "vitest";
import {
  autoPowCutoff,
  checkPickSubmission,
  checkTiebreakerGuess,
  coveringSide,
  dayLock,
  defaultPoints,
  defaultTiebreakerGame,
  effectiveTiebreakerId,
  gameWindow,
  type ScoredGame,
  type ScoredPick,
  scoreWeek,
  seasonStandings,
} from "./rules";
import { zonedTimeToUtc } from "./time";

const ET = "America/New_York";
/** An instant from Eastern wall-clock time. */
const et = (y: number, m: number, d: number, hour: number, minute = 0) =>
  new Date(zonedTimeToUtc(y, m, d, hour, ET).getTime() + minute * 60_000);

// Week 10 of 2026: Thu Nov 12, Sun Nov 15, Mon Nov 16.
const THU = et(2026, 11, 12, 20, 15);
const SUN_1PM = et(2026, 11, 15, 13);
const SUN_NIGHT = et(2026, 11, 15, 20, 20);
const MON = et(2026, 11, 16, 20, 15);

describe("defaultPoints", () => {
  it.each([
    ["Thursday night", THU, 3],
    ["Sunday 9:30am (international)", et(2026, 11, 15, 9, 30), 1],
    ["Sunday 1pm", SUN_1PM, 1],
    ["Sunday 4:25pm", et(2026, 11, 15, 16, 25), 1],
    ["Sunday night", SUN_NIGHT, 2],
    ["Monday night", MON, 3],
    ["Saturday", et(2026, 12, 19, 16, 30), 2],
    ["Friday", et(2026, 9, 11, 20, 15), 2],
    ["Thanksgiving", et(2026, 11, 26, 12, 30), 4],
    ["Thanksgiving night", et(2026, 11, 26, 20, 20), 4],
    ["Christmas Day (a Friday in 2026)", et(2026, 12, 25, 13), 4],
    ["the Friday after Thanksgiving", et(2026, 11, 27, 15), 2],
  ])("%s", (_name, kickoff, points) => {
    expect(defaultPoints(kickoff)).toBe(points);
  });
});

describe("zonedTimeToUtc", () => {
  it("handles standard and daylight time", () => {
    expect(et(2026, 11, 15, 6).toISOString()).toBe("2026-11-15T11:00:00.000Z");
    expect(et(2026, 9, 13, 6).toISOString()).toBe("2026-09-13T10:00:00.000Z");
  });

  it("is right on the morning the clocks change", () => {
    // DST ends Nov 1 2026 at 2am, so 6am that day is already standard time.
    expect(et(2026, 11, 1, 6).toISOString()).toBe("2026-11-01T11:00:00.000Z");
  });
});

describe("gameWindow", () => {
  it("locks at 6am on game day in the league's time zone", () => {
    expect(dayLock(SUN_1PM, ET)).toEqual(et(2026, 11, 15, 6));
    expect(dayLock(SUN_1PM, "America/Los_Angeles")).toEqual(et(2026, 11, 15, 9));
  });

  it("is open before 6am, late until kickoff, then closed", () => {
    expect(gameWindow(SUN_1PM, ET, et(2026, 11, 15, 5, 59))).toBe("open");
    expect(gameWindow(SUN_1PM, ET, et(2026, 11, 15, 6))).toBe("late");
    expect(gameWindow(SUN_1PM, ET, et(2026, 11, 15, 12, 59))).toBe("late");
    expect(gameWindow(SUN_1PM, ET, SUN_1PM)).toBe("closed");
  });
});

describe("checkPickSubmission", () => {
  const games = [
    { id: "thu", kickoff: THU, label: "WSH at NYG", final: false },
    { id: "sun", kickoff: SUN_1PM, label: "KC at ATL", final: false },
    { id: "snf", kickoff: SUN_NIGHT, label: "PIT at CIN", final: false },
    { id: "mon", kickoff: MON, label: "LAC at BAL", final: false },
  ];
  const check = (
    now: Date,
    input: Partial<Pick<Parameters<typeof checkPickSubmission>[0], "existing" | "picks" | "powGameId">>,
  ) =>
    checkPickSubmission({
      games,
      existing: [],
      picks: [],
      powGameId: null,
      tiebreakerGameId: "mon",
      timeZone: ET,
      now,
      ...input,
    });

  const WEDNESDAY = et(2026, 11, 11, 12);
  const SUNDAY_7AM = et(2026, 11, 15, 7);

  it("accepts everything early in the week", () => {
    expect(
      check(WEDNESDAY, {
        picks: games.map((g) => ({ gameId: g.id, side: "home" as const })),
        powGameId: "thu",
      }),
    ).toBeNull();
  });

  it("lets picks and the POW change before 6am on game day", () => {
    const existing = [{ gameId: "sun", side: "home" as const, isPow: true }];
    expect(
      check(et(2026, 11, 15, 5), {
        existing,
        picks: [
          { gameId: "sun", side: "away" },
          { gameId: "mon", side: "home" },
        ],
        powGameId: "mon",
      }),
    ).toBeNull();
  });

  it("accepts a late pick on game day, but not as the POW", () => {
    expect(check(SUNDAY_7AM, { picks: [{ gameId: "sun", side: "away" }] })).toBeNull();
    expect(check(SUNDAY_7AM, { picks: [{ gameId: "sun", side: "away" }], powGameId: "sun" })).toMatch(
      /can't be your POW/,
    );
  });

  it("still allows a Monday POW on Sunday morning", () => {
    expect(check(SUNDAY_7AM, { picks: [{ gameId: "mon", side: "away" }], powGameId: "mon" })).toBeNull();
  });

  it("freezes an existing pick after 6am on game day", () => {
    const existing = [{ gameId: "sun", side: "home" as const, isPow: false }];
    expect(check(SUNDAY_7AM, { existing, picks: [{ gameId: "sun", side: "away" }] })).toMatch(
      /can't be changed/,
    );
    // Resubmitting the same side is not a change.
    expect(check(SUNDAY_7AM, { existing, picks: [{ gameId: "sun", side: "home" }] })).toBeNull();
  });

  it("rejects picks after kickoff, for that game only", () => {
    const afterEarlyKickoff = et(2026, 11, 15, 13, 5);
    expect(check(afterEarlyKickoff, { picks: [{ gameId: "sun", side: "home" }] })).toMatch(
      /already kicked off/,
    );
    expect(check(afterEarlyKickoff, { picks: [{ gameId: "snf", side: "home" }] })).toBeNull();
  });

  it("doesn't let a POW be moved off or removed from a game after 6am on its day", () => {
    const existing = [
      { gameId: "sun", side: "home" as const, isPow: true },
      { gameId: "mon", side: "home" as const, isPow: false },
    ];
    expect(check(SUNDAY_7AM, { existing, powGameId: "mon" })).toMatch(/can't be moved or removed/);
    expect(check(SUNDAY_7AM, { existing, powGameId: null })).toMatch(/can't be moved or removed/);
    expect(check(SUNDAY_7AM, { existing, powGameId: "sun" })).toBeNull();
  });

  it("closes a game as soon as it has a result, whatever the clock says", () => {
    // The admin entered Monday's score early in the week.
    const withResult = games.map((g) => (g.id === "mon" ? { ...g, final: true } : g));
    const checkFinal = (
      input: Pick<Parameters<typeof checkPickSubmission>[0], "existing" | "picks" | "powGameId">,
    ) =>
      checkPickSubmission({
        games: withResult,
        tiebreakerGameId: "mon",
        timeZone: ET,
        now: WEDNESDAY,
        ...input,
      });
    const saved = [{ gameId: "mon", side: "home" as const, isPow: true }];

    expect(checkFinal({ existing: [], picks: [{ gameId: "mon", side: "home" }], powGameId: null })).toMatch(
      /LAC at BAL is final/,
    );
    expect(
      checkFinal({ existing: saved, picks: [{ gameId: "mon", side: "away" }], powGameId: "mon" }),
    ).toMatch(/is final/);
    // The POW can't leave a final game, or land on one.
    expect(
      checkFinal({ existing: saved, picks: [{ gameId: "thu", side: "home" }], powGameId: "thu" }),
    ).toMatch(/its game is final/);
    expect(
      checkFinal({
        existing: [{ ...saved[0], isPow: false } as (typeof saved)[0]],
        picks: [],
        powGameId: "mon",
      }),
    ).toMatch(/can't be your POW: it is final/);
    // Other games are unaffected.
    expect(
      checkFinal({ existing: saved, picks: [{ gameId: "thu", side: "home" }], powGameId: "mon" }),
    ).toBeNull();
  });

  describe("automatic Monday night POW", () => {
    // A week with a Tuesday game, so there is something other than Monday still open on Sunday morning.
    const TUE = et(2026, 11, 17, 20, 15);
    const withTuesday = [...games, { id: "tue", kickoff: TUE, label: "MIA at BUF", final: false }];
    const checkWeek = (
      now: Date,
      input: Pick<Parameters<typeof checkPickSubmission>[0], "existing" | "picks" | "powGameId">,
    ) => checkPickSubmission({ games: withTuesday, tiebreakerGameId: "mon", timeZone: ET, now, ...input });
    const tuesdayPow = { existing: [], picks: [{ gameId: "tue", side: "home" as const }], powGameId: "tue" };

    it("takes over at 6am on Sunday for a player with no POW", () => {
      expect(autoPowCutoff(withTuesday, "mon", ET)).toEqual(et(2026, 11, 15, 6));
      expect(checkWeek(et(2026, 11, 15, 5, 59), tuesdayPow)).toBeNull();
      expect(checkWeek(SUNDAY_7AM, tuesdayPow)).toMatch(/POW is automatically LAC at BAL/);
      // Choosing the Monday night game itself is still fine.
      expect(
        checkWeek(SUNDAY_7AM, { existing: [], picks: [{ gameId: "mon", side: "home" }], powGameId: "mon" }),
      ).toBeNull();
    });

    it("leaves a POW chosen before the cutoff alone", () => {
      const existing = [{ gameId: "tue", side: "home" as const, isPow: true }];
      expect(checkWeek(SUNDAY_7AM, { existing, picks: [], powGameId: "tue" })).toBeNull();
    });

    it("doesn't apply without Sunday games or a later tiebreaker game", () => {
      const noSunday = withTuesday.filter((g) => g.id !== "sun" && g.id !== "snf");
      expect(autoPowCutoff(noSunday, "mon", ET)).toBeNull();
      expect(autoPowCutoff(withTuesday, null, ET)).toBeNull();
      // The admin made Thursday the tiebreaker: it is already over by Sunday, so there is nothing to assign.
      expect(autoPowCutoff(withTuesday, "thu", ET)).toBeNull();
    });
  });

  it("requires a pick on the POW game", () => {
    expect(check(WEDNESDAY, { powGameId: "mon" })).toMatch(/Pick a side/);
  });

  it("rejects games from another week", () => {
    expect(check(WEDNESDAY, { picks: [{ gameId: "nope", side: "home" }] })).toMatch(/not part of this week/);
  });
});

describe("checkTiebreakerGuess", () => {
  const check = (now: Date, existing: number | null, total: number | null, final = false) =>
    checkTiebreakerGuess({ tiebreakerGame: { kickoff: MON, final }, existing, total, timeZone: ET, now });

  it("can be entered until kickoff and changed until 6am on game day", () => {
    expect(check(et(2026, 11, 15, 12), 40, 44)).toBeNull();
    expect(check(et(2026, 11, 16, 12), null, 44)).toBeNull();
    expect(check(et(2026, 11, 16, 12), 40, 44)).toMatch(/can't be changed/);
    expect(check(et(2026, 11, 16, 21), null, 44)).toMatch(/kicked off/);
    expect(check(et(2026, 11, 16, 21), 40, 40)).toBeNull();
  });

  it("locks once the tiebreaker game has a result", () => {
    expect(check(et(2026, 11, 11, 12), null, 44, true)).toMatch(/is final/);
    expect(check(et(2026, 11, 11, 12), 40, 44, true)).toMatch(/is final/);
  });
});

describe("defaultTiebreakerGame", () => {
  it("is the last Monday game, or the last game when nobody plays on Monday", () => {
    const thu = { id: "thu", kickoff: THU };
    const sun = { id: "sun", kickoff: SUN_NIGHT };
    const monEarly = { id: "mon1", kickoff: et(2026, 11, 16, 19) };
    const monLate = { id: "mon2", kickoff: MON };
    expect(defaultTiebreakerGame([monLate, thu, monEarly, sun])?.id).toBe("mon2");
    expect(defaultTiebreakerGame([thu, sun])?.id).toBe("sun");
    expect(defaultTiebreakerGame([])).toBeUndefined();
  });
});

describe("effectiveTiebreakerId", () => {
  const thu = { id: "thu", kickoff: THU };
  const mon = { id: "mon", kickoff: MON };

  it("follows the slate until the admin chooses", () => {
    expect(effectiveTiebreakerId(null, [])).toBeNull();
    expect(effectiveTiebreakerId(null, [thu])).toBe("thu");
    // Monday was added after Thursday: the default moves to it.
    expect(effectiveTiebreakerId(null, [thu, mon])).toBe("mon");
  });

  it("keeps the admin's choice while that game is on the slate", () => {
    expect(effectiveTiebreakerId("thu", [thu, mon])).toBe("thu");
    expect(effectiveTiebreakerId("gone", [thu, mon])).toBe("mon");
  });
});

describe("coveringSide", () => {
  const game = (spread: number, homeScore: number | null, awayScore: number | null): ScoredGame => ({
    id: "g",
    kickoff: SUN_1PM,
    spread,
    points: 1,
    homeScore,
    awayScore,
  });

  it("applies the spread to the home team", () => {
    expect(coveringSide(game(-3.5, 24, 20))).toBe("home"); // won by 4, laying 3.5
    expect(coveringSide(game(-3.5, 23, 20))).toBe("away"); // won by 3: didn't cover
    expect(coveringSide(game(3.5, 20, 23))).toBe("home"); // lost by 3, getting 3.5
    expect(coveringSide(game(-3, 23, 20))).toBe("push");
    expect(coveringSide(game(-3, null, null))).toBeNull();
  });
});

describe("scoreWeek", () => {
  // Home teams all favored by 3.5. Home covers on Thursday and Monday; away covers both Sunday games.
  const games: ScoredGame[] = [
    { id: "thu", kickoff: THU, spread: -3.5, points: 3, homeScore: 27, awayScore: 10 },
    { id: "sun", kickoff: SUN_1PM, spread: -3.5, points: 1, homeScore: 20, awayScore: 20 },
    { id: "snf", kickoff: SUN_NIGHT, spread: -3.5, points: 2, homeScore: 10, awayScore: 30 },
    { id: "mon", kickoff: MON, spread: -3.5, points: 3, homeScore: 24, awayScore: 20 }, // total 44
  ];
  const pick = (userId: string, gameId: string, side: "home" | "away", isPow = false): ScoredPick => ({
    userId,
    gameId,
    side,
    isPow,
  });
  const score = (
    picks: ScoredPick[],
    guesses: { userId: string; total: number }[] = [],
    userIds = ["a", "b"],
  ) => scoreWeek({ games, picks, guesses, userIds, tiebreakerGameId: "mon" });
  const entry = (entries: ReturnType<typeof score>, userId: string) => {
    const found = entries.find((e) => e.userId === userId);
    if (!found) throw new Error(`no entry for ${userId}`);
    return found;
  };

  it("adds slot points for wins and 5 for a winning POW", () => {
    const entries = score([
      pick("a", "thu", "home", true), // 3 + 5
      pick("a", "sun", "home"), // loss
      pick("a", "snf", "away"), // 2
      pick("a", "mon", "home"), // 3
    ]);
    expect(entry(entries, "a")).toMatchObject({
      points: 13,
      wins: 3,
      losses: 1,
      powWon: true,
      mondayWins: 1,
      sundayNightWins: 1,
      rank: 1,
      isWinner: true,
    });
    expect(entry(entries, "b")).toMatchObject({ points: 0, wins: 0, rank: 2, isWinner: false });
  });

  it("gives no bonus for a losing POW", () => {
    expect(entry(score([pick("a", "sun", "home", true), pick("a", "thu", "home")]), "a")).toMatchObject({
      points: 3,
      powWon: false,
    });
  });

  it("scores a push as neither a win nor a loss, even as the POW", () => {
    const pushGames = games.map((g) => (g.id === "thu" ? { ...g, spread: -17 } : g));
    const [a] = scoreWeek({
      games: pushGames,
      picks: [pick("a", "thu", "home", true)],
      guesses: [],
      userIds: ["a"],
      tiebreakerGameId: "mon",
    });
    expect(a).toMatchObject({ points: 0, wins: 0, losses: 0, pushes: 1, powWon: false });
  });

  it("gives a player with no POW the Monday night game as their POW", () => {
    const entries = score([pick("a", "mon", "home"), pick("b", "mon", "away")]);
    expect(entry(entries, "a")).toMatchObject({ points: 8, powGameId: "mon", powWon: true });
    expect(entry(entries, "b")).toMatchObject({ points: 0, powGameId: "mon", powWon: false });
  });

  it("keeps a chosen POW rather than the automatic one", () => {
    const entries = score([pick("a", "thu", "home", true), pick("a", "mon", "home")]);
    expect(entry(entries, "a")).toMatchObject({ points: 11, powGameId: "thu" });
  });

  it("breaks a points tie on games won", () => {
    // a: Monday (3). b: Sunday 1pm (1) + Sunday night (2). Neutralize the automatic Monday POW with losing POWs.
    const entries = score([
      pick("a", "mon", "home"),
      pick("a", "sun", "home", true),
      pick("b", "sun", "away"),
      pick("b", "snf", "away"),
      pick("b", "thu", "away", true),
    ]);
    expect(entry(entries, "a")).toMatchObject({ points: 3, wins: 1, rank: 2 });
    expect(entry(entries, "b")).toMatchObject({ points: 3, wins: 2, rank: 1, isWinner: true });
  });

  describe("tiebreaker total (actual 44)", () => {
    const level = [pick("a", "thu", "home", true), pick("b", "thu", "home", true)];
    const ranks = (guessA: number | null, guessB: number | null) => {
      const guesses = [
        ...(guessA === null ? [] : [{ userId: "a", total: guessA }]),
        ...(guessB === null ? [] : [{ userId: "b", total: guessB }]),
      ];
      const entries = score(level, guesses);
      return [entry(entries, "a").rank, entry(entries, "b").rank];
    };

    it("goes to the closest guess", () => {
      expect(ranks(41, 50)).toEqual([1, 2]);
      expect(ranks(30, 45)).toEqual([2, 1]);
    });

    it("goes to the guess that didn't go over when both are equally close", () => {
      expect(ranks(47, 41)).toEqual([2, 1]);
    });

    it("beats a player who made no guess", () => {
      expect(ranks(null, 90)).toEqual([2, 1]);
    });

    it("leaves co-winners when the guesses match", () => {
      const entries = score(level, [
        { userId: "a", total: 40 },
        { userId: "b", total: 40 },
      ]);
      expect(entries.map((e) => e.isWinner)).toEqual([true, true]);
    });
  });
});

describe("seasonStandings", () => {
  const week = (userId: string, over: Partial<ReturnType<typeof scoreWeek>[number]>) => ({
    userId,
    points: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    powGameId: null,
    powWon: false,
    mondayWins: 0,
    sundayNightWins: 0,
    tiebreakerGuess: null,
    rank: 1,
    isWinner: false,
    ...over,
  });

  it("adds up weeks and counts weekly wins", () => {
    const standings = seasonStandings(
      [
        [week("a", { points: 10, wins: 6, isWinner: true }), week("b", { points: 8, wins: 5 })],
        [week("a", { points: 4, wins: 3 }), week("b", { points: 9, wins: 6, isWinner: true })],
      ],
      ["a", "b", "c"],
    );
    expect(standings.map((e) => [e.userId, e.points, e.wins, e.weeksWon, e.rank])).toEqual([
      ["b", 17, 11, 1, 1],
      ["a", 14, 9, 1, 2],
      ["c", 0, 0, 0, 3],
    ]);
  });

  it("breaks ties by POWs won, then wins, then Monday night wins, then Sunday night wins", () => {
    const order = (a: object, b: object) =>
      seasonStandings([[week("a", { points: 10, ...a }), week("b", { points: 10, ...b })]], ["a", "b"]).map(
        (e) => e.userId,
      );
    expect(order({ wins: 9 }, { powWon: true })).toEqual(["b", "a"]);
    expect(order({ mondayWins: 2 }, { wins: 1 })).toEqual(["b", "a"]);
    expect(order({ sundayNightWins: 3 }, { mondayWins: 1 })).toEqual(["b", "a"]);
    expect(order({}, { sundayNightWins: 1 })).toEqual(["b", "a"]);
  });

  it("shares a rank when nothing separates two players", () => {
    const standings = seasonStandings([[week("a", { points: 5 }), week("b", { points: 5 })]], ["a", "b"]);
    expect(standings.map((e) => e.rank)).toEqual([1, 1]);
  });
});
