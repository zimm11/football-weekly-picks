import { leagues, seasons } from "@picks/db";
import {
  PLAYOFF_ROUND_GAMES,
  roundPoints,
  SUPER_BOWL_ROUND,
  seasonYear,
  WILD_CARD_ROUND,
  weekLabel,
  wildCardPollingStarts,
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
import { type LeagueTypeAutomation, NOTHING_DONE } from "./types";

/*
 * Playoff pick'em: create each round once the feed lists all its games with real teams (the Wild Card round once
 * the regular season's Week 18 is under way, `wildCardPollingStarts`; the rest after the round before is final),
 * open it as soon as every game has a spread (spreads freeze then), fill in results, finalize when every game has
 * one, then prepare the next round. The admin's Import, Open and Finalize on /weeks/:id/manage stay as the
 * fallback when the feed fails.
 */

/** "The Wild Card round", "The Super Bowl". */
export const roundName = (n: number) =>
  n === SUPER_BOWL_ROUND ? "The Super Bowl" : `The ${weekLabel(n)} round`;

export const PLAYOFF_PLAN: PickemPlan = {
  pointsFor: (n) => () => roundPoints(n),
  opensAt: () => null,
  openHeadline: (n) => `${roundName(n)} is open for picks`,
  finalHeadline: (n) => `${roundName(n)} is final`,
  missingLineHeadline: (n) => `${roundName(n)} needs a line`,
};

export const playoffAutomation: LeagueTypeAutomation = {
  async due(ctx, limit) {
    const now = ctx.now;
    const year = seasonYear(now);
    const awaiting = new Date(now.getTime() - SHORTEST_GAME_MS);
    const polling = now >= wildCardPollingStarts(year);
    return ctx.db
      .select()
      .from(leagues)
      .where(
        and(
          eq(leagues.type, "playoff"),
          sql`exists (
            select 1 from ${seasons} s
            where s.league_id = ${leagues.id}
              and s.year >= ${year}
              and s.year = (select max(s2.year) from ${seasons} s2 where s2.league_id = ${leagues.id})
              and (
                (${polling ? sql`true` : sql`false`} and s.year = ${year} and not exists (select 1 from weeks w where w.season_id = s.id))
                or exists (select 1 from weeks w where w.season_id = s.id and w.status = 'draft')
                or exists (
                  select 1 from weeks w where w.season_id = s.id and w.status = 'open' and (
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
                  )
                )
                or exists (
                  select 1 from weeks w where w.season_id = s.id and w.status = 'final' and w.number < ${SUPER_BOWL_ROUND}
                    and w.number = (select max(w3.number) from weeks w3 where w3.season_id = s.id)
                    and not exists (select 1 from weeks w4 where w4.season_id = s.id and w4.status <> 'final')
                )
              )
          )`,
        ),
      )
      .orderBy(sql`random()`)
      .limit(limit);
  },

  async advance(ctx, league) {
    const [current] = await ctx.db.select().from(leagues).where(eq(leagues.id, league.id));
    if (current?.type !== "playoff") return NOTHING_DONE;
    const [season] = await seasonsOf(ctx, current.id);
    if (!season || season.year < seasonYear(ctx.now)) return NOTHING_DONE;
    let result = await advanceWeeks(ctx, current, season, PLAYOFF_PLAN);

    const rounds = await weeksOf(ctx, season.id);
    if (rounds.some((w) => w.status !== "final")) return result;
    const latest = rounds.length ? Math.max(...rounds.map((w) => w.number)) : null;
    // Before the regular season's last week, the Wild Card round can't be listed: don't ask.
    if (latest === null && ctx.now < wildCardPollingStarts(season.year)) return result;
    for (let number = (latest ?? WILD_CARD_ROUND - 1) + 1; number <= SUPER_BOWL_ROUND; number++) {
      const provided = await ctx.results(season.year, number, ctx.requestId);
      // The round is created once the feed lists all its games with real teams.
      if (!provided || provided.length < (PLAYOFF_ROUND_GAMES[number] ?? 1)) break;
      // A round already played (the league started late, or the feed was down): nobody can pick it.
      if (allKickedOff(provided, ctx.now)) continue;
      const round = await prepareWeek(ctx, season, number, provided, PLAYOFF_PLAN);
      if (round) {
        result = addResults(result, { steps: 1 });
        result = addResults(result, await advanceDraft(ctx, current, season, round, PLAYOFF_PLAN));
      }
      break;
    }
    return result;
  },
};
