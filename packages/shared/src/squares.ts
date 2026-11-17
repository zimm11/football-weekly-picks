import { z } from "zod";

/*
 * Squares: a league holds boards, each a 10 by 10 grid on one NFL game. Its rules go here as pure functions
 * (drawDigits(random), checkClaim, squareWinners). A board's phase and its quarter winners are worked out on read.
 */

/** The four results a board pays, in order. Scores are cumulative; the final includes overtime. */
export const SQUARE_PERIODS = ["q1", "half", "q3", "final"] as const;
export type SquarePeriod = (typeof SQUARE_PERIODS)[number];

/** Squares one player may claim on a new board, and the bounds an admin can set. */
export const DEFAULT_SQUARES_PER_PLAYER = 10;
export const MAX_SQUARES_PER_PLAYER = 100;

/** A squares league has no per-season settings: each board carries its own. */
export const squaresSettingsSchema = z.object({});
export type SquaresSettings = z.infer<typeof squaresSettingsSchema>;
