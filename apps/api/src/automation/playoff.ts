import { type LeagueTypeAutomation, NOTHING_DONE } from "./types";

/*
 * Playoff pick'em: create each round once the feed lists its games with real teams, open it when every
 * game has a spread, fill in results, finalize when every game has one, then prepare the next round.
 *
 * Stub: nothing is due yet. Replace with the real steps.
 */
export const playoffAutomation: LeagueTypeAutomation = {
  async due() {
    return [];
  },
  async advance() {
    return NOTHING_DONE;
  },
};
