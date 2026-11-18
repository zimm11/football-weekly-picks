import { describe, expect, it } from "vitest";
import {
  boardLocked,
  boardPhase,
  checkClaim,
  checkLimitChange,
  checkRelease,
  createBoardSchema,
  cryptoRandom,
  currentSquare,
  drawDigits,
  type RandomSource,
  squareWinners,
  updateBoardSchema,
  winningSquare,
} from "./squares";

const sequence = (values: number[]): RandomSource => {
  let i = 0;
  return () => {
    const value = values[i++ % values.length];
    if (value === undefined) throw new Error("empty sequence");
    return value;
  };
};

describe("drawDigits", () => {
  it("is always an order of 0–9", () => {
    for (let n = 0; n < 50; n++) expect([...drawDigits(cryptoRandom)].sort()).toEqual([...Array(10).keys()]);
  });

  it("is a Fisher–Yates shuffle of the random source", () => {
    // Zero every time swaps each position with the first: 9↔0, 8↔0 … 1↔0.
    expect(drawDigits(() => 0)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
    // The largest index every time leaves the order alone.
    expect(drawDigits(sequence([9, 8, 7, 6, 5, 4, 3, 2, 1]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("draws again rather than favor low numbers (no modulo bias)", () => {
    // For n = 10, 2^32 isn't a multiple: the top 6 values would favor 0–5, so they are rejected.
    const top = 2 ** 32 - 1;
    const drawn: number[] = [];
    let calls = 0;
    const digits = drawDigits(() => {
      calls++;
      const value = calls === 1 ? top : 9;
      drawn.push(value);
      return value;
    });
    expect(drawn[0]).toBe(top);
    expect(calls).toBe(10); // one rejected, then nine accepted
    expect([...digits].sort()).toEqual([...Array(10).keys()]);
  });

  it("is close to uniform", () => {
    const counts = Array.from({ length: 10 }, () => Array(10).fill(0) as number[]);
    const runs = 20_000;
    for (let n = 0; n < runs; n++) {
      drawDigits(cryptoRandom).forEach((digit, position) => {
        const row = counts[position] as number[];
        row[digit] = (row[digit] ?? 0) + 1;
      });
    }
    for (const row of counts) for (const count of row) expect(Math.abs(count - runs / 10)).toBeLessThan(250);
  });

  it("refuses a source that isn't 32-bit", () => {
    expect(() => drawDigits(() => 0.5)).toThrow();
    expect(() => drawDigits(() => -1)).toThrow();
  });
});

const kickoff = new Date("2027-02-14T23:30:00Z");
const before = new Date("2027-02-14T20:00:00Z");
const after = new Date("2027-02-15T00:00:00Z");
const open = { kickoff, maxPerPlayer: 2, drawnAt: null };
const drawn = { ...open, drawnAt: before };

describe("checkClaim", () => {
  it("allows an open square up to the limit", () => {
    expect(checkClaim({ board: open, taken: null, mine: 1, guest: false, now: before })).toBeNull();
    expect(checkClaim({ board: open, taken: null, mine: 2, guest: false, now: before })).toMatch(
      /hold 2 squares/,
    );
  });

  it("refuses a taken square", () => {
    const taken = { userId: "u", guestName: null };
    expect(checkClaim({ board: open, taken, mine: 0, guest: false, now: before })).toMatch(/already taken/);
  });

  it("refuses once the board is drawn, or at kickoff before the draw has run", () => {
    expect(checkClaim({ board: drawn, taken: null, mine: 0, guest: false, now: before })).toMatch(/locked/);
    expect(checkClaim({ board: open, taken: null, mine: 0, guest: false, now: kickoff })).toMatch(/locked/);
    expect(boardLocked(open, before)).toBe(false);
  });

  it("puts guests outside every player's limit", () => {
    expect(checkClaim({ board: open, taken: null, mine: 50, guest: true, now: before })).toBeNull();
  });
});

describe("checkRelease and checkLimitChange", () => {
  const mine = { userId: "me", guestName: null };
  it("lets a player release their own square and an admin any square, before the lock", () => {
    expect(checkRelease({ board: open, claim: mine, userId: "me", admin: false, now: before })).toBeNull();
    expect(checkRelease({ board: open, claim: mine, userId: "you", admin: false, now: before })).toMatch(
      /isn't yours/,
    );
    expect(checkRelease({ board: open, claim: mine, userId: "you", admin: true, now: before })).toBeNull();
    expect(checkRelease({ board: drawn, claim: mine, userId: "me", admin: true, now: before })).toMatch(
      /locked/,
    );
    expect(checkRelease({ board: open, claim: null, userId: "me", admin: true, now: before })).toMatch(
      /open/,
    );
  });

  it("raises the limit before the lock and never lowers it", () => {
    expect(checkLimitChange(open, 5, before)).toBeNull();
    expect(checkLimitChange(open, 1, before)).toMatch(/never lowered/);
    expect(checkLimitChange(drawn, 5, before)).toMatch(/locked/);
    expect(checkLimitChange(drawn, 2, after)).toBeNull();
  });
});

describe("boardPhase", () => {
  it("is Open, Locked, Underway, then Final", () => {
    expect(boardPhase(open, [], before)).toBe("open");
    expect(boardPhase(drawn, [], before)).toBe("locked");
    expect(boardPhase(drawn, [{ period: "q1" }], after)).toBe("underway");
    expect(boardPhase(open, [], after)).toBe("underway");
    expect(boardPhase(drawn, [{ period: "q1" }, { period: "final" }], after)).toBe("final");
  });
});

describe("squareWinners", () => {
  // Home digits across the top, away digits down the side.
  const digits = { homeDigits: [3, 0, 7, 1, 4, 9, 2, 6, 8, 5], awayDigits: [8, 4, 1, 0, 2, 3, 9, 5, 7, 6] };

  it("matches the last digit of each team's score so far", () => {
    expect(winningSquare(digits, { homeScore: 17, awayScore: 10 })).toEqual({ row: 3, col: 2 });
    expect(winningSquare({ homeDigits: null, awayDigits: null }, { homeScore: 0, awayScore: 0 })).toBeNull();
  });

  it("reads the final with overtime included", () => {
    // 20–20 after regulation, 26–20 after an overtime touchdown: the final pays 6 and 0, not 0 and 0.
    const claims = [
      { row: 3, col: 7, name: "Pat" },
      { row: 3, col: 1, name: "Sam" },
    ];
    const [final] = squareWinners(digits, [{ period: "final", homeScore: 26, awayScore: 20 }], claims);
    expect(final).toMatchObject({ period: "final", square: { row: 3, col: 7 }, winner: { name: "Pat" } });
  });

  it("gives no winner when an empty square hits", () => {
    const claims = [{ row: 0, col: 0, name: "Pat" }];
    const results = squareWinners(
      digits,
      [
        { period: "q1", homeScore: 3, awayScore: 8 },
        { period: "half", homeScore: 10, awayScore: 14 },
      ],
      claims,
    );
    expect(results.map((r) => [r.period, r.winner?.name ?? null])).toEqual([
      ["q1", "Pat"],
      ["half", null],
    ]);
    expect(results[1]?.square).toEqual({ row: 1, col: 1 });
  });

  it("lists periods in order and skips those without a score", () => {
    const results = squareWinners(
      digits,
      [
        { period: "q3", homeScore: 17, awayScore: 10 },
        { period: "q1", homeScore: 0, awayScore: 0 },
      ],
      [],
    );
    expect(results.map((r) => r.period)).toEqual(["q1", "q3"]);
  });

  it("marks the square that would win now: the live score, else the latest period's", () => {
    const q1 = { period: "q1" as const, homeScore: 7, awayScore: 3 };
    expect(currentSquare(digits, [q1], null)).toEqual(winningSquare(digits, q1));
    expect(currentSquare(digits, [q1], { homeScore: 14, awayScore: 3 })).toEqual({ row: 5, col: 4 });
    expect(currentSquare(digits, [{ ...q1, period: "final" }], { homeScore: 1, awayScore: 1 })).toBeNull();
    expect(currentSquare(digits, [], null)).toBeNull();
  });
});

describe("board requests", () => {
  it("default the limit, and take a feed game or one typed by hand", () => {
    expect(createBoardSchema.parse({})).toEqual({ maxPerPlayer: 10 });
    expect(
      createBoardSchema.safeParse({
        game: { source: "manual", homeTeam: "KC", awayTeam: "KC", kickoff: kickoff.toISOString() },
      }).success,
    ).toBe(false);
    expect(
      createBoardSchema.parse({ game: { source: "feed", year: 2026, week: 22, externalId: "401" } }).game,
    ).toEqual({ source: "feed", year: 2026, week: 22, externalId: "401" });
    expect(updateBoardSchema.safeParse({ maxPerPlayer: 101 }).success).toBe(false);
  });
});
