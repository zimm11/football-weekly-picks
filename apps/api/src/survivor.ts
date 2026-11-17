import { Hono } from "hono";
import { type AuthVariables, requireAuth } from "./auth";
import { type AppDeps, fail, leagueParam, requireLeagueType, requireMember } from "./context";
import type { AppServices } from "./services";
import type { LeagueTypeHooks } from "./typeHooks";

/*
 * Survivor's own routes: the season (statuses, the grid of revealed picks, the current week) and saving a pick.
 * Every route checks the league's type first (`requireLeagueType`), so another type's league answers 404. Week
 * chores (import, open, results, finalize) are the shared operations in weekOps.ts.
 */

export const survivorHooks: LeagueTypeHooks = {};

export function survivorRoutes({ db, verifyToken }: AppDeps, _services: AppServices) {
  const auth = requireAuth(verifyToken);
  // Keep routes chained, or `ApiType` loses their types.
  return (
    new Hono<{ Variables: AuthVariables }>()
      /** Placeholder: the season's statuses, the grid of revealed picks and the current week. */
      .get("/leagues/:leagueId/survivor", auth, leagueParam, async (c) => {
        const { league } = await requireMember(db, c.req.valid("param").leagueId, c.var.user.id);
        requireLeagueType(league, "survivor");
        fail(404, "Not found");
      })
  );
}
