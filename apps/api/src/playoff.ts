import { Hono } from "hono";
import { type AuthVariables, requireAuth } from "./auth";
import { type AppDeps, fail, leagueParam, requireLeagueType, requireMember } from "./context";
import type { AppServices } from "./services";
import type { LeagueTypeHooks } from "./typeHooks";

/*
 * Playoff pick'em's own routes. The pick sheet, week management and results are the shared week routes in
 * weeks.ts, which accept playoff leagues; what only playoff leagues have goes here. Every route checks the
 * league's type first (`requireLeagueType`), so another type's league answers 404.
 */

export const playoffHooks: LeagueTypeHooks = {};

export function playoffRoutes({ db, verifyToken }: AppDeps, _services: AppServices) {
  const auth = requireAuth(verifyToken);
  // Keep routes chained, or `ApiType` loses their types.
  return (
    new Hono<{ Variables: AuthVariables }>()
      /** Placeholder: the overall table and each player's status. */
      .get("/leagues/:leagueId/playoff/standings", auth, leagueParam, async (c) => {
        const { league } = await requireMember(db, c.req.valid("param").leagueId, c.var.user.id);
        requireLeagueType(league, "playoff");
        fail(404, "Not found");
      })
  );
}
