// The week chores, shared by the admin's routes (weeks.ts), automation (automation/) and each league type's own
// routes: import a slate from the provider, open a week, fill in results, finalize. Each takes a database handle
// or an open transaction (`Store`), so a caller can run several inside its own transaction; none of them checks
// who is asking, which is the caller's job.

import { games, weekRecapViews, weeks } from "@picks/db";
import { defaultPoints, hasResult, isPostseasonWeek } from "@picks/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { recordWeekParticipants, type Store } from "./context";
import { logError } from "./logging";
import type { NflProvider, ProviderGame } from "./nfl";

export type GameRow = typeof games.$inferSelect;

/**
 * How long after kickoff a game could first be over. Before then there is no point asking the provider for
 * its result. NFL games run about three hours; none finishes in two and a half.
 */
export const SHORTEST_GAME_MS = 150 * 60_000;

/** How often an open week's results are fetched from the provider at most, however many players are looking. */
export const RESULTS_REFRESH_MS = 60_000;

/** A provider game that kicked off long enough ago to be over and still has no result here. */
export const awaitingResult = (g: GameRow, at: Date) =>
  g.externalId !== null && !hasResult(g) && at.getTime() - g.kickoff.getTime() >= SHORTEST_GAME_MS;

/**
 * A game's points when its kickoff moves: a game still worth its old slot's default takes the new slot's (a
 * Sunday afternoon game flexed to Sunday night goes from 1 to 2). Points the admin set by hand are kept.
 * `pointsFor` is the default by kickoff (a playoff round's is the same for every kickoff).
 */
export const pointsAfterKickoffChange = (
  game: Pick<GameRow, "kickoff" | "points">,
  kickoff: Date,
  pointsFor: PointsFor = defaultPoints,
) => (game.points === pointsFor(game.kickoff) ? pointsFor(kickoff) : game.points);

/** What a new game is worth by default: its time slot's points (`defaultPoints`), or its playoff round's. */
export type PointsFor = (kickoff: Date) => number;

/** A week's games in kickoff order. */
export const gamesOf = (db: Store, weekId: string) =>
  db.select().from(games).where(eq(games.weekId, weekId)).orderBy(asc(games.kickoff), asc(games.id));

/**
 * Adds the provider's games to a week and refreshes kickoffs and spreads of the ones already there. Meant for
 * drafts: once players have picked, spreads change only when the admin edits them by hand. With
 * `keepAdminSpreads` (automation), a spread the admin typed (`spreadByAdmin`) is never replaced; the admin's own
 * Import replaces it, as it always has. `pointsFor` gives a new game its points (default: its time slot's).
 * Returns a message for the admin when nothing could be imported.
 */
export async function importSlate(
  db: Store,
  nfl: NflProvider,
  week: { id: string; year: number; number: number },
  options: { requestId?: string; keepAdminSpreads?: boolean; pointsFor?: PointsFor } = {},
): Promise<string | null> {
  const { requestId, keepAdminSpreads = false, pointsFor = defaultPoints } = options;
  let provided: ProviderGame[];
  try {
    provided = await nfl.getWeek(week.year, week.number);
  } catch (err) {
    logError("schedule_import", err, requestId);
    return "Couldn't load the schedule. Add games by hand, or try the import again.";
  }
  // Weeks past 18 are only ever playoff rounds (weekly week creation stops at 18).
  if (provided.length === 0)
    return `No games are scheduled for that ${isPostseasonWeek(week.number) ? "round" : "week"} yet.`;
  const existing = new Map((await gamesOf(db, week.id)).map((g) => [g.externalId, g]));
  for (const g of provided) {
    const current = existing.get(g.externalId);
    if (current) {
      await db
        .update(games)
        .set({
          kickoff: g.kickoff,
          spread: keepAdminSpreads && current.spreadByAdmin ? current.spread : (g.spread ?? current.spread),
          points: pointsAfterKickoffChange(current, g.kickoff, pointsFor),
        })
        .where(eq(games.id, current.id));
    } else {
      // Two imports at once can both find the game missing; the second insert then adds nothing.
      await db
        .insert(games)
        .values({
          weekId: week.id,
          externalId: g.externalId,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          kickoff: g.kickoff,
          spread: g.spread,
          points: pointsFor(g.kickoff),
        })
        .onConflictDoNothing({ target: [games.weekId, games.externalId] });
    }
  }
  return null;
}

/**
 * Moves games still to finish to the feed's kickoff when it differs (a flexed or postponed game), so each locks
 * when it really starts. For weeks players are already picking: spreads are never touched, and a game with a
 * result is left alone. With `pointsFor`, a moved game still worth its old slot's default takes the new slot's.
 * Returns how many games moved.
 */
export async function followKickoffs(
  db: Store,
  gameRows: GameRow[],
  provided: ProviderGame[],
  { pointsFor }: { pointsFor?: PointsFor } = {},
): Promise<number> {
  const feed = new Map(provided.map((g) => [g.externalId, g]));
  let moved = 0;
  for (const game of gameRows) {
    const listed = game.externalId ? feed.get(game.externalId) : undefined;
    if (!listed || hasResult(game) || listed.kickoff.getTime() === game.kickoff.getTime()) continue;
    await db
      .update(games)
      .set({
        kickoff: listed.kickoff,
        ...(pointsFor && { points: pointsAfterKickoffChange(game, listed.kickoff, pointsFor) }),
      })
      // Checked again in the write, in case a score was entered since the games were read.
      .where(and(eq(games.id, game.id), isNull(games.homeScore)));
    moved++;
  }
  return moved;
}

/** Why a draft can't open yet, or null when it can: it needs games, and every game needs a spread. */
export function openProblem(gameRows: Pick<GameRow, "spread">[]): string | null {
  if (gameRows.length === 0) return "Add at least one game before opening the week.";
  if (gameRows.some((g) => g.spread === null)) return "Every game needs a spread before the week opens.";
  return null;
}

/** Opens a draft for picks. The caller has checked `openProblem`. */
export async function openWeek(db: Store, weekId: string) {
  await db.update(weeks).set({ status: "open" }).where(eq(weeks.id, weekId));
}

/**
 * Records the provider's final scores on the games that came from it. Spreads are never touched. Without
 * `overwrite`, only games with no result yet are filled, so a score an admin typed in always stands.
 */
export async function writeFinals(
  db: Store,
  gameRows: GameRow[],
  provided: ProviderGame[],
  { overwrite }: { overwrite: boolean },
) {
  const finals = new Map(provided.filter((g) => g.homeScore !== null).map((g) => [g.externalId, g]));
  for (const game of gameRows) {
    const final = game.externalId ? finals.get(game.externalId) : undefined;
    if (!final || (!overwrite && hasResult(game))) continue;
    await db
      .update(games)
      .set({ homeScore: final.homeScore, awayScore: final.awayScore })
      // Checked again in the write, in case the admin entered a score since the games were read.
      .where(overwrite ? eq(games.id, game.id) : and(eq(games.id, game.id), isNull(games.homeScore)));
  }
}

/**
 * The provider's view of a week, fetched at most once per `RESULTS_REFRESH_MS` per server instance and shared
 * by every league and player reading that week. A failed fetch is remembered for the same time, so a provider
 * outage isn't asked again on every page load. Resolves to null when the provider couldn't be reached. Only the
 * settled answer is kept (a Workers request must not wait on another request's fetch), so reads that miss at the
 * same moment each ask.
 */
export type ProviderWeeks = (
  year: number,
  number: number,
  requestId?: string,
) => Promise<ProviderGame[] | null>;

export function providerWeeks(nfl: NflProvider, now: () => Date): ProviderWeeks {
  const recent = new Map<string, { at: number; games: ProviderGame[] | null }>();
  return async (year, number, requestId) => {
    const key = `${year}:${number}`;
    const at = now().getTime();
    const cached = recent.get(key);
    if (cached && at >= cached.at && at - cached.at < RESULTS_REFRESH_MS) return cached.games;
    const games = await nfl.getWeek(year, number).catch((err) => {
      logError("results_autosync", err, requestId);
      return null;
    });
    recent.set(key, { at, games });
    return games;
  };
}

/**
 * Fills in results for an open week's games as they end. Nothing is fetched unless a game has been going long
 * enough to be over and still has no result. A provider failure changes nothing: the admin can still pull
 * results or type scores in.
 */
export async function fillFinishedGames(
  db: Store,
  results: ProviderWeeks,
  week: { id: string; status: string; year: number; number: number },
  at: Date,
  requestId?: string,
) {
  if (week.status !== "open") return;
  const gameRows = await gamesOf(db, week.id);
  if (!gameRows.some((g) => awaitingResult(g, at))) return;
  const provided = await results(week.year, week.number, requestId);
  if (provided) await writeFinals(db, gameRows, provided, { overwrite: false });
}

/** Why an open week can't be finalized yet, or null when it can: every game needs a final score. */
export function finalizeProblem(gameRows: GameRow[]): string | null {
  return gameRows.every(hasResult) ? null : "Every game needs a final score before the week can close.";
}

/** Records that a player has been shown the week's results, so the recap isn't offered to them again. */
export const markRecapSeen = (db: Store, weekId: string, userId: string, at: Date) =>
  db
    .insert(weekRecapViews)
    .values({ weekId, userId, seenAt: at })
    .onConflictDoUpdate({
      target: [weekRecapViews.weekId, weekRecapViews.userId],
      set: { seenAt: at },
    });

/**
 * Closes a week: marks it final (`finalizedAt`, which starts the recap) and records who it is scored for
 * (`week_participants`). Run it in a transaction: updating the week row waits for any pick save in flight, so
 * the participants recorded see it. The caller has checked `finalizeProblem`. The admin who closes the week sees
 * the results there, so pass them as `actorId` and they aren't recapped as well.
 */
export async function finalizeWeek(
  tx: Store,
  input: { weekId: string; leagueId: string; at: Date; actorId?: string },
) {
  await tx.update(weeks).set({ status: "final", finalizedAt: input.at }).where(eq(weeks.id, input.weekId));
  // Who this week is scored for, fixed now so that later leaving or rejoining can't rewrite it.
  await recordWeekParticipants(tx, input.weekId, input.leagueId);
  if (input.actorId) await markRecapSeen(tx, input.weekId, input.actorId, input.at);
}

/**
 * Reopens a final week for corrections. Players' picks are hidden from each other again until it is finalized
 * again; the league's admins see the picks on locked games, as on any open week (`resultsSoFar`).
 */
export async function reopenWeek(db: Store, weekId: string) {
  await db.update(weeks).set({ status: "open", finalizedAt: null }).where(eq(weeks.id, weekId));
}
