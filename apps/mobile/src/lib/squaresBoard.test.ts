import type { BoardQuarter, BoardSquare } from "@picks/shared";
import { describe, expect, it } from "vitest";
import {
  boardTitle,
  cellLabel,
  claimRoom,
  digitAt,
  gameFromDraft,
  gridLayout,
  gridMove,
  quarterRows,
  randomOpenSquare,
  scheduleWeekAt,
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

  it("says a quarter that landed on nobody's square has no winner", () => {
    const base = { view: drawn, userId: "me", current: false };
    expect(cellLabel({ ...base, row: 3, col: 4, square: undefined, wins: ["half"] })).toBe(
      "Open square, Chiefs 1, Eagles 0, hit Halftime, nobody's square",
    );
    expect(cellLabel({ ...base, row: 2, col: 3, square: pat, userId: "pat", wins: ["half"] })).toBe(
      "Your square, Chiefs 4, Eagles 1, won Halftime",
    );
    expect(winsText(["half"], false)).toBe("Hit Halftime: nobody's square, so no winner");
    expect(winsText(["q1", "final"], false)).toBe("Hit Q1 and Final: nobody's square, so no winner");
    expect(winsText(["half"], true)).toBe("Won Halftime");
    expect(winsText([], false)).toBe("Nothing yet");
  });

  it("sizes the grid so all ten columns fit the width it has", () => {
    // Content width is the screen less the page's 16px gutters.
    for (const screen of [320, 360, 393, 430, 559, 560, 768, 928, 1280]) {
      const content = Math.min(screen, 928) - 32;
      const layout = gridLayout(content);
      const card = (layout.bleed ? content + 32 : content) - 2 * layout.padding;
      expect(layout.width, `fits at ${screen}`).toBeLessThanOrEqual(card);
      expect(layout.width).toBe(layout.axis + 10 * (layout.cell + 2));
    }
    // A phone: edge to edge, as large as the width allows.
    expect(gridLayout(393 - 32)).toMatchObject({ bleed: true, cell: 33, twoLines: true });
    expect(gridLayout(320 - 32)).toMatchObject({ bleed: true, cell: 26, twoLines: false });
    // From 560px the cells are full tap targets, and they stop growing at 56px.
    expect(gridLayout(560 - 32)).toMatchObject({ bleed: false, cell: 45 });
    expect(gridLayout(768 - 32).cell).toBe(56);
    expect(gridLayout(896 - 32)).toMatchObject({ bleed: false, cell: 56, width: 32 + 580 });
    // The type never gets too small to read.
    expect(gridLayout(320 - 32).labelSize).toBeGreaterThanOrEqual(9);
    expect(gridLayout(320 - 32).initialsSize).toBeGreaterThanOrEqual(11);
  });

  it("moves the keyboard focus one square at a time and stops at the edges", () => {
    expect(gridMove("ArrowRight", 0, 0)).toEqual({ row: 0, col: 1 });
    expect(gridMove("ArrowDown", 0, 0)).toEqual({ row: 1, col: 0 });
    expect(gridMove("ArrowLeft", 4, 4)).toEqual({ row: 4, col: 3 });
    expect(gridMove("ArrowUp", 4, 4)).toEqual({ row: 3, col: 4 });
    expect(gridMove("ArrowLeft", 0, 0)).toBeUndefined();
    expect(gridMove("ArrowUp", 0, 0)).toBeUndefined();
    expect(gridMove("ArrowRight", 9, 9)).toBeUndefined();
    expect(gridMove("ArrowDown", 9, 9)).toBeUndefined();
    expect(gridMove("Home", 3, 7)).toEqual({ row: 3, col: 0 });
    expect(gridMove("End", 3, 7)).toEqual({ row: 3, col: 9 });
    expect(gridMove("Home", 3, 0)).toBeUndefined();
    expect(gridMove("Enter", 3, 3)).toBeUndefined();
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

describe("the schedule week a new board starts on", () => {
  it("is the week being played, so its games can still be chosen", () => {
    // Before the season: Week 1.
    expect(scheduleWeekAt(2026, new Date("2026-07-04T12:00:00Z"))).toBe(1);
    // Tuesday of Week 11 (Thursday Nov 19), and the Sunday of it.
    expect(scheduleWeekAt(2026, new Date("2026-11-17T15:00:00Z"))).toBe(11);
    expect(scheduleWeekAt(2026, new Date("2026-11-22T18:00:00Z"))).toBe(11);
    // The morning after Monday night: Week 12.
    expect(scheduleWeekAt(2026, new Date("2026-11-25T00:00:00Z"))).toBe(12);
    // The Wild Card weekend follows Week 18; after the Conference round only the Super Bowl is left.
    expect(scheduleWeekAt(2026, new Date("2027-01-14T12:00:00Z"))).toBe(19);
    expect(scheduleWeekAt(2026, new Date("2027-02-10T12:00:00Z"))).toBe(22);
  });
});
