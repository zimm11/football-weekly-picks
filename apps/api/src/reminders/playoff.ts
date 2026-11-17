import { seasons, weeks } from "@picks/db";
import { mayPickRound } from "@picks/shared";
import { eq } from "drizzle-orm";
import { guillotineStatuses, playoffFormatOf } from "../playoff";
import {
  dueReminderTargets,
  type ReminderHandler,
  type ReminderMessage,
  type ReminderTarget,
  reminderStillDue,
  type SlateGame,
} from "../reminderTargets";

/*
 * Playoff pick'em: games still unpicked on the next game day, as weekly pick'em's, and none once the guillotine
 * has put a player out. The 7pm-the-evening-before rule is `dueReminderDay` in packages/shared.
 */

const gamesMessage = (week: { id: string; number: number }, missing: SlateGame[]): ReminderMessage => ({
  kind: "games",
  weekId: week.id,
  weekNumber: week.number,
  games: missing,
});

/** The players of `userIds` still picking in this round (all of them in Traditional). */
async function stillPicking(
  db: Parameters<ReminderHandler["stillDue"]>[0],
  week: { seasonId: string; number: number },
  userIds: string[],
  now: Date,
): Promise<Set<string>> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, week.seasonId));
  if (!season || playoffFormatOf(season) !== "guillotine") return new Set(userIds);
  const statuses = await guillotineStatuses(db, season.id, userIds, now, week.number);
  return new Set(userIds.filter((id) => mayPickRound(statuses.get(id) ?? null, week.number)));
}

export const playoffReminders: ReminderHandler = {
  async due(db, now) {
    const targets: ReminderTarget[] = [];
    for (const { league, week, due, players } of await dueReminderTargets(db, now, ["playoff"])) {
      const picking = await stillPicking(
        db,
        week,
        players.map((p) => p.userId),
        now,
      );
      const remind = players.filter((p) => picking.has(p.userId));
      if (!remind.length) continue;
      targets.push({
        league,
        subjectId: week.id,
        weekId: week.id,
        boardId: null,
        date: due.date,
        expiresAt: due.expiresAt,
        players: remind.map(({ userId, missing }) => ({
          userId,
          gameIds: missing.map((g) => g.id),
          message: gamesMessage(week, missing),
        })),
      });
    }
    return targets;
  },
  async stillDue(db, ref, now) {
    const still = await reminderStillDue(
      db,
      { weekId: ref.subjectId, date: ref.date, userId: ref.userId },
      now,
    );
    if (!still) return null;
    const [week] = await db.select().from(weeks).where(eq(weeks.id, still.week.id));
    if (!week || !(await stillPicking(db, week, [ref.userId], now)).has(ref.userId)) return null;
    return {
      league: still.league,
      message: gamesMessage(still.week, still.missing),
      gameIds: still.missing.map((g) => g.id),
    };
  },
};
