import { type LeagueTabId, type LeagueType, leagueTabFromPath, leagueTabPath } from "@picks/shared";

/*
 * A league's tabs are the routes of its tab navigator (`app/leagues/[id]/_layout.tsx`), named after their files:
 * "index" (the type's first tab), "results/index", "standings/index", "messages" (the Messages stack) and
 * "league/index". Every type has the same routes; a route its type has no tab for shows the not-found screen.
 */

/** The tab navigator's route for a tab: "index" for the type's first tab, "messages" (a stack), "results/index"… */
export function tabRouteName(type: LeagueType, tab: LeagueTabId): string {
  const path = leagueTabPath(type, tab);
  if (!path) return "index";
  return path === "messages" ? "messages" : `${path}/index`;
}

/** The tab a tab-navigator route shows for this type, or null when the type has no such tab. */
export function tabOfRoute(type: LeagueType, routeName: string): LeagueTabId | null {
  const segment = routeName === "index" ? "" : routeName.replace(/\/index$/, "");
  return leagueTabFromPath(type, segment);
}
