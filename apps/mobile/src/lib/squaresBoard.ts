import {
  BOARD_SIZE,
  type BoardGame,
  type BoardQuarter,
  type BoardSquare,
  type BoardSummary,
  type BoardView,
  estimatedWeekStart,
  LAST_WEEK,
  SQUARE_PERIOD_LABEL,
  type SquarePeriod,
  teamName,
} from "@picks/shared";
import { parseLeagueKickoff } from "./leagueLogic";

/*
 * The squares board's presentation, as pure functions: what each cell shows and says, the optimistic claims
 * laid over the last saved board, the grid's measurements and the Boards list's order. The screens in
 * screens/squares/ draw them.
 */

export const squareKey = (row: number, col: number) => `${row}:${col}`;

/** A change sent but not yet answered: a claim shows at once as the player's, a release as open. */
export type PendingChange = {
  row: number;
  col: number;
  claim: boolean;
  name: string;
  avatarId?: number | null;
  userId: string | null;
};

/** The board's squares with unanswered changes laid over them. */
export function withPending(squares: BoardSquare[], pending: PendingChange[]): BoardSquare[] {
  const byKey = new Map(squares.map((sq) => [squareKey(sq.row, sq.col), sq]));
  for (const change of pending) {
    const key = squareKey(change.row, change.col);
    if (change.claim) {
      byKey.set(key, {
        row: change.row,
        col: change.col,
        userId: change.userId,
        name: change.name,
        avatarId: change.avatarId,
        guest: change.userId === null,
      });
    } else byKey.delete(key);
  }
  return [...byKey.values()];
}

/** An open square chosen at random ("Claim a random square"), or null when the board is full. */
export function randomOpenSquare(
  squares: Pick<BoardSquare, "row" | "col">[],
  random: () => number = Math.random,
): { row: number; col: number } | null {
  const taken = new Set(squares.map((sq) => squareKey(sq.row, sq.col)));
  const open: { row: number; col: number }[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) if (!taken.has(squareKey(row, col))) open.push({ row, col });
  }
  return open[Math.floor(random() * open.length)] ?? null;
}

/** A row's or column's number: the drawn digit, or "?" until the draw. */
export const digitAt = (digits: number[] | null, index: number) =>
  digits ? String(digits[index] ?? "?") : "?";

/** The periods a square has won, in order. */
export const winsOf = (quarters: BoardQuarter[], row: number, col: number): SquarePeriod[] =>
  quarters.filter((q) => q.square?.row === row && q.square.col === col).map((q) => q.period);

/** "Q1", "Half", "Q3", "Final": the short label a winning cell carries. */
export const SHORT_PERIOD: Record<SquarePeriod, string> = {
  q1: "Q1",
  half: "Half",
  q3: "Q3",
  final: "Final",
};

const joinPeriods = (periods: SquarePeriod[]) =>
  periods.map((p) => SQUARE_PERIOD_LABEL[p]).join(periods.length > 2 ? ", " : " and ");

/** Where a square sits, in words: its two numbers once drawn ("Chiefs 4, Eagles 1"), else its row and column. */
export function squarePlace(
  view: Pick<BoardView, "homeTeam" | "awayTeam" | "homeDigits" | "awayDigits">,
  row: number,
  col: number,
) {
  if (!view.homeDigits || !view.awayDigits) return `row ${row + 1}, column ${col + 1}`;
  return `${teamName(view.homeTeam)} ${view.homeDigits[col]}, ${teamName(view.awayTeam)} ${view.awayDigits[row]}`;
}

/**
 * A cell's accessible name: whose it is, its numbers, and anything it has won or would win now. "Pat's square,
 * Chiefs 4, Eagles 1, won Q1", "Your square, row 3, column 5", "Open square, Chiefs 0, Eagles 7". A quarter that
 * landed on a square nobody holds has no winner, and says so: "Open square, Chiefs 0, Eagles 7, hit Halftime,
 * nobody's square".
 */
export function cellLabel(input: {
  view: Pick<BoardView, "homeTeam" | "awayTeam" | "homeDigits" | "awayDigits">;
  row: number;
  col: number;
  square: BoardSquare | undefined;
  userId: string;
  wins: SquarePeriod[];
  current: boolean;
}) {
  const { view, row, col, square, userId, wins, current } = input;
  const whose = !square
    ? "Open square"
    : square.userId === userId
      ? "Your square"
      : `${square.name}'s square${square.guest ? " (guest)" : ""}`;
  const parts = [whose, squarePlace(view, row, col)];
  if (wins.length)
    parts.push(square ? `won ${joinPeriods(wins)}` : `hit ${joinPeriods(wins)}, nobody's square`);
  if (current) parts.push("would win if the quarter ended now");
  return parts.join(", ");
}

/**
 * What a square has won, for its sheet: "Won Q1 and Final", or "Nothing yet". A quarter that landed on a square
 * nobody holds (`held` false) is no win: "Hit Halftime: nobody's square, so no winner".
 */
export const winsText = (wins: SquarePeriod[], held = true) =>
  !wins.length
    ? "Nothing yet"
    : held
      ? `Won ${joinPeriods(wins)}`
      : `Hit ${joinPeriods(wins)}: nobody's square, so no winner`;

/** The gap between cells, in every size of grid. */
export const GRID_GAP = 2;

/**
 * The grid's measurements for the width the page gives it (`contentWidth`, inside the page's `gutter` on each
 * side), so all ten columns always show: no sideways scrolling. Left of the cells sit two narrow columns: the
 * away team's name, turned to read up the side (`side`), then its numbers (`axis`).
 * - Under 560px of screen the card runs edge to edge (`bleed`) with 4px of padding: 32px cells on a 390px
 *   phone, 25px at 320px. Cells may be under the 44px tap size there, because the whole board has to be in view.
 * - From 560px the card sits inside the gutter and its cells are 43px or more, growing to 56px.
 */
export function gridLayout(contentWidth: number, gutter = 16) {
  const bleed = contentWidth + 2 * gutter < 560;
  const padding = bleed ? 4 : 12;
  const side = bleed ? 18 : 24;
  const axis = bleed ? 22 : 28;
  const inner = (bleed ? contentWidth + 2 * gutter : contentWidth) - 2 * padding;
  const cell = Math.max(
    16,
    Math.min(56, Math.floor((inner - side - axis - BOARD_SIZE * GRID_GAP) / BOARD_SIZE)),
  );
  return {
    bleed,
    padding,
    /** The width of the column holding the away team's name. */
    side,
    /** The width of the column of row numbers. */
    axis,
    cell,
    /** The ten cells of a row or column, with the gaps between them. */
    span: BOARD_SIZE * cell + (BOARD_SIZE - 1) * GRID_GAP,
    /** The whole board: the name column, the number column, ten cells and the gaps between them. */
    width: side + axis + BOARD_SIZE * (cell + GRID_GAP),
    /** Room for a holder's mark and a quarter's label, one above the other; a smaller cell shows one of them. */
    twoLines: cell >= 32,
    /** Type sizes that stay readable as the cell shrinks. */
    digitSize: Math.max(13, Math.min(22, Math.round(cell * 0.5))),
    nameSize: bleed ? (cell < 28 ? 13 : 14) : 18,
    initialsSize: cell >= 52 ? 15 : cell >= 44 ? 13 : cell >= 30 ? 12 : 11,
    labelSize: cell >= 52 ? 12 : cell >= 44 ? 11 : cell >= 30 ? 10 : 9,
    /** A profile picture alone in its cell, and with a quarter's label under it. */
    avatarSize: Math.max(14, Math.min(30, cell - 10)),
    avatarSizeLabelled: Math.max(14, Math.min(26, cell - 18)),
  };
}

/**
 * Where an arrow key moves the keyboard focus on the grid: one square over, stopping at the edges; Home and End
 * go to the ends of the row. Undefined for any other key, or when there is nowhere to go.
 */
export function gridMove(key: string, row: number, col: number): { row: number; col: number } | undefined {
  const last = BOARD_SIZE - 1;
  const next =
    key === "ArrowUp"
      ? { row: row - 1, col }
      : key === "ArrowDown"
        ? { row: row + 1, col }
        : key === "ArrowLeft"
          ? { row, col: col - 1 }
          : key === "ArrowRight"
            ? { row, col: col + 1 }
            : key === "Home"
              ? { row, col: 0 }
              : key === "End"
                ? { row, col: last }
                : undefined;
  if (!next || next.row < 0 || next.row > last || next.col < 0 || next.col > last) return undefined;
  return next.row === row && next.col === col ? undefined : next;
}

/**
 * The NFL week being played at `now`, by the calendar: the first whose games aren't over yet (until the morning
 * after its Monday night, four and a half days on from its Thursday evening), the postseason rounds following on;
 * the Super Bowl after that. Where "A game from the schedule" starts, so it opens on games that can still be chosen.
 */
export function scheduleWeekAt(year: number, now: Date): number {
  const weekLasts = 4.5 * 24 * 60 * 60_000;
  for (let number = 1; number < LAST_WEEK; number++) {
    if (estimatedWeekStart(year, number).getTime() + weekLasts > now.getTime()) return number;
  }
  return LAST_WEEK;
}

/** A board's short name, for a link's label and the admin's confirmations: "BUF at SEA · Feb 14". */
export function boardTitle(board: Pick<BoardSummary, "homeTeam" | "awayTeam" | "kickoff">, timeZone: string) {
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(
    new Date(board.kickoff),
  );
  return `${board.awayTeam} at ${board.homeTeam} · ${day}`;
}

/** The Boards list's order: boards still to finish first, the soonest kickoff on top, then finished ones, latest first. */
export function boardsInOrder<B extends Pick<BoardSummary, "kickoff" | "phase">>(boards: B[]): B[] {
  const at = (board: B) => Date.parse(board.kickoff);
  return [
    ...boards.filter((b) => b.phase !== "final").sort((a, b) => at(a) - at(b)),
    ...boards.filter((b) => b.phase === "final").sort((a, b) => at(b) - at(a)),
  ];
}

/**
 * The score the board shows above its grid, and what it is: the feed's live score while the game is on, else
 * the latest quarter scored ("After Q1", "Halftime", "After Q3", "Final"). `label` names it for a screen reader
 * ("Live score", "Score after Q1"). Null until there is a score.
 */
export function boardScore(view: Pick<BoardView, "live" | "quarters">) {
  if (view.live) return { ...view.live, status: "Live", label: "Live score", live: true };
  const latest = quarterRows(view)
    .reverse()
    .find((row) => row.result)?.result;
  if (!latest) return null;
  const name = SQUARE_PERIOD_LABEL[latest.period];
  const settled = latest.period === "final" || latest.period === "half";
  return {
    homeScore: latest.homeScore,
    awayScore: latest.awayScore,
    status: settled ? name : `After ${name}`,
    label: settled ? `${name} score` : `Score after ${name}`,
    live: false,
  };
}

/** How many squares a player can still claim, and whether the board still takes claims. */
export function claimRoom(view: Pick<BoardView, "phase" | "mine" | "maxPerPlayer" | "claimed">) {
  const open = view.phase === "open";
  return { open, left: open ? Math.max(0, Math.min(view.maxPerPlayer - view.mine, 100 - view.claimed)) : 0 };
}

/** The quarter results under the grid: one row per period, scored or still to come. */
export function quarterRows(view: Pick<BoardView, "quarters">) {
  return (["q1", "half", "q3", "final"] as const).map((period) => ({
    period,
    label: SQUARE_PERIOD_LABEL[period],
    result: view.quarters.find((q) => q.period === period) ?? null,
  }));
}

/** The admin's choice of a board's game, as typed: the Super Bowl, a game from the feed, or one typed by hand. */
export type GameDraft = {
  source: "superbowl" | "feed" | "manual";
  year: number;
  week: number;
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  /** `YYYY-MM-DD HH:mm` in the league's time zone. */
  kickoff: string;
};

/** What to send for the drafted game, or a message when something is missing. */
export function gameFromDraft(draft: GameDraft, timeZone: string): { game?: BoardGame; error?: string } {
  if (draft.source === "superbowl") return { game: { source: "superbowl" } };
  if (draft.source === "feed") {
    return draft.externalId
      ? { game: { source: "feed", year: draft.year, week: draft.week, externalId: draft.externalId } }
      : { error: "Choose a game." };
  }
  if (!draft.homeTeam || !draft.awayTeam) return { error: "Choose both teams." };
  if (draft.homeTeam === draft.awayTeam) return { error: "A team can't play itself." };
  const kickoff = parseLeagueKickoff(draft.kickoff, timeZone);
  if (!kickoff) return { error: "Enter a valid kickoff as YYYY-MM-DD HH:mm." };
  return {
    game: {
      source: "manual",
      homeTeam: draft.homeTeam as never,
      awayTeam: draft.awayTeam as never,
      kickoff: kickoff.toISOString(),
    },
  };
}
