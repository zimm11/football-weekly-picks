import { Hono } from "hono";
import { type AuthVariables, requireAuth } from "./auth";
import {
  type AppDeps,
  boardParam,
  fail,
  leagueParam,
  requireBoard,
  requireLeagueType,
  requireMember,
} from "./context";
import type { AppServices } from "./services";
import type { LeagueTypeHooks } from "./typeHooks";

/*
 * Squares' own routes: boards, claims, the lock and draw, and score corrections. League routes check the league's
 * type first (`requireLeagueType`); board routes go through `requireBoard`, which also holds them to squares
 * leagues and current members.
 */

export const squaresHooks: LeagueTypeHooks = {
  // To do (squares): give back the player's squares on this league's boards that haven't been drawn.
};

export function squaresRoutes({ db, verifyToken }: AppDeps, _services: AppServices) {
  const auth = requireAuth(verifyToken);
  // Keep routes chained, or `ApiType` loses their types.
  return (
    new Hono<{ Variables: AuthVariables }>()
      /** Placeholder: the league's boards. */
      .get("/leagues/:leagueId/boards", auth, leagueParam, async (c) => {
        const { league } = await requireMember(db, c.req.valid("param").leagueId, c.var.user.id);
        requireLeagueType(league, "squares");
        return c.json([] as { id: string }[]);
      })
      /** Placeholder: one board. */
      .get("/boards/:boardId", auth, boardParam, async (c) => {
        await requireBoard(db, c.req.valid("param").boardId, c.var.user.id);
        fail(404, "Not found");
      })
  );
}
