// The week steps automatic pick'em leagues share: Automatic weekly pick'em (weekly.ts) and Playoff pick'em
// (playoff.ts) run the same prepare, open, sync and finalize; what differs (when a week opens, what a game is
// worth, which week comes next, what the notifications say) is the type's `PickemPlan`.
//
// Every step is idempotent and takes the week row lock (`for update`) before it changes anything, rechecking the
// week's status under it, so the cron and a player's read can run the same step at once and running it twice leaves
// the same state. The feed is read before the transaction, through `ctx.results` (once per NFL week per run), so
// no lock is held while waiting on the network. Notifications are queued in the step's transaction.

import { leagueMembers, seasons, weeks } from "@picks/db";
import { firstKickoff, hasResult, missingLineDue } from "@picks/shared";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { queueLeagueEvent } from "../leagueEvents";
import type { NflProvider, ProviderGame } from "../nfl";
import {
  awaitingResult,
  finalizeProblem,
  finalizeWeek,
  type GameRow,
  gamesOf,
  importSlate,
  openProblem,
  openWeek,
  type PointsFor,
  writeFinals,
} from "../weekOps";
import { type AdvanceResult, type AutomatedLeague, type AutomationContext, NOTHING_DONE } from "./types";

export type WeekRow = typeof weeks.$inferSelect;
export type SeasonRow = typeof seasons.$inferSelect;

/** What a pick'em type decides for its own weeks. */
export type PickemPlan = {
  /** A new game's points in week `number`. */
  pointsFor(number: number): PointsFor;
  /** When a draft whose every game has a line may open. Null: as soon as every line is in. */
  opensAt(number: number, games: GameRow[]): Date | null;
  /** League event headlines. Never a pick, a team, or whether the reader is in or out. */
  openHeadline(number: number): string;
  finalHeadline(number: number): string;
  missingLineHeadline(number: number): string;
};

export const addResults = (a: AdvanceResult, b: Partial<AdvanceResult>): AdvanceResult => ({
  steps: a.steps + (b.steps ?? 0),
  emails: a.emails + (b.emails ?? 0),
  pushes: a.pushes + (b.pushes ?? 0),
});

/** A provider that answers with games already fetched, so an import inside a transaction asks the feed nothing. */
const fedBy = (provided: ProviderGame[]): NflProvider => ({ getWeek: async () => provided });

/** A league's seasons, newest first. */
export const seasonsOf = (ctx: AutomationContext, leagueId: string) =>
  ctx.db.select().from(seasons).where(eq(seasons.leagueId, leagueId)).orderBy(desc(seasons.year));

/** A season's weeks in order. */
export const weeksOf = (ctx: AutomationContext, seasonId: string) =>
  ctx.db.select().from(weeks).where(eq(weeks.seasonId, seasonId)).orderBy(asc(weeks.number));

/** Locks a week row for a step and returns it as it now stands. */
async function lockWeek(
  tx: Parameters<Parameters<AutomationContext["db"]["transaction"]>[0]>[0],
  id: string,
) {
  const [row] = await tx.select().from(weeks).where(eq(weeks.id, id)).for("update");
  return row;
}

/**
 * A draft: bring its slate up to date from the feed (the whole slate while it has no games, then only kickoffs and
 * lines of the games already there, so a game the admin removed stays removed), then open it once every game has
 * a line and its time has come. A line still missing 24 hours before the first kickoff is reported to the admins,
 * once. Lines the admin typed, points set by hand and an explicit tiebreaker are never overwritten.
 */
export async function advanceDraft(
  ctx: AutomationContext,
  league: AutomatedLeague,
  season: SeasonRow,
  week: WeekRow,
  plan: PickemPlan,
): Promise<AdvanceResult> {
  const provided = await ctx.results(season.year, week.number, ctx.requestId);
  return ctx.db.transaction(async (tx) => {
    const locked = await lockWeek(tx, week.id);
    if (locked?.status !== "draft") return NOTHING_DONE;
    const before = await gamesOf(tx, week.id);
    if (provided?.length) {
      const known = new Set(before.map((g) => g.externalId));
      const feed = before.length === 0 ? provided : provided.filter((g) => known.has(g.externalId));
      if (feed.length) {
        await importSlate(
          tx,
          fedBy(feed),
          { id: week.id, year: season.year, number: week.number },
          { requestId: ctx.requestId, keepAdminSpreads: true, pointsFor: plan.pointsFor(week.number) },
        );
      }
    }
    const slate = await gamesOf(tx, week.id);
    const opensAt = plan.opensAt(week.number, slate);
    let result = { ...NOTHING_DONE, steps: before.length === 0 && slate.length > 0 ? 1 : 0 };
    if (slate.length > 0 && !openProblem(slate) && (!opensAt || ctx.now >= opensAt)) {
      // Spreads freeze here: automation imports into drafts only.
      await openWeek(tx, week.id);
      result = addResults(result, { steps: 1 });
      const lastKickoff = Math.max(...slate.map((g) => g.kickoff.getTime()));
      if (lastKickoff > ctx.now.getTime()) {
        const queued = await queueLeagueEvent(
          tx,
          ctx.notify,
          {
            leagueId: league.id,
            event: `week-open:${week.id}`,
            headline: plan.openHeadline(week.number),
            path: `/weeks/${week.id}`,
            actionLabel: "Make your picks",
            weekId: week.id,
            expiresAt: new Date(Math.min(lastKickoff, ctx.now.getTime() + 24 * 60 * 60_000)),
          },
          ctx.now,
        );
        result = addResults(result, queued);
      }
    } else if (missingLineDue(slate, ctx.now)) {
      const admins = await tx
        .select({ userId: leagueMembers.userId })
        .from(leagueMembers)
        .where(
          and(
            eq(leagueMembers.leagueId, league.id),
            eq(leagueMembers.role, "admin"),
            isNull(leagueMembers.removedAt),
          ),
        );
      const first = firstKickoff(slate);
      // Once per week: the event name is the dedupe key.
      const queued = await queueLeagueEvent(
        tx,
        ctx.notify,
        {
          leagueId: league.id,
          event: `missing-line:${week.id}`,
          userIds: admins.map((a) => a.userId),
          headline: plan.missingLineHeadline(week.number),
          detail:
            "A game has no spread yet, and the first game kicks off within a day. Type the line in on the week's management screen and the week opens for picks.",
          path: `/weeks/${week.id}/manage`,
          actionLabel: "Add the line",
          weekId: week.id,
          ...(first && first > ctx.now && { expiresAt: first }),
        },
        ctx.now,
      );
      result = addResults(result, queued);
    }
    return result;
  });
}

/**
 * An open week: fill in final scores from the feed for games that have been going long enough to be over (never
 * over a score already entered), then finalize once every game has one: picks are revealed, the players are
 * recorded and the recap starts. A week with no games is never "every result in".
 */
export async function advanceOpen(
  ctx: AutomationContext,
  league: AutomatedLeague,
  season: SeasonRow,
  week: WeekRow,
  plan: PickemPlan,
): Promise<AdvanceResult> {
  const before = await gamesOf(ctx.db, week.id);
  const provided = before.some((g) => awaitingResult(g, ctx.now))
    ? await ctx.results(season.year, week.number, ctx.requestId)
    : null;
  return ctx.db.transaction(async (tx) => {
    const locked = await lockWeek(tx, week.id);
    if (locked?.status !== "open") return NOTHING_DONE;
    let slate = await gamesOf(tx, week.id);
    let result = NOTHING_DONE;
    if (provided) {
      const had = slate.filter(hasResult).length;
      await writeFinals(tx, slate, provided, { overwrite: false });
      slate = await gamesOf(tx, week.id);
      if (slate.filter(hasResult).length > had) result = addResults(result, { steps: 1 });
    }
    if (slate.length === 0 || finalizeProblem(slate)) return result;
    await finalizeWeek(tx, { weekId: week.id, leagueId: league.id, at: ctx.now });
    const queued = await queueLeagueEvent(
      tx,
      ctx.notify,
      {
        leagueId: league.id,
        // A week finalized again after a reopen is a new event.
        event: `week-final:${week.id}:${ctx.now.getTime()}`,
        headline: plan.finalHeadline(week.number),
        path: `/weeks/${week.id}`,
        actionLabel: "See the results",
        weekId: week.id,
      },
      ctx.now,
    );
    return addResults(result, { steps: 1, ...queued });
  });
}

/** Steps every draft and open week of a season forward. */
export async function advanceWeeks(
  ctx: AutomationContext,
  league: AutomatedLeague,
  season: SeasonRow,
  plan: PickemPlan,
): Promise<AdvanceResult> {
  let result = NOTHING_DONE;
  for (const week of await weeksOf(ctx, season.id)) {
    if (week.status === "draft")
      result = addResults(result, await advanceDraft(ctx, league, season, week, plan));
    else if (week.status === "open")
      result = addResults(result, await advanceOpen(ctx, league, season, week, plan));
  }
  return result;
}

/**
 * Prepares week `number` from games already fetched: creates the draft and imports its slate. Returns the new
 * week, or null when it already existed (another run made it first).
 */
export async function prepareWeek(
  ctx: AutomationContext,
  season: SeasonRow,
  number: number,
  provided: ProviderGame[],
  plan: PickemPlan,
): Promise<WeekRow | null> {
  return ctx.db.transaction(async (tx) => {
    const [week] = await tx
      .insert(weeks)
      .values({ seasonId: season.id, number })
      .onConflictDoNothing()
      .returning();
    if (!week) return null;
    await importSlate(
      tx,
      fedBy(provided),
      { id: week.id, year: season.year, number },
      { requestId: ctx.requestId, keepAdminSpreads: true, pointsFor: plan.pointsFor(number) },
    );
    return week;
  });
}

/** Whether every game the feed lists has already kicked off, so there is nothing left to pick. */
export const allKickedOff = (provided: ProviderGame[], now: Date) =>
  provided.every((g) => g.kickoff.getTime() <= now.getTime());
