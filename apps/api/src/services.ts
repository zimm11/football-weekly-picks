import type { leagues } from "@picks/db";
import { type AdvanceResult, type AutomationContext, advanceLeague } from "./automation";
import type { AppDeps } from "./context";
import { deliverLeagueEventsSoon } from "./leagueEvents";
import { logError } from "./logging";
import { type ProviderWeeks, providerWeeks } from "./weekOps";

/** How often one league is advanced on read at most, however many players are looking. */
export const ADVANCE_ON_READ_MS = 60_000;

/**
 * What the route modules share within one app instance (one Worker isolate): the provider's weeks behind the
 * results throttle, and automation on read. Built once by `createApp` and handed to each route module.
 */
export type AppServices = {
  /** The provider's view of an NFL week, at most once a minute per week, shared by every league reading it. */
  results: ProviderWeeks;
  /**
   * Takes a league that runs itself one step further when a player reads it (its league, week, survivor or board
   * screen), at most once a minute per league, so nobody waits for the cron to see a final score. Hands-on weekly
   * leagues do nothing. Never throws: a failure is logged and the read goes on. `force` skips the throttle, for
   * an admin's change that automation should act on at once (Start season, a line typed in, a score corrected).
   */
  advanceLeagueOnRead(
    league: typeof leagues.$inferSelect,
    requestId?: string,
    options?: { force?: boolean },
  ): Promise<void>;
};

export function createServices(deps: AppDeps): AppServices {
  const now = deps.now ?? (() => new Date());
  const results = providerWeeks(deps.nfl, now);
  // Settled values only (a timestamp per league), never a promise another request would wait on.
  const lastRun = new Map<string, number>();
  return {
    results,
    async advanceLeagueOnRead(league, requestId, options) {
      if (league.type === "weekly" && league.management === "manual") return;
      const at = now();
      const last = lastRun.get(league.id);
      const throttled =
        last !== undefined && at.getTime() >= last && at.getTime() - last < ADVANCE_ON_READ_MS;
      if (throttled && !options?.force) return;
      if (lastRun.size > 10_000) lastRun.clear();
      lastRun.set(league.id, at.getTime());
      const ctx: AutomationContext = {
        db: deps.db,
        nfl: deps.nfl,
        now: at,
        results,
        notify: { email: deps.email, push: deps.push, nativePush: deps.nativePush },
        requestId,
      };
      let result: AdvanceResult;
      try {
        result = await advanceLeague(ctx, league);
      } catch (error) {
        logError("automation_league", error, requestId);
        return;
      }
      deliverLeagueEventsSoon(deps, result, at);
    },
  };
}
