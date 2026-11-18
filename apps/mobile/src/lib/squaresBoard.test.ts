import type { BoardQuarter, BoardSquare } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { colors, elevation } from "../components/theme";
import {
  boardInitials,
  boardNames,
  boardScore,
  boardsInOrder,
  boardTitle,
  cellLabel,
  cellName,
  claimRoom,
  condensedWidth,
  digitAt,
  gameFromDraft,
  gridLayout,
  gridMove,
  holderKey,
  mySquares,
  quarterRows,
  randomOpenSquare,
  scheduleWeekAt,
  scoreStatus,
  squarePlace,
  squareTone,
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
    for (const screen of [320, 360, 375, 390, 393, 430, 559, 560, 768, 928, 1280]) {
      const content = Math.min(screen, 928) - 32;
      const layout = gridLayout(content);
      const card = (layout.bleed ? content + 32 : content) - 2 * layout.padding;
      expect(layout.width, `fits at ${screen}`).toBeLessThanOrEqual(card);
      // The away team's name, its numbers, then ten cells with a gap before each.
      expect(layout.width).toBe(layout.side + layout.axis + 10 * (layout.cell + 2));
      expect(layout.span).toBe(10 * layout.cell + 9 * 2);
    }
    // A phone: edge to edge, as large as the width allows, with room for a mark and a label from 390px.
    expect(gridLayout(393 - 32)).toMatchObject({ bleed: true, cell: 32, twoLines: true });
    expect(gridLayout(390 - 32)).toMatchObject({ bleed: true, cell: 32, twoLines: true });
    expect(gridLayout(320 - 32)).toMatchObject({ bleed: true, cell: 25, twoLines: false });
    // From 560px the cells are tap-sized, and they stop growing at 56px.
    expect(gridLayout(560 - 32)).toMatchObject({ bleed: false, cell: 43 });
    expect(gridLayout(768 - 32).cell).toBe(56);
    expect(gridLayout(896 - 32)).toMatchObject({ bleed: false, cell: 56, width: 24 + 28 + 580 });
    // Beside a rail on a desktop, the card also fits the window's height: 52px at most, 40px at least.
    const beside = 864 - 16 - 232;
    expect(gridLayout(beside, 16, 2000).cell).toBe(52);
    expect(gridLayout(beside, 16, 551)).toMatchObject({ cell: 42, height: 86 + 11 * 42 });
    expect(gridLayout(beside, 16, 551).height).toBeLessThanOrEqual(551);
    expect(gridLayout(beside, 16, 651).cell).toBe(51);
    expect(gridLayout(beside, 16, 300).cell).toBe(40);
    // The width still has the last word, and the card's height adds up the same without a height to fit.
    expect(gridLayout(560 - 32, 16, 2000).cell).toBe(43);
    expect(gridLayout(390 - 32).height).toBe(2 * 10 + 22 + 2 + 20 + 11 * 32);
    // The type never gets too small to read.
    expect(gridLayout(320 - 32).labelSize).toBeGreaterThanOrEqual(9);
    expect(gridLayout(320 - 32).holderSize).toBeGreaterThanOrEqual(11);
    expect(gridLayout(320 - 32).nameSize).toBeGreaterThanOrEqual(13);
  });

  it("lists boards still to finish first, then finished ones from the latest", () => {
    const board = (id: string, kickoff: string, phase: "open" | "locked" | "underway" | "final") => ({
      id,
      kickoff,
      phase,
    });
    const boards = [
      board("older", "2025-02-09T23:30:00Z", "final"),
      board("old", "2026-02-08T23:30:00Z", "final"),
      board("later", "2028-02-13T23:30:00Z", "open"),
      board("next", "2027-02-14T23:30:00Z", "underway"),
    ];
    expect(boardsInOrder(boards).map((b) => b.id)).toEqual(["next", "later", "old", "older"]);
    expect(boards.map((b) => b.id)).toEqual(["older", "old", "later", "next"]);
    expect(boardsInOrder([])).toEqual([]);
  });

  it("shows the live score, else the latest quarter scored", () => {
    const quarter = (period: BoardQuarter["period"], homeScore: number, awayScore: number): BoardQuarter => ({
      period,
      homeScore,
      awayScore,
      square: null,
      winner: null,
    });
    expect(boardScore({ live: null, quarters: [] })).toBeNull();
    expect(boardScore({ live: { homeScore: 10, awayScore: 3 }, quarters: [quarter("q1", 7, 3)] })).toEqual({
      homeScore: 10,
      awayScore: 3,
      status: "Live",
      label: "Live score",
      live: true,
    });
    // A board typed in by hand has no live score: the last quarter entered stands in for it.
    expect(boardScore({ live: null, quarters: [quarter("q1", 7, 3)] })).toMatchObject({
      homeScore: 7,
      status: "After Q1",
      label: "Score after Q1",
      live: false,
    });
    expect(boardScore({ live: null, quarters: [quarter("half", 14, 3), quarter("q1", 7, 3)] })).toMatchObject(
      {
        homeScore: 14,
        status: "Halftime",
        label: "Halftime score",
      },
    );
    expect(
      boardScore({
        live: null,
        quarters: [quarter("q1", 7, 3), quarter("q3", 17, 10), quarter("final", 26, 20)],
      }),
    ).toMatchObject({ homeScore: 26, awayScore: 20, status: "Final", label: "Final score" });
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

  it("fills only your squares and winning ones solid; everyone else's fades from their color", () => {
    const colorOf = () => "#7c3aed";
    expect(squareTone({ mine: true, won: false, name: "Me" }, colorOf)).toEqual({
      fill: colors.primary,
      gradient: `linear-gradient(145deg, ${colors.primaryLight}, ${colors.primary} 65%)`,
      shadow: `${elevation.glowPrimary}, ${elevation.squareEdge}`,
      ink: colors.primaryForeground,
    });
    expect(squareTone({ mine: true, won: true, name: "Me" }, colorOf)).toMatchObject({
      fill: colors.win,
      shadow: `${elevation.glowWin}, ${elevation.squareEdge}`,
      ink: colors.primaryForeground,
    });
    expect(squareTone({ mine: false, won: true, name: "Pat" }, colorOf).fill).toBe(colors.win);
    expect(squareTone({ mine: false, won: false, name: "Pat" }, colorOf)).toEqual({
      fill: "#7c3aed66",
      gradient: "linear-gradient(145deg, #7c3aede6, #7c3aed4d)",
      shadow: elevation.squareEdge,
      ink: colors.foreground,
    });
    expect(holderKey(pat)).toBe("pat");
    expect(holderKey(ray)).toBe("guest:Uncle Ray");
  });

  it("calls each holder by a name that is as short as stays unique on the board", () => {
    const holder = (userId: string | null, name: string) => ({ userId, name });
    const names = boardNames([
      holder("a", "Chris Martin"),
      holder("b", "Chris Howard"),
      holder("c", "Sam Patel"),
      holder("c", "Sam Patel"),
      holder("d", "jordan lee"),
      holder("e", "Jordan Lake"),
      holder("f", "Kate"),
      holder(null, "Uncle Rob"),
      holder("g", "  Bo   Jackson "),
    ]);
    expect(Object.fromEntries(names)).toEqual({
      a: "Chris M",
      b: "Chris H",
      // The same player twice is one holder.
      c: "Sam",
      // Same first name and last initial, ignoring case: the whole name.
      d: "jordan lee",
      e: "Jordan Lake",
      f: "Kate",
      "guest:Uncle Rob": "Uncle",
      g: "Bo",
    });
    // A guest who shares a player's first name is told apart the same way.
    expect(Object.fromEntries(boardNames([holder("a", "Rob Smith"), holder(null, "Rob")]))).toEqual({
      a: "Rob S",
      "guest:Rob": "Rob",
    });
  });

  it("gives each holder initials unique on the board, for squares too narrow for a name", () => {
    const initials = boardInitials([
      { userId: "a", name: "Chris Martin" },
      { userId: "b", name: "Chris Moore" },
      { userId: "c", name: "Sam Patel" },
      { userId: "d", name: "Kate" },
    ]);
    expect(Object.fromEntries(initials)).toEqual({ a: "CMA", b: "CMO", c: "SP", d: "KA" });
  });

  it("shows a holder's name when it fits the square, and their initials when it doesn't", () => {
    // Barlow Condensed's own widths: "i" is narrow, "M" wide, and anything outside ASCII errs wide.
    expect(condensedWidth("i", 10)).toBeCloseTo(2.15);
    expect(condensedWidth("MM", 10)).toBeCloseTo(10.76);
    expect(condensedWidth("é", 10)).toBeGreaterThan(condensedWidth("e", 10));
    expect(condensedWidth("🏈", 10)).toBe(10);
    const names = new Map([
      ["a", "Jordan"],
      ["b", "Maximilian"],
      ["c", "Chris M"],
    ]);
    const initials = new Map([
      ["a", "JL"],
      ["b", "MO"],
      ["c", "CMA"],
    ]);
    const phone = gridLayout(390 - 32);
    const small = gridLayout(320 - 32);
    const desktop = gridLayout(896 - 32);
    expect(cellName("a", names, initials, phone)).toBe("Jordan");
    expect(cellName("b", names, initials, phone)).toBe("MO");
    expect(cellName("c", names, initials, phone)).toBe("CMA");
    // "Chris M" needs a computer's square; a long name is initials even there.
    expect(cellName("b", names, initials, desktop)).toBe("MO");
    expect(cellName("c", names, initials, desktop)).toBe("Chris M");
    expect(cellName("a", names, initials, small)).toBe("JL");
    expect(cellName("c", names, initials, small)).toBe("CMA");
    // Every name that is shown fits its square, with room to spare at the edges.
    for (const layout of [small, phone, desktop])
      for (const key of names.keys()) {
        const shown = cellName(key, names, initials, layout);
        if (shown === names.get(key))
          expect(condensedWidth(shown, layout.holderSize)).toBeLessThanOrEqual(layout.cell - 4);
      }
  });

  it("lists your squares with their numbers once drawn, and what each has won", () => {
    const mine: BoardSquare = { row: 0, col: 1, userId: "pat", name: "Pat", guest: false };
    const view = {
      ...drawn,
      squares: [pat, ray, mine],
      quarters: [
        { period: "q1" as const, homeScore: 10, awayScore: 8, square: { row: 0, col: 1 }, winner: null },
      ],
      current: { row: 2, col: 3 },
    };
    expect(mySquares(view, "pat")).toEqual([
      { square: mine, row: 0, col: 1, numbers: "KC 0 · PHI 8", wins: ["q1"], current: false },
      { square: pat, row: 2, col: 3, numbers: "KC 4 · PHI 1", wins: [], current: true },
    ]);
    expect(mySquares({ ...view, homeDigits: null, awayDigits: null }, "pat")).toEqual([]);
    expect(mySquares(view, "nobody")).toEqual([]);
  });

  it("words a score as the scoreboard does", () => {
    expect(scoreStatus("q1")).toEqual({ status: "After Q1", label: "Score after Q1" });
    expect(scoreStatus("half")).toEqual({ status: "Halftime", label: "Halftime score" });
    expect(scoreStatus("q3").status).toBe("After Q3");
    expect(scoreStatus("final").status).toBe("Final");
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
