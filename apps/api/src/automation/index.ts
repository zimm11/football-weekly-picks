// Leagues that run themselves. `advanceLeagues` is the scheduled entry (runScheduledJobs, every five minutes);
// `advanceLeague` moves one league along, and is what `advanceLeagueOnRead` (services.ts) runs when a player
// reads a league. Each league type brings its own steps (`LeagueTypeAutomation`) in its own file here.

import { LEAGUE_TYPES, type LeagueType } from "@picks/shared";
import { logError } from "../logging";
import { playoffAutomation } from "./playoff";
import { squaresAutomation } from "./squares";
import { survivorAutomation } from "./survivor";
import type { AdvanceResult, AutomatedLeague, AutomationContext, LeagueTypeAutomation } from "./types";
import { NOTHING_DONE } from "./types";
import { weeklyAutomation } from "./weekly";

export type { AdvanceResult, AutomatedLeague, AutomationContext, LeagueTypeAutomation } from "./types";
export { NOTHING_DONE } from "./types";

export const AUTOMATION: Record<LeagueType, LeagueTypeAutomation> = {
  weekly: weeklyAutomation,
  playoff: playoffAutomation,
  squares: squaresAutomation,
  survivor: survivorAutomation,
};

/** Leagues advanced per type per scheduled run at most. What is left over follows on the next run. */
export const AUTOMATION_BATCH = 25;

/** The due query's limit for a run scoped to `onlyLeagues`: effectively none, on a local database. */
const SCOPED_RUN_LIMIT = 100_000;

/** One league, by its type's steps. A hands-on weekly league is left alone. */
export async function advanceLeague(ctx: AutomationContext, league: AutomatedLeague): Promise<AdvanceResult> {
  if (league.type === "weekly" && league.management === "manual") return NOTHING_DONE;
  return AUTOMATION[league.type].advance(ctx, league);
}

export type AutomationRun = {
  leagues: number;
  steps: number;
  failed: number;
  emails: number;
  pushes: number;
};

/**
 * The scheduled automation: for each type, the leagues with something due (a bounded batch), each advanced on
 * its own. A failure is caught per league (and per type's due query) and logged with a fixed code, so one league
 * never holds up the rest, and automation never holds up email or push.
 */
export async function advanceLeagues(ctx: AutomationContext): Promise<AutomationRun> {
  const run: AutomationRun = { leagues: 0, steps: 0, failed: 0, emails: 0, pushes: 0 };
  for (const type of LEAGUE_TYPES) {
    let due: AutomatedLeague[];
    try {
      const only = ctx.onlyLeagues;
      // A scoped run (the E2E harness) asks for everything due and keeps its own leagues.
      due = only
        ? (await AUTOMATION[type].due(ctx, SCOPED_RUN_LIMIT)).filter((league) => only.has(league.id))
        : await AUTOMATION[type].due(ctx, AUTOMATION_BATCH);
    } catch (error) {
      logError("automation_due", error, ctx.requestId);
      run.failed++;
      continue;
    }
    for (const league of due) {
      try {
        const result = await advanceLeague(ctx, league);
        run.leagues++;
        run.steps += result.steps;
        run.emails += result.emails;
        run.pushes += result.pushes;
      } catch (error) {
        logError("automation_league", error, ctx.requestId);
        run.failed++;
      }
    }
  }
  return run;
}
