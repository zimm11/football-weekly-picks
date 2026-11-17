import { seasons, weeks } from "@picks/db";
import type { WeeklySettings } from "@picks/shared";
import { and, eq } from "drizzle-orm";
import { fail } from "./context";
import type { LeagueTypeHooks } from "./typeHooks";

/*
 * Weekly pick'em's own hooks. Its routes are the shared week routes (weeks.ts); its automation is
 * automation/weekly.ts.
 */

export const weeklyHooks: LeagueTypeHooks = {
  /**
   * Start season, for an Automatic league: the season with its start week as an empty draft. Automation imports
   * the week from the feed, opens it on its Tuesday and runs the season through Week 18. A hands-on league keeps
   * its own flow (a season is created with its first week, by Create week).
   */
  async startSeason(tx, { league, year, settings }) {
    if (league.management !== "auto") {
      fail(409, "A hands-on league starts its season by setting up its first week.");
    }
    const parsed = settings as WeeklySettings;
    const { startWeek } = parsed;
    if (!startWeek) fail(400, "Choose the week the season starts with.");
    await tx.insert(seasons).values({ leagueId: league.id, year, settings: parsed }).onConflictDoNothing();
    const [season] = await tx
      .select()
      .from(seasons)
      .where(and(eq(seasons.leagueId, league.id), eq(seasons.year, year)));
    if (!season) throw new Error("Season upsert returned no row");
    const [started] = await tx
      .select({ id: weeks.id })
      .from(weeks)
      .where(eq(weeks.seasonId, season.id))
      .limit(1);
    if (started) fail(409, "This season has already started.");
    await tx.update(seasons).set({ settings: parsed }).where(eq(seasons.id, season.id));
    await tx.insert(weeks).values({ seasonId: season.id, number: startWeek });
  },
};
