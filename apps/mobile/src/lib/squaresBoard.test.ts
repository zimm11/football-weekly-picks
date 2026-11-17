import type { BoardQuarter, BoardSquare } from "@picks/shared";
import { describe, expect, it } from "vitest";
import {
  boardTitle,
  cellLabel,
  claimRoom,
  digitAt,
  gameFromDraft,
  quarterRows,
  randomOpenSquare,
  squarePlace,
  winsOf,
  winsText,
  withPending,
} from "./squaresBoard";

const pat: BoardSquare = { row: 2, col: 3, userId: "pat", name: "Pat", guest: false };
const ray: BoardSquare = { row: 0, col: 0, userId: null, name: "Uncle Ray", guest: true };
const drawn = {
  homeTeam: "KC",
  awayTeam: "PHI",
  homeDigits: [3, 0, 7, 4, 1, 9, 2, 6, 8, 5],
  awayDigits: [8, 4, 1, 0, 2, 3, 9, 5, 7, 6],
};
const undrawn = { ...drawn, homeDigits: null, awayDigits: null };

describe("squares board presentation", () => {
  it("names every cell with its owner and numbers", () => {
    const base = { view: drawn, userId: "me", wins: [], current: false };
    expect(cellLabel({ ...base, row: 2, col: 3, square: pat })).toBe("Pat's square, Chiefs 4, Eagles 1");
    expect(cellLabel({ ...base, row: 2, col: 3, square: pat, userId: "pat" })).toBe(
      "Your square, Chiefs 4, Eagles 1",
    );
    expect(cellLabel({ ...base, row: 0, col: 0, square: ray, wins: ["q1", "final"] })).toBe(
      "Uncle Ray's square (guest), Chiefs 3, Eagles 8, won Q1 and Final",
    );
    expect(cellLabel({ ...base, view: undrawn, row: 4, col: 9, square: undefined, current: true })).toBe(
      "Open square, row 5, column 10, would win if the quarter ended now",
    );
    expect(squarePlace(undrawn, 0, 0)).toBe("row 1, column 1");
  });

  it("reads ? for a number until the draw", () => {
    expect(digitAt(null, 3)).toBe("?");
    expect(digitAt(drawn.homeDigits, 3)).toBe("4");
  });

  it("lays unanswered claims and releases over the saved board", () => {
    const shown = withPending(
      [pat, ray],
      [
        { row: 5, col: 5, claim: true, name: "Me", userId: "me" },
        { row: 2, col: 3, claim: false, name: "Pat", userId: "pat" },
      ],
    );
    expect(shown.map((sq) => [sq.row, sq.col, sq.name])).toEqual([
      [0, 0, "Uncle Ray"],
      [5, 5, "Me"],
    ]);
  });

  it("claims a random open square, and none on a full board", () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ row: Math.floor(i / 10), col: i % 10 }));
    expect(randomOpenSquare(full)).toBeNull();
    expect(randomOpenSquare(full.slice(1), () => 0.99)).toEqual({ row: 0, col: 0 });
    expect(randomOpenSquare([], () => 0)).toEqual({ row: 0, col: 0 });
  });

  it("finds what a square has won", () => {
    const quarters: BoardQuarter[] = [
      { period: "q1", homeScore: 3, awayScore: 0, square: { row: 1, col: 1 }, winner: null },
      { period: "half", homeScore: 3, awayScore: 0, square: { row: 1, col: 1 }, winner: null },
      { period: "q3", homeScore: 10, awayScore: 0, square: { row: 2, col: 1 }, winner: null },
    ];
    expect(winsOf(quarters, 1, 1)).toEqual(["q1", "half"]);
    expect(winsText(winsOf(quarters, 1, 1))).toBe("Won Q1 and Halftime");
    expect(winsText([])).toBe("Nothing yet");
    expect(quarterRows({ quarters }).map((r) => [r.label, r.result?.homeScore ?? null])).toEqual([
      ["Q1", 3],
      ["Halftime", 3],
      ["Q3", 10],
      ["Final", null],
    ]);
  });

  it("titles a board and counts the squares left to claim", () => {
    expect(
      boardTitle({ homeTeam: "SEA", awayTeam: "BUF", kickoff: "2027-02-14T23:30:00Z" }, "America/New_York"),
    ).toBe("BUF at SEA · Feb 14");
    expect(claimRoom({ phase: "open", mine: 3, maxPerPlayer: 10, claimed: 95 })).toEqual({
      open: true,
      left: 5,
    });
    expect(claimRoom({ phase: "locked", mine: 3, maxPerPlayer: 10, claimed: 3 })).toEqual({
      open: false,
      left: 0,
    });
  });
});

describe("choosing a board's game", () => {
  const draft = {
    source: "superbowl" as const,
    year: 2026,
    week: 22,
    externalId: "",
    homeTeam: "",
    awayTeam: "",
    kickoff: "",
  };
  it("sends the Super Bowl, the feed's game, or a typed one in the league's time zone", () => {
    expect(gameFromDraft(draft, "UTC")).toEqual({ game: { source: "superbowl" } });
    expect(gameFromDraft({ ...draft, source: "feed" }, "UTC")).toEqual({ error: "Choose a game." });
    expect(gameFromDraft({ ...draft, source: "feed", externalId: "401" }, "UTC").game).toEqual({
      source: "feed",
      year: 2026,
      week: 22,
      externalId: "401",
    });
    const manual = { ...draft, source: "manual" as const, homeTeam: "SEA", awayTeam: "BUF" };
    expect(gameFromDraft({ ...manual, kickoff: "Feb 14" }, "UTC").error).toMatch(/valid kickoff/);
    expect(gameFromDraft({ ...manual, awayTeam: "SEA", kickoff: "2027-02-14 18:30" }, "UTC").error).toMatch(
      /itself/,
    );
    expect(gameFromDraft({ ...manual, kickoff: "2027-02-14 18:30" }, "America/New_York").game).toEqual({
      source: "manual",
      homeTeam: "SEA",
      awayTeam: "BUF",
      kickoff: "2027-02-14T23:30:00.000Z",
    });
  });
});
