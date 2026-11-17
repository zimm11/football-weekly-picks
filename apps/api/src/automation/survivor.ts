import { type LeagueTypeAutomation, NOTHING_DONE } from "./types";

/*
 * Survivor: import the start week when the season is created, open each week as soon as it is imported,
 * follow flexed kickoffs and fill in results, finalize when every game has one, then prepare the next week or end
 * the pool.
 *
 * Stub: nothing is due yet. Replace with the real steps.
 */
export const survivorAutomation: LeagueTypeAutomation = {
  async due() {
    return [];
  },
  async advance() {
    return NOTHING_DONE;
  },
};
