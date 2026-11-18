import { z } from "zod";
import { TEAM_ABBRS } from "./teams";

/*
 * Squares: a league holds boards, each a 10 by 10 grid on one NFL game. Players claim squares, the board locks
 * (an admin's Lock and draw, or kickoff), two random orders of 0–9 are drawn, and one square wins at the end of
 * each quarter. Rows are the away team's side, columns the home team's (its digits run across the top). The
 * rules here are pure functions: `drawDigits`, `checkClaim`, `checkRelease`, `boardPhase`, `squareWinners` and
 * `winningSquare`. A board's phase and its quarter winners are worked out on read, never stored.
 */

/** The four results a board is scored on, in order. Scores are cumulative; the final includes overtime. */
export const SQUARE_PERIODS = ["q1", "half", "q3", "final"] as const;
export type SquarePeriod = (typeof SQUARE_PERIODS)[number];

/** How each period reads to players: "Q1", "Halftime", "Q3", "Final". */
export const SQUARE_PERIOD_LABEL: Record<SquarePeriod, string> = {
  q1: "Q1",
  half: "Halftime",
  q3: "Q3",
  final: "Final",
};

/** Squares one player may claim on a new board, and the bounds an admin can set. */
export const DEFAULT_SQUARES_PER_PLAYER = 10;
export const MAX_SQUARES_PER_PLAYER = 100;

/** The grid is 10 by 10: rows and columns run 0–9. */
export const BOARD_SIZE = 10;

/** A squares league has no per-season settings: each board carries its own. */
export const squaresSettingsSchema = z.object({});
export type SquaresSettings = z.infer<typeof squaresSettingsSchema>;

// ---------- The draw ----------

/**
 * A source of uniformly random 32-bit unsigned integers (0 to 2^32 - 1). The API's default reads
 * `crypto.getRandomValues`; tests pass a fixed sequence.
 */
export type RandomSource = () => number;

/** `crypto.getRandomValues`, one 32-bit value at a time. Works in Node, the Workers runtime and browsers. */
export const cryptoRandom: RandomSource = () => {
  const value = new Uint32Array(1);
  (
    globalThis as unknown as { crypto: { getRandomValues(array: Uint32Array): unknown } }
  ).crypto.getRandomValues(value);
  return value[0] ?? 0;
};

const UINT32_RANGE = 2 ** 32;

/** A uniform integer in [0, n), by rejection: values past the last whole multiple of n are drawn again. */
function below(n: number, random: RandomSource): number {
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  for (;;) {
    const value = random();
    if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
      throw new Error("A random source must return 32-bit unsigned integers");
    }
    if (value < limit) return value % n;
  }
}

/** One random order of the digits 0–9: an unbiased Fisher–Yates shuffle. */
export function drawDigits(random: RandomSource): number[] {
  const digits = Array.from({ length: BOARD_SIZE }, (_, i) => i);
  for (let i = digits.length - 1; i > 0; i--) {
    const j = below(i + 1, random);
    [digits[i], digits[j]] = [digits[j] as number, digits[i] as number];
  }
  return digits;
}

// ---------- Boards as the rules read them ----------

export type BoardRules = {
  kickoff: Date;
  maxPerPlayer: number;
  /** When the numbers were drawn (the board locked). Null while it is open. */
  drawnAt: Date | null;
};

/** A board is locked once its numbers are drawn, or from kickoff whether or not the draw has run yet. */
export const boardLocked = (board: Pick<BoardRules, "kickoff" | "drawnAt">, now: Date) =>
  board.drawnAt !== null || now >= board.kickoff;

/** Open, Locked, Underway or Final, derived from the draw, the kickoff and whether a final score is in. */
export const BOARD_PHASES = ["open", "locked", "underway", "final"] as const;
export type BoardPhase = (typeof BOARD_PHASES)[number];
export const BOARD_PHASE_LABEL: Record<BoardPhase, string> = {
  open: "Open",
  locked: "Locked",
  underway: "Underway",
  final: "Final",
};

export function boardPhase(
  board: Pick<BoardRules, "kickoff" | "drawnAt">,
  scores: { period: SquarePeriod }[],
  now: Date,
): BoardPhase {
  if (scores.some((s) => s.period === "final")) return "final";
  if (now >= board.kickoff) return "underway";
  return board.drawnAt ? "locked" : "open";
}

/** A square someone holds: a player, or a guest an admin named. */
export type ClaimOwner = { userId: string | null; guestName: string | null };

/**
 * Why a claim can't be made, or null when it can. `mine` is how many squares the player already holds on the
 * board. Guest squares count against nobody's limit, so a guest claim skips that check.
 */
export function checkClaim(input: {
  board: BoardRules;
  taken: ClaimOwner | null;
  mine: number;
  guest: boolean;
  now: Date;
}): string | null {
  const { board, taken, mine, guest, now } = input;
  if (boardLocked(board, now)) return "The board is locked.";
  if (taken) return "That square is already taken.";
  if (!guest && mine >= board.maxPerPlayer) {
    return `You can hold ${board.maxPerPlayer} ${board.maxPerPlayer === 1 ? "square" : "squares"} on this board.`;
  }
  return null;
}

/** Why a square can't be released, or null when it can: your own, or any square for an admin, until the lock. */
export function checkRelease(input: {
  board: Pick<BoardRules, "kickoff" | "drawnAt">;
  claim: ClaimOwner | null;
  userId: string;
  admin: boolean;
  now: Date;
}): string | null {
  const { board, claim, userId, admin, now } = input;
  if (boardLocked(board, now)) return "The board is locked.";
  if (!claim) return "That square is open.";
  if (!admin && claim.userId !== userId) return "That square isn't yours.";
  return null;
}

/** The limit can be raised before the lock and is never lowered. */
export function checkLimitChange(board: BoardRules, next: number, now: Date): string | null {
  if (next === board.maxPerPlayer) return null;
  if (boardLocked(board, now)) return "The board is locked.";
  if (next < board.maxPerPlayer) return "The limit can be raised, never lowered.";
  return null;
}

// ---------- Winners ----------

export type DrawnDigits = { homeDigits: number[] | null; awayDigits: number[] | null };
export type PeriodScoreRow = { period: SquarePeriod; homeScore: number; awayScore: number };

/** The square whose numbers match the last digit of each team's score, or null before the draw. */
export function winningSquare(
  digits: DrawnDigits,
  score: { homeScore: number; awayScore: number },
): { row: number; col: number } | null {
  if (!digits.homeDigits || !digits.awayDigits) return null;
  const col = digits.homeDigits.indexOf(score.homeScore % 10);
  const row = digits.awayDigits.indexOf(score.awayScore % 10);
  return col >= 0 && row >= 0 ? { row, col } : null;
}

export type QuarterResult<C> = {
  period: SquarePeriod;
  homeScore: number;
  awayScore: number;
  /** The winning square, null before the draw. */
  square: { row: number; col: number } | null;
  /** Who holds it. Null when nobody does: an empty square that hits means no winner for that quarter. */
  winner: C | null;
};

/**
 * Each scored period's winning square and its holder, in period order. Scores are cumulative (the final
 * includes overtime), so only the last digits of the totals so far matter. Periods with no score are left out.
 */
export function squareWinners<C extends { row: number; col: number }>(
  digits: DrawnDigits,
  scores: PeriodScoreRow[],
  claims: C[],
): QuarterResult<C>[] {
  const byPeriod = new Map(scores.map((s) => [s.period, s]));
  return SQUARE_PERIODS.flatMap((period) => {
    const score = byPeriod.get(period);
    if (!score) return [];
    const square = winningSquare(digits, score);
    const winner = square ? (claims.find((c) => c.row === square.row && c.col === square.col) ?? null) : null;
    return [{ period, homeScore: score.homeScore, awayScore: score.awayScore, square, winner }];
  });
}

/**
 * The square that would win if the quarter ended now: the live score's, else the latest scored period's. Null
 * before the draw, with no score to go on, or once the final is in (the board shows its results instead).
 */
export function currentSquare(
  digits: DrawnDigits,
  scores: PeriodScoreRow[],
  live: { homeScore: number; awayScore: number } | null,
): { row: number; col: number } | null {
  if (scores.some((s) => s.period === "final")) return null;
  const latest = [...SQUARE_PERIODS]
    .reverse()
    .map((period) => scores.find((s) => s.period === period))
    .find(Boolean);
  const score = live ?? latest;
  return score ? winningSquare(digits, score) : null;
}

// ---------- Requests ----------

const CONTROL_CHARACTERS = /[\p{Cc}\u2028\u2029]/u;
const teamSchema = z.enum(TEAM_ABBRS);
const limitSchema = z.int().min(1).max(MAX_SQUARES_PER_PLAYER);
const boardScoreSchema = z.int().min(0).max(200);

/** A guest's name, typed by an admin: one line, as display names are (it is shown on the board). */
export const guestNameSchema = z
  .string()
  .trim()
  .min(1, "Enter the guest's name")
  .max(40)
  .refine((value) => !CONTROL_CHARACTERS.test(value), "Use a single line of text.");

/**
 * A board's game: the season's Super Bowl (once the feed lists it; also what creating a board without a game
 * picks), one from the feed (its season year, week on the 1–22 line and the feed's id), or teams and a kickoff
 * typed by hand.
 */
export const boardGameSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("superbowl") }),
  z.object({
    source: z.literal("feed"),
    year: z.int().min(2000).max(2100),
    week: z.int().min(1).max(22),
    externalId: z.string().min(1).max(64),
  }),
  z
    .object({
      source: z.literal("manual"),
      homeTeam: teamSchema,
      awayTeam: teamSchema,
      kickoff: z.iso.datetime({ offset: true }),
    })
    .refine((g) => g.homeTeam !== g.awayTeam, "A team can't play itself"),
]);
export type BoardGame = z.infer<typeof boardGameSchema>;

export const createBoardSchema = z.object({
  game: boardGameSchema.optional(),
  maxPerPlayer: limitSchema.default(DEFAULT_SQUARES_PER_PLAYER),
});
export type CreateBoard = z.input<typeof createBoardSchema>;

export const updateBoardSchema = z.object({
  game: boardGameSchema.optional(),
  maxPerPlayer: limitSchema.optional(),
});
export type UpdateBoard = z.infer<typeof updateBoardSchema>;

/** Claiming a square: for yourself, or (admins only) under a guest's name. */
export const claimSquareSchema = z.object({ guestName: guestNameSchema.optional() });

/** An admin's score for one period. Both null clears it, so the feed fills it again. */
export const boardScoreBodySchema = z
  .object({ homeScore: boardScoreSchema.nullable(), awayScore: boardScoreSchema.nullable() })
  .refine((s) => (s.homeScore === null) === (s.awayScore === null), "Enter both scores, or neither.");

export const boardFeedGamesQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  week: z.coerce.number().int().min(1).max(22),
});

// ---------- Responses ----------

export type BoardSummary = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  phase: BoardPhase;
  /** Squares claimed, of 100. */
  claimed: number;
  /** Squares the reader holds. */
  mine: number;
  maxPerPlayer: number;
};

export type BoardSquare = {
  row: number;
  col: number;
  /** The player holding it; null for a guest square. */
  userId: string | null;
  /** The player's display name, or the guest's. */
  name: string;
  avatarId?: number | null;
  guest: boolean;
};

export type BoardScore = PeriodScoreRow & { byAdmin: boolean };

export type BoardQuarter = {
  period: SquarePeriod;
  homeScore: number;
  awayScore: number;
  square: { row: number; col: number } | null;
  winner: { userId: string | null; name: string; guest: boolean } | null;
};

export type BoardView = BoardSummary & {
  leagueId: string;
  leagueName: string;
  timeZone: string;
  role: "admin" | "member";
  /** Where the game came from: the feed (with its year and week) or typed by hand (all null). */
  externalId: string | null;
  year: number | null;
  week: number | null;
  /** The drawn digits, column by column and row by row. Null until the draw, when the headers read "?". */
  homeDigits: number[] | null;
  awayDigits: number[] | null;
  drawnAt: string | null;
  squares: BoardSquare[];
  scores: BoardScore[];
  /** Each scored period's result, in order. */
  quarters: BoardQuarter[];
  /** The game's score right now while it is under way, when the feed says. */
  live: { homeScore: number; awayScore: number } | null;
  /** The square that would win if the quarter ended now (while the game is on). */
  current: { row: number; col: number } | null;
  /** Everyone holding a square, with how many: players by name, guests marked. Most squares first. */
  players: { userId: string | null; name: string; avatarId?: number | null; guest: boolean; count: number }[];
};

/** A game from the feed an admin can put a board on. */
export type BoardFeedGame = {
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
};
