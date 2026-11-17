import { type LeagueTypeAutomation, NOTHING_DONE } from "./types";

/*
 * Weekly pick'em, Automatic management: prepare the next week once the one before is final, open it
 * Tuesday 9 AM ET once every game has a line, fill in results, finalize after the last game. Hands-on leagues
 * (`management` manual) are never due and advance does nothing.
 *
 * Stub: nothing is due yet. Replace with the real steps.
 */
export const weeklyAutomation: LeagueTypeAutomation = {
  async due() {
    return [];
  },
  async advance() {
    return NOTHING_DONE;
  },
};
