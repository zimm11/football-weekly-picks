import { z } from "zod";

/*
 * Survivor: each week every player still alive picks one team to win outright; a loss is a strike and no team
 * can be used twice. Its rules go here as pure functions (checkSurvivorPick, survivorStatus). Nobody's status is
 * stored: it is worked out from the final weeks, so a corrected score re-derives everything.
 */

/** The most lives an admin can give a survivor pool. */
export const MAX_SURVIVOR_LIVES = 3;

/**
 * A survivor season's settings (`seasons.settings`). Both are fixed once the start week's first game kicks off.
 * `startWeek` absent means the next week with no kickoff yet, worked out when the season starts.
 */
export const survivorSettingsSchema = z.object({
  lives: z.int().min(1).max(MAX_SURVIVOR_LIVES).default(1),
  startWeek: z.int().min(1).max(18).optional(),
});
export type SurvivorSettings = z.infer<typeof survivorSettingsSchema>;
