import {
  BOARD_SIZE,
  type BoardGame,
  type BoardQuarter,
  type BoardSquare,
  type BoardSummary,
  type BoardView,
  SQUARE_PERIOD_LABEL,
  type SquarePeriod,
  teamName,
} from "@picks/shared";
import { parseLeagueKickoff } from "./leagueLogic";

/*
 * The squares board's presentation, as pure functions: what each cell shows and says, the optimistic claims
 * laid over the last saved board, and the board selector's labels. The screens in screens/squares/ draw them.
 */

export const squareKey = (row: number, col: number) => `${row}:${col}`;

/** A change sent but not yet answered: a claim shows at once as the player's, a release as open. */
export type PendingChange = { row: number; col: number; claim: boolean; name: string; userId: string | null };

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
 * Chiefs 4, Eagles 1, won Q1", "Your square, row 3, column 5", "Open square, Chiefs 0, Eagles 7".
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
  if (wins.length) parts.push(`won ${joinPeriods(wins)}`);
  if (current) parts.push("would win if the quarter ended now");
  return parts.join(", ");
}

/** What a square has won, for its sheet: "Won Q1 and Final", or "Nothing yet". */
export const winsText = (wins: SquarePeriod[]) => (wins.length ? `Won ${joinPeriods(wins)}` : "Nothing yet");

/** A board's name in the selector and lists: "BUF at SEA · Feb 14". */
export function boardTitle(board: Pick<BoardSummary, "homeTeam" | "awayTeam" | "kickoff">, timeZone: string) {
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone }).format(
    new Date(board.kickoff),
  );
  return `${board.awayTeam} at ${board.homeTeam} · ${day}`;
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
