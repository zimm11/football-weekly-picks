import { leagues, seasons } from "@picks/db";
import {
  defaultPoints,
  firstKickoff,
  REGULAR_SEASON_WEEKS,
  seasonYear,
  weekLabel,
  weeklyOpensAt,
} from "@picks/shared";
import { and, eq, sql } from "drizzle-orm";
import { SHORTEST_GAME_MS } from "../weekOps";
import {
  addResults,
  advanceDraft,
  advanceWeeks,
  allKickedOff,
  type PickemPlan,
  prepareWeek,
  seasonsOf,
  weeksOf,
} from "./pickem";
import { type AutomationContext, type LeagueTypeAutomation, NOTHING_DONE } from "./types";

/*
 * Weekly pick'em, Automatic management:
 * - prepare: import the next week from the feed once the one before is final (a week whose games have all kicked
 *   off already is skipped, so a league switched to Automatic mid-season catches up instead of replaying it);
 * - open: Tuesday 9 AM Eastern, once every game has a line; spreads freeze then;
 * - sync: fill in final scores, never over a typed one;
 * - finalize: once every game has a result, usually Monday night.
 * A line still missing 24 hours before the first kickoff is reported to the admins once, and the week opens as
 * soon as it is typed in. Hands-on leagues (`management` manual) are never due, and advance does nothing.
 *
 * The season automation runs is the league's latest season with weeks (Start season creates it with its start
 * week), through Week 18. Switching a hands-on league to Automatic picks its weeks up as they stand.
 */

/** How far ahead of its first kickoff a draft starts being looked at (it opens on the Tuesday before). */
const DRAFT_HORIZON_MS = 7 * 24 * 60 * 60_000;

export const WEEKLY_PLAN: PickemPlan = {
  pointsFor: () => defaultPoints,
  opensAt: (_number, games) => {
    const first = firstKickoff(games);
    return first && weeklyOpensAt(first);
  },
  openHeadline: (n) => `${weekLabel(n)} is open for picks`,
  finalHeadline: (n) => `${weekLabel(n)} is final`,
  missingLineHeadline: (n) => `${weekLabel(n)} needs a line`,
};

/** The season automation runs: the latest with weeks, if it is this NFL season (or a later one). */
async function automatedSeason(ctx: AutomationContext, leagueId: string) {
  for (const season of await seasonsOf(ctx, leagueId)) {
    const rows = await weeksOf(ctx, season.id);
    if (rows.length) return season.year >= seasonYear(ctx.now) ? { season, weeks: rows } : null;
  }
  return null;
}

export const weeklyAutomation: LeagueTypeAutomation = {
  async due(ctx, limit) {
    const now = ctx.now;
    const awaiting = new Date(now.getTime() - SHORTEST_GAME_MS);
    const horizon = new Date(now.getTime() + DRAFT_HORIZON_MS);
    // Only leagues with something to do: a draft near its week (or still without games), an open week with a
    // game whose result may be in or with every result in, or a final latest week with another to prepare.
    return (
      ctx.db
        .select()
        .from(leagues)
        .where(
          and(
            eq(leagues.type, "weekly"),
            eq(leagues.management, "auto"),
            sql`exists (
            select 1 from ${seasons} s join weeks w on w.season_id = s.id
            where s.league_id = ${leagues.id}
              and s.year >= ${seasonYear(now)}
              and s.year = (
                select max(s2.year) from ${seasons} s2
                where s2.league_id = ${leagues.id} and exists (select 1 from weeks w2 where w2.season_id = s2.id)
              )
              and (
                (w.status = 'draft' and (
                  not exists (select 1 from games g where g.week_id = w.id)
                  or exists (select 1 from games g where g.week_id = w.id and g.kickoff < ${horizon.toISOString()}::timestamptz)
                ))
                or (w.status = 'open' and (
                  exists (
                    select 1 from games g where g.week_id = w.id and g.external_id is not null
                      and g.home_score is null and g.kickoff <= ${awaiting.toISOString()}::timestamptz
                  )
                  or (
                    exists (select 1 from games g where g.week_id = w.id)
                    and not exists (
                      select 1 from games g where g.week_id = w.id and (g.home_score is null or g.away_score is null)
                    )
                  )
                ))
                or (w.status = 'final' and w.number < ${REGULAR_SEASON_WEEKS}
                  and w.number = (select max(w3.number) from weeks w3 where w3.season_id = s.id))
              )
          )`,
          ),
        )
        // A different order each run, so leagues waiting on nothing can't hold the batch from the rest.
        .orderBy(sql`random()`)
        .limit(limit)
    );
  },

  async advance(ctx, league) {
    // Re-read: the admin may have switched to hands-on since the league was picked up.
    const [current] = await ctx.db.select().from(leagues).where(eq(leagues.id, league.id));
    if (current?.type !== "weekly" || current.management !== "auto") return NOTHING_DONE;
    const found = await automatedSeason(ctx, current.id);
    if (!found) return NOTHING_DONE;
    const { season } = found;
    let result = await advanceWeeks(ctx, current, season, WEEKLY_PLAN);

    const rows = await weeksOf(ctx, season.id);
    if (rows.some((w) => w.status !== "final")) return result;
    const latest = Math.max(...rows.map((w) => w.number));
    for (let number = latest + 1; number <= REGULAR_SEASON_WEEKS; number++) {
      const provided = await ctx.results(season.year, number, ctx.requestId);
      // Not reachable or not scheduled yet: try again next run.
      if (!provided?.length) break;
      if (allKickedOff(provided, ctx.now)) continue;
      const week = await prepareWeek(ctx, season, number, provided, WEEKLY_PLAN);
      if (week) {
        result = addResults(result, { steps: 1 });
        result = addResults(result, await advanceDraft(ctx, current, season, week, WEEKLY_PLAN));
      }
      break;
    }
    return result;
  },
};
