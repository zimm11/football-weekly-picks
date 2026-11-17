import { leagues, seasons } from "@picks/db";
import {
  defaultPoints,
  estimatedWeekStart,
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
 * - draft and open, in one step: on Tuesday 9 AM Eastern of the week (`weeklyOpensAt`) the next week is created,
 *   its slate and lines are drawn from the feed, and it opens for picks. Nothing is imported earlier, so the
 *   lines players pick against are that Tuesday's, not ones from days before. A week whose games have all kicked
 *   off already is skipped, so a league switched to Automatic mid-season catches up instead of replaying it;
 * - a game without a line keeps the week a draft: it opens as soon as the line arrives or is typed in, and the
 *   admins are told once if it is still missing 24 hours before the first kickoff;
 * - sync: kickoffs follow the feed and final scores fill in, never over a typed one;
 * - finalize: once every game has a result, usually Monday night.
 * Hands-on leagues (`management` manual) are never due, and advance does nothing.
 *
 * The season automation runs is the league's latest season with weeks (Start season creates it with its start
 * week, an empty draft until that week's Tuesday), through Week 18. Switching a hands-on league to Automatic
 * picks its weeks up as they stand: a draft that already has games keeps them and opens on its Tuesday.
 */

/** How far ahead of its first kickoff a draft starts being looked at (it opens on the Tuesday before). */
const DRAFT_HORIZON_MS = 7 * 24 * 60 * 60_000;

/** The latest week of `year` whose estimated start is within the draft horizon at `now`; 0 before Week 1's. */
function weeksInHorizon(year: number, now: Date): number {
  let through = 0;
  for (let number = 1; number <= REGULAR_SEASON_WEEKS; number++) {
    if (estimatedWeekStart(year, number).getTime() - DRAFT_HORIZON_MS <= now.getTime()) through = number;
  }
  return through;
}

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
    const year = seasonYear(now);
    // The most recent Tuesday 9 AM Eastern: a week that had begun before it has had its opening time since.
    const lastOpening = weeklyOpensAt(now);
    // Only leagues with something to do: a draft near its week (an empty one by the calendar, since it has no
    // kickoffs to go by), an open week with a game whose result may be in or with every result in, or a final
    // latest week whose next week's Tuesday has come.
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
              and s.year >= ${year}
              and s.year = (
                select max(s2.year) from ${seasons} s2
                where s2.league_id = ${leagues.id} and exists (select 1 from weeks w2 where w2.season_id = s2.id)
              )
              and (
                (w.status = 'draft' and (
                  (s.year = ${year} and w.number <= ${weeksInHorizon(year, now)}
                    and not exists (select 1 from games g where g.week_id = w.id))
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
                  and w.number = (select max(w3.number) from weeks w3 where w3.season_id = s.id)
                  and exists (
                    select 1 from games g where g.week_id = w.id and g.kickoff < ${lastOpening.toISOString()}::timestamptz
                  ))
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
      // Drafted and opened together on its Tuesday: until then the week doesn't exist.
      const opens = WEEKLY_PLAN.opensAt(number, provided);
      if (opens && ctx.now < opens) break;
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
