import { games, leagues, seasons, weeks } from "@picks/db";
import {
  hasResult,
  isPostseasonWeek,
  POSTSEASON_GAME_COUNTS,
  readSeasonSettings,
  seasonYear,
  weekLabel,
} from "@picks/shared";
import { and, asc, desc, eq, exists, gte, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { queueLeagueEvent } from "../leagueEvents";
import { loadSurvivorSeason, recordSurvivorParticipants } from "../survivor";
import { gamesOf, importSlate, SHORTEST_GAME_MS, writeFinals } from "../weekOps";
import type { AutomatedLeague, AutomationContext, LeagueTypeAutomation } from "./types";

/*
 * Survivor runs itself from the feed:
 * - prepare: the start week is created when the season starts (survivor.ts), and each later week once the one
 *   before is final, unless the pool is over;
 * - import and open: a week with no games is filled from the feed and opens at once (there are no spreads to
 *   wait for). A postseason week waits until the feed lists every game of the round. A week that has games is
 *   never imported again, so a game an admin removed stays removed;
 * - sync: while a week is open, kickoffs follow the feed (flexed games) and final scores fill in, never over a
 *   typed one;
 * - finalize: when every game has a result, the week is final, its players are recorded, and the next week is
 *   prepared or the pool ends. League events: the week final, or the pool over.
 * Every step takes the week row lock and checks again under it, so the cron and a player's read can run at once,
 * and running twice leaves the same state.
 */

type Week = typeof weeks.$inferSelect;
type Season = typeof seasons.$inferSelect;
type Steps = { steps: number; emails: number; pushes: number };

const add = (into: Steps, more: Partial<Steps>) => {
  into.steps += more.steps ?? 0;
  into.emails += more.emails ?? 0;
  into.pushes += more.pushes ?? 0;
};

export const survivorAutomation: LeagueTypeAutomation = {
  /**
   * Survivor leagues with a week to import (a draft), a result due (a game under way long enough to be over with
   * no score), or a week to finalize (every game has a result), this NFL season. A finished pool has none.
   */
  async due(ctx, limit) {
    const { db, now } = ctx;
    const awaiting = new Date(now.getTime() - SHORTEST_GAME_MS);
    const thisSeason = and(
      eq(seasons.leagueId, leagues.id),
      gte(seasons.year, seasonYear(now)),
      eq(weeks.seasonId, seasons.id),
    );
    const weekDue = or(
      eq(weeks.status, "draft"),
      and(
        eq(weeks.status, "open"),
        or(
          exists(
            db
              .select({ one: sql`1` })
              .from(games)
              .where(and(eq(games.weekId, weeks.id), isNull(games.homeScore), lte(games.kickoff, awaiting))),
          ),
          notExists(
            db
              .select({ one: sql`1` })
              .from(games)
              .where(and(eq(games.weekId, weeks.id), isNull(games.homeScore))),
          ),
        ),
      ),
    );
    return db
      .select()
      .from(leagues)
      .where(
        and(
          eq(leagues.type, "survivor"),
          exists(
            db
              .select({ one: sql`1` })
              .from(weeks)
              .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
              .where(and(thisSeason, weekDue)),
          ),
        ),
      )
      .orderBy(asc(leagues.id))
      .limit(limit);
  },

  async advance(ctx, league) {
    const [season] = await ctx.db
      .select()
      .from(seasons)
      .where(eq(seasons.leagueId, league.id))
      .orderBy(desc(seasons.year))
      .limit(1);
    if (!season || !readSeasonSettings("survivor", season.settings).startWeek) {
      return { steps: 0, emails: 0, pushes: 0 };
    }
    const done: Steps = { steps: 0, emails: 0, pushes: 0 };
    const weekRows = await ctx.db
      .select()
      .from(weeks)
      .where(eq(weeks.seasonId, season.id))
      .orderBy(asc(weeks.number));
    for (const week of weekRows.filter((w) => w.status === "open")) {
      add(done, await syncWeek(ctx, league, season, week));
    }
    add(done, await prepareNextWeek(ctx, league, season));
    const drafts = await ctx.db
      .select()
      .from(weeks)
      .where(and(eq(weeks.seasonId, season.id), eq(weeks.status, "draft")))
      .orderBy(asc(weeks.number));
    for (const week of drafts) add(done, await importWeek(ctx, season, week));
    return done;
  },
};

/** Fills an empty week from the feed and opens it. */
async function importWeek(ctx: AutomationContext, season: Season, week: Week): Promise<Partial<Steps>> {
  const provided = await ctx.results(season.year, week.number, ctx.requestId);
  if (!provided?.length) return {};
  if (isPostseasonWeek(week.number) && provided.length < (POSTSEASON_GAME_COUNTS[week.number] ?? 1))
    return {};
  return ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(weeks).where(eq(weeks.id, week.id)).for("update");
    if (locked?.status !== "draft") return {};
    // A week that already has games is opened as it stands, never imported again.
    if (!(await gamesOf(tx, week.id)).length) {
      const error = await importSlate(
        tx,
        { getWeek: async () => provided },
        { id: week.id, year: season.year, number: week.number },
        { requestId: ctx.requestId, keepAdminSpreads: true },
      );
      if (error) return {};
    }
    await tx.update(weeks).set({ status: "open" }).where(eq(weeks.id, week.id));
    return { steps: 1 };
  });
}

/** Follows flexed kickoffs and fills in final scores; finalizes the week once every game has one. */
async function syncWeek(
  ctx: AutomationContext,
  league: AutomatedLeague,
  season: Season,
  week: Week,
): Promise<Partial<Steps>> {
  const before = await gamesOf(ctx.db, week.id);
  if (!before.length) return {};
  const provided = before.some((g) => g.externalId && !hasResult(g))
    ? await ctx.results(season.year, week.number, ctx.requestId)
    : null;
  return ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(weeks).where(eq(weeks.id, week.id)).for("update");
    if (locked?.status !== "open") return {};
    let steps = 0;
    const current = await gamesOf(tx, week.id);
    if (provided) {
      const feed = new Map(provided.map((g) => [g.externalId, g]));
      for (const game of current) {
        const listed = game.externalId ? feed.get(game.externalId) : undefined;
        if (!listed || hasResult(game) || listed.kickoff.getTime() === game.kickoff.getTime()) continue;
        await tx.update(games).set({ kickoff: listed.kickoff }).where(eq(games.id, game.id));
        steps++;
      }
      const missing = current.filter((g) => !hasResult(g)).length;
      await writeFinals(tx, current, provided, { overwrite: false });
      const after = await gamesOf(tx, week.id);
      steps += missing - after.filter((g) => !hasResult(g)).length;
    }
    const slate = await gamesOf(tx, week.id);
    // An empty slate is never "all done": the week waits for its games.
    if (!slate.length || !slate.every(hasResult)) return { steps };
    const queued = await finalizeSurvivorWeek(ctx, tx, league, season, locked);
    return { steps: steps + 1, ...queued };
  });
}

/**
 * Closes a week whose games all have results: final, its players recorded, then the next week prepared or the
 * pool over. Queues one league event: the week final, or the pool over when it ended this week.
 */
async function finalizeSurvivorWeek(
  ctx: AutomationContext,
  tx: Parameters<Parameters<AutomationContext["db"]["transaction"]>[0]>[0],
  league: AutomatedLeague,
  season: Season,
  week: Week,
) {
  const at = ctx.now;
  await tx.update(weeks).set({ status: "final", finalizedAt: at }).where(eq(weeks.id, week.id));
  const data = await loadSurvivorSeason(tx, league.id, season.year);
  const final = data?.weeks.find((w) => w.id === week.id);
  if (!data?.status || !final) return {};
  await recordSurvivorParticipants(tx, data, final);
  const label = weekLabel(week.number);
  if (data.status.over) {
    return queueLeagueEvent(
      tx,
      ctx.notify,
      {
        leagueId: league.id,
        event: `pool-over:${season.id}:${week.number}`,
        headline: "The survivor pool is over",
        detail: `${label} was the last week of the pool in ${league.name}. See how it finished.`,
        path: `/leagues/${league.id}/standings`,
        actionLabel: "See the standings",
        weekId: week.id,
      },
      at,
    );
  }
  if (data.status.nextWeek) {
    await tx
      .insert(weeks)
      .values({ seasonId: season.id, number: data.status.nextWeek })
      .onConflictDoNothing();
  }
  return queueLeagueEvent(
    tx,
    ctx.notify,
    {
      leagueId: league.id,
      event: `week-final:${week.id}`,
      headline: `${label} is final`,
      detail: `${label} is final in ${league.name}. See who's still in.`,
      path: `/leagues/${league.id}/standings`,
      actionLabel: "See the standings",
      weekId: week.id,
    },
    at,
  );
}

/**
 * Creates the week the pool plays next when it is missing: after a correction brings a player back into a pool
 * that had ended, or if a finalize ever left it out. Idempotent: the week's key is (season, number).
 */
async function prepareNextWeek(
  ctx: AutomationContext,
  league: AutomatedLeague,
  season: Season,
): Promise<Partial<Steps>> {
  const data = await loadSurvivorSeason(ctx.db, league.id, season.year);
  const next = data?.status?.nextWeek;
  if (!data || !next || data.weeks.some((w) => w.number === next)) return {};
  // The week before must be final (or this is the start week), so the pool never runs ahead of itself.
  if (next !== data.settings.startWeek && data.weeks.find((w) => w.number === next - 1)?.status !== "final") {
    return {};
  }
  const inserted = await ctx.db
    .insert(weeks)
    .values({ seasonId: season.id, number: next })
    .onConflictDoNothing()
    .returning({ id: weeks.id });
  return { steps: inserted.length };
}
