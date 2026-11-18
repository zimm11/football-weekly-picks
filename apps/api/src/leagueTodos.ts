import {
  games,
  leagueMembers,
  leagues,
  picks,
  seasons,
  squareBoards,
  squareClaims,
  survivorPicks,
  weeks,
} from "@picks/db";
import {
  guillotineStatus,
  hasResult,
  isLocked,
  type LeagueTodo,
  type LeagueType,
  mayPickRound,
  pickedTeam,
  readSeasonSettings,
  survivorStatus,
  usedTeams,
  usedTeamsWaived,
} from "@picks/shared";
import { and, asc, eq, exists, gt, inArray, isNull, ne, not, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type AppDeps, recordedParticipants } from "./context";

/*
 * What is waiting for a player in each of their leagues, for Your leagues (`GET /leagues`): games to pick, a
 * survivor pick to make, squares to claim. The rules are the ones the reminders and the league's own tabs use
 * (the Picks tab's `currentWeek`, the guillotine, survivor's status, an open board), worked out for one player
 * across all their leagues in a constant number of queries: nothing here loops over leagues with a query, asks
 * the feed, or advances automation. Only the player's own picks and squares decide anything that comes back;
 * everyone's survivor picks are read to work out the player's own status (a week that would put out everyone
 * still in puts out nobody), and only that status is used.
 */

type Db = AppDeps["db"];
type GameRow = typeof games.$inferSelect;

export type TodoLeague = { id: string; type: LeagueType };

const lockOf = (game: GameRow) => ({ kickoff: game.kickoff, final: hasResult(game) });

/** Earliest first. */
const byKickoff = (a: GameRow, b: GameRow) => a.kickoff.getTime() - b.kickoff.getTime();

/** What waits for `userId` in each of `memberships` (their current leagues), by league id. */
export async function leagueTodos(
  db: Db,
  userId: string,
  memberships: TodoLeague[],
  now: Date,
): Promise<Map<string, LeagueTodo>> {
  const ofType = (...types: LeagueType[]) =>
    memberships.filter((l) => types.includes(l.type)).map((l) => l.id);
  const [weekTodos, boardTodos] = await Promise.all([
    weekTodosFor(db, userId, ofType("weekly", "playoff", "survivor"), now),
    squaresTodos(db, userId, ofType("squares"), now),
  ]);
  return new Map([...weekTodos, ...boardTodos]);
}

/**
 * Pick'em and survivor. One query finds the weeks that matter (every open week, and for playoff and survivor the
 * rest of an open week's season, which the guillotine and survivor's status are worked out from); then the
 * games, the player's own picks, and for survivor seasons the player hasn't picked in yet, everyone's survivor
 * picks, the members and the recorded participants, in parallel.
 */
async function weekTodosFor(
  db: Db,
  userId: string,
  leagueIds: string[],
  now: Date,
): Promise<Map<string, LeagueTodo>> {
  const result = new Map<string, LeagueTodo>();
  if (!leagueIds.length) return result;
  const openWeeks = alias(weeks, "open_weeks");
  const rows = await db
    .select({
      id: weeks.id,
      number: weeks.number,
      status: weeks.status,
      seasonId: weeks.seasonId,
      year: seasons.year,
      settings: seasons.settings,
      leagueId: seasons.leagueId,
      type: leagues.type,
      /** Survivor: the player has a pick in this week. Their own row only. */
      mySurvivorPick: sql<boolean>`${exists(
        db
          .select({ one: sql`1` })
          .from(survivorPicks)
          .where(and(eq(survivorPicks.weekId, weeks.id), eq(survivorPicks.userId, userId))),
      )}`,
    })
    .from(weeks)
    .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .where(
      and(
        inArray(seasons.leagueId, leagueIds),
        exists(
          db
            .select({ one: sql`1` })
            .from(openWeeks)
            .where(and(eq(openWeeks.seasonId, seasons.id), eq(openWeeks.status, "open"))),
        ),
        or(eq(weeks.status, "open"), ne(leagues.type, "weekly")),
      ),
    );
  if (!rows.length) return result;

  const pickem = rows.filter((w) => w.type !== "survivor");
  // A survivor season matters only while its open week has no pick of the player's.
  const survivorSeasonIds = new Set(
    rows
      .filter((w) => w.type === "survivor" && w.status === "open" && !w.mySurvivorPick)
      .map((w) => w.seasonId),
  );
  const survivorWeeks = rows.filter((w) => survivorSeasonIds.has(w.seasonId));
  const survivorLeagueIds = [...new Set(survivorWeeks.map((w) => w.leagueId))];
  const gameWeekIds = [...pickem, ...survivorWeeks].map((w) => w.id);
  const [gameRows, myPicks, allSurvivorPicks, members, recorded] = await Promise.all([
    gameWeekIds.length
      ? db
          .select()
          .from(games)
          .where(inArray(games.weekId, gameWeekIds))
          .orderBy(asc(games.kickoff), asc(games.id))
      : [],
    pickem.length
      ? db
          .select({ weekId: picks.weekId, gameId: picks.gameId, side: picks.side, isPow: picks.isPow })
          .from(picks)
          .where(
            and(
              inArray(
                picks.weekId,
                pickem.map((w) => w.id),
              ),
              eq(picks.userId, userId),
            ),
          )
      : [],
    survivorWeeks.length
      ? db
          .select()
          .from(survivorPicks)
          .where(
            inArray(
              survivorPicks.weekId,
              survivorWeeks.map((w) => w.id),
            ),
          )
      : [],
    survivorLeagueIds.length
      ? db
          .select({
            leagueId: leagueMembers.leagueId,
            userId: leagueMembers.userId,
            joinedAt: leagueMembers.joinedAt,
            removedAt: leagueMembers.removedAt,
          })
          .from(leagueMembers)
          .where(inArray(leagueMembers.leagueId, survivorLeagueIds))
          .orderBy(asc(leagueMembers.joinedAt), asc(leagueMembers.userId))
      : [],
    recordedParticipants(
      db,
      survivorWeeks.filter((w) => w.status === "final").map((w) => w.id),
    ),
  ]);
  const gamesOf = (weekId: string) => gameRows.filter((g) => g.weekId === weekId);

  // ---------- Weekly and playoff pick'em ----------
  // The Picks tab's week (`currentWeek` in packages/shared): the earliest open week with a game still to pick.
  const openPickem = pickem
    .filter((w) => w.status === "open")
    .sort((a, b) => a.year - b.year || a.number - b.number);
  for (const week of openPickem) {
    if (result.has(week.leagueId)) continue;
    if (week.type === "playoff" && readSeasonSettings("playoff", week.settings).format === "guillotine") {
      // The guillotine, from the player's own picks in the season's earlier rounds (as the reminders judge it).
      const rounds = pickem
        .filter((r) => r.seasonId === week.seasonId && r.number < week.number)
        .map((r) => ({
          number: r.number,
          games: gamesOf(r.id),
          picks: myPicks.filter((p) => p.weekId === r.id).map((p) => ({ ...p, userId })),
        }));
      const [status] = guillotineStatus({ rounds, userIds: [userId], now });
      if (!mayPickRound(status ?? null, week.number)) continue;
    }
    const picked = new Set(myPicks.filter((p) => p.weekId === week.id).map((p) => p.gameId));
    const missing = gamesOf(week.id).filter((g) => !isLocked(lockOf(g), now) && !picked.has(g.id));
    const first = missing.sort(byKickoff)[0];
    if (!first) continue;
    result.set(week.leagueId, {
      kind: "picks",
      weekId: week.id,
      weekNumber: week.number,
      count: missing.length,
      locksAt: first.kickoff.toISOString(),
    });
  }

  // ---------- Survivor ----------
  for (const seasonId of survivorSeasonIds) {
    const seasonWeeks = survivorWeeks
      .filter((w) => w.seasonId === seasonId)
      .sort((a, b) => a.number - b.number)
      .map((w) => ({ ...w, games: gamesOf(w.id) }));
    const season = seasonWeeks[0];
    if (!season || result.has(season.leagueId)) continue;
    const settings = readSeasonSettings("survivor", season.settings);
    if (!settings.startWeek) continue;
    const seasonPicks = allSurvivorPicks.filter((p) => seasonWeeks.some((w) => w.id === p.weekId));
    const status = survivorStatus({
      startWeek: settings.startWeek,
      lives: settings.lives,
      weeks: seasonWeeks,
      picks: seasonPicks,
      members: members.filter((m) => m.leagueId === season.leagueId),
      recorded,
    });
    // The week being played, open, the player in it and still alive (so an entrant, not watching) and without a
    // pick in it: the reminder's rule.
    const open = seasonWeeks.find((w) => w.number === status.nextWeek && w.status === "open");
    if (!open) continue;
    if (!status.players.find((p) => p.userId === userId)?.alive) continue;
    if (seasonPicks.some((p) => p.weekId === open.id && p.userId === userId)) continue;
    // A game still to kick off with a team they may pick: one not used before, or any once a playoff slate
    // has no unused team left.
    const used = usedTeams(seasonWeeks, seasonPicks, userId, open.number);
    const waived = usedTeamsWaived(open.number, open.games, used, now);
    const pickable = open.games
      .filter((g) => !isLocked(lockOf(g), now))
      .filter((g) => waived || (["home", "away"] as const).some((side) => !used.has(pickedTeam(g, side))))
      .sort(byKickoff)[0];
    if (!pickable) continue;
    result.set(open.leagueId, {
      kind: "survivor-pick",
      weekId: open.id,
      weekNumber: open.number,
      locksAt: pickable.kickoff.toISOString(),
    });
  }
  return result;
}

/** Squares: boards still open for claims (not drawn, before kickoff) where the player holds no square. */
async function squaresTodos(
  db: Db,
  userId: string,
  leagueIds: string[],
  now: Date,
): Promise<Map<string, LeagueTodo>> {
  const result = new Map<string, LeagueTodo>();
  if (!leagueIds.length) return result;
  const boards = await db
    .select({ id: squareBoards.id, leagueId: squareBoards.leagueId, kickoff: squareBoards.kickoff })
    .from(squareBoards)
    .where(
      and(
        inArray(squareBoards.leagueId, leagueIds),
        isNull(squareBoards.drawnAt),
        gt(squareBoards.kickoff, now),
        not(
          exists(
            db
              .select({ one: sql`1` })
              .from(squareClaims)
              .where(and(eq(squareClaims.boardId, squareBoards.id), eq(squareClaims.userId, userId))),
          ),
        ),
      ),
    )
    .orderBy(asc(squareBoards.kickoff), asc(squareBoards.createdAt));
  for (const board of boards) {
    const todo = result.get(board.leagueId);
    if (todo?.kind === "squares") {
      todo.count++;
      continue;
    }
    result.set(board.leagueId, {
      kind: "squares",
      boardId: board.id,
      count: 1,
      locksAt: board.kickoff.toISOString(),
    });
  }
  return result;
}
