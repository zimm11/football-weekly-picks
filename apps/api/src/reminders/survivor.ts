import { games, leagueMembers, leagues, seasons, weeks } from "@picks/db";
import { dueReminderDay, weekLabel } from "@picks/shared";
import { and, eq, exists, gt, isNull, lt, sql } from "drizzle-orm";
import { logError } from "../logging";
import {
  REMINDER_LOOKAHEAD_MS,
  type ReminderHandler,
  type ReminderMessage,
  type ReminderTarget,
  reminderSlate,
} from "../reminderTargets";
import { loadSurvivorSeason } from "../survivor";

/*
 * Survivor: alive players with no pick yet for the week being played, at 7pm league time the evening before each
 * game day until that day's first kickoff (`dueReminderDay`, shared by every type). A player who is out, has
 * picked, or joined after the pool began gets none. The message names the week only, never a team.
 */

type League = typeof leagues.$inferSelect;
type Week = typeof weeks.$inferSelect;

const message = (league: League, week: Week): ReminderMessage => ({
  kind: "text",
  heading: `Make your ${weekLabel(week.number)} pick`,
  intro: `You haven't picked a team for ${weekLabel(week.number)} in ${league.name} yet. Your pick locks when its game kicks off.`,
  pushBody: `Pick a team for ${weekLabel(week.number)} before kickoff.`,
  path: `/leagues/${league.id}`,
  actionLabel: "Make your pick",
});

/** The week's reminder day at `now`, and the alive players still without a pick. Null when nobody is due. */
async function dueFor(
  db: Parameters<ReminderHandler["stillDue"]>[0],
  league: League,
  week: Week,
  year: number,
  now: Date,
) {
  if (week.status !== "open") return null;
  const data = await loadSurvivorSeason(db, league.id, year);
  const status = data?.status;
  const slate = data?.weeks.find((w) => w.id === week.id)?.games ?? [];
  if (!data || !status || status.nextWeek !== week.number || !slate.length) return null;
  const day = dueReminderDay(reminderSlate(slate), league.timeZone, now);
  if (!day) return null;
  const picked = new Set(data.picks.filter((p) => p.weekId === week.id).map((p) => p.userId));
  const current = new Set(data.members.filter((m) => m.removedAt === null).map((m) => m.userId));
  const players = status.players
    .filter((p) => p.alive && current.has(p.userId) && !picked.has(p.userId))
    .map((p) => p.userId);
  return { day, players };
}

export const survivorReminders: ReminderHandler = {
  async due(db, now) {
    const soon = new Date(now.getTime() + REMINDER_LOOKAHEAD_MS);
    const candidates = await db
      .select({ week: weeks, league: leagues, year: seasons.year })
      .from(weeks)
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
      .where(
        and(
          eq(weeks.status, "open"),
          eq(leagues.type, "survivor"),
          exists(
            db
              .select({ one: sql`1` })
              .from(games)
              .where(and(eq(games.weekId, weeks.id), gt(games.kickoff, now), lt(games.kickoff, soon))),
          ),
        ),
      );
    const targets: ReminderTarget[] = [];
    for (const { week, league, year } of candidates) {
      try {
        const due = await dueFor(db, league, week, year, now);
        if (!due?.players.length) continue;
        targets.push({
          league,
          subjectId: week.id,
          weekId: week.id,
          boardId: null,
          date: due.day.date,
          expiresAt: due.day.expiresAt,
          players: due.players.map((userId) => ({ userId, gameIds: [], message: message(league, week) })),
        });
      } catch (error) {
        // One bad week (say, a time zone the runtime doesn't know) mustn't stop everyone else's reminders.
        logError("reminder_targets", error);
      }
    }
    return targets;
  },

  async stillDue(db, ref, now) {
    const [row] = await db
      .select({ week: weeks, league: leagues, year: seasons.year })
      .from(weeks)
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
      .innerJoin(
        leagueMembers,
        and(
          eq(leagueMembers.leagueId, leagues.id),
          eq(leagueMembers.userId, ref.userId),
          isNull(leagueMembers.removedAt),
        ),
      )
      .where(and(eq(weeks.id, ref.subjectId), eq(leagues.type, "survivor")));
    if (!row) return null;
    const due = await dueFor(db, row.league, row.week, row.year, now);
    if (!due || due.day.date !== ref.date || !due.players.includes(ref.userId)) return null;
    return { league: row.league, message: message(row.league, row.week), gameIds: [] };
  },
};
