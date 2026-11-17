import { picks, seasons, weeks } from "@picks/db";
import { isLocked, mayPickRound, type ReminderDay, roundHasPow, weekLabel } from "@picks/shared";
import { and, eq, inArray } from "drizzle-orm";
import { guillotineStatuses, playoffFormatOf } from "../playoff";
import {
  dueReminderTargets,
  playersToRemind,
  type ReminderHandler,
  type ReminderMessage,
  type ReminderTarget,
  reminderDayStillDue,
  type SlateGame,
} from "../reminderTargets";

/*
 * Playoff pick'em: games still unpicked on the next game day, as weekly pick'em's, and none once the guillotine
 * has put a player out. In Guillotine a round without a POW puts a player out, so on the round's last game day a
 * player who has picked every game but chosen no POW is reminded of that instead (one reminder a day either
 * way: both share the day's dedupe key). The 7pm-the-evening-before rule is `dueReminderDay` in packages/shared.
 */

type Store = Parameters<ReminderHandler["stillDue"]>[0];
type SeasonRow = typeof seasons.$inferSelect;

const gamesMessage = (week: { id: string; number: number }, missing: SlateGame[]): ReminderMessage => ({
  kind: "games",
  weekId: week.id,
  weekNumber: week.number,
  games: missing,
});

/** The reader's own missing POW: it names no pick and no team. */
const powMessage = (week: { id: string; number: number }): ReminderMessage => ({
  kind: "text",
  heading: "Choose your POW",
  // Only rounds with a POW get here, so never the Super Bowl.
  intro: `You haven't chosen a Pick of the Week in the ${weekLabel(week.number)} round, and its last games are coming up. In Guillotine, a round without a POW puts you out of picking.`,
  pushBody: "Choose your POW before the round's last games kick off.",
  path: `/weeks/${week.id}`,
  actionLabel: "Choose your POW",
});

/** The round's season when it is played as Guillotine, else null. */
async function guillotineSeason(db: Store, seasonId: string): Promise<SeasonRow | null> {
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  return season && playoffFormatOf(season) === "guillotine" ? season : null;
}

/** The players of `userIds` the guillotine hasn't put out before this round. */
async function stillPicking(db: Store, season: SeasonRow, round: number, userIds: string[], now: Date) {
  const statuses = await guillotineStatuses(db, season.id, userIds, now, round);
  return new Set(userIds.filter((id) => mayPickRound(statuses.get(id) ?? null, round)));
}

/**
 * Whether the due day is the round's last chance to choose a POW: no game still open kicks off after that day's
 * games (a late game from the day before may still be open, and doesn't count).
 */
const lastGameDay = (slate: SlateGame[], due: ReminderDay<SlateGame>, now: Date) => {
  const lastDue = Math.max(...due.games.map((g) => g.kickoff.getTime()));
  return slate.every((g) => isLocked(g, now) || g.kickoff.getTime() <= lastDue);
};

export const playoffReminders: ReminderHandler = {
  async due(db, now) {
    const targets: ReminderTarget[] = [];
    const dueWeeks = await dueReminderTargets(db, now, ["playoff"], { everyWeek: true });
    for (const { league, week, due, players, slate, members } of dueWeeks) {
      const guillotine = await guillotineSeason(db, week.seasonId);
      const missingGames = new Set(players.map((p) => p.userId));
      let powless: string[] = [];
      if (guillotine && roundHasPow(week.number) && lastGameDay(slate, due, now)) {
        const rest = members.filter((id) => !missingGames.has(id));
        const withPow = rest.length
          ? await db
              .select({ userId: picks.userId })
              .from(picks)
              .where(and(eq(picks.weekId, week.id), eq(picks.isPow, true), inArray(picks.userId, rest)))
          : [];
        const chosen = new Set(withPow.map((p) => p.userId));
        powless = rest.filter((id) => !chosen.has(id));
      }
      const picking = guillotine
        ? await stillPicking(db, guillotine, week.number, [...missingGames, ...powless], now)
        : null;
      const remind = [
        ...players
          .filter((p) => !picking || picking.has(p.userId))
          .map(({ userId, missing }) => ({
            userId,
            gameIds: missing.map((g) => g.id),
            message: gamesMessage(week, missing),
          })),
        ...powless
          .filter((id) => picking?.has(id))
          .map((userId) => ({ userId, gameIds: [], message: powMessage(week) })),
      ];
      if (!remind.length) continue;
      targets.push({
        league,
        subjectId: week.id,
        weekId: week.id,
        boardId: null,
        date: due.date,
        expiresAt: due.expiresAt,
        players: remind,
      });
    }
    return targets;
  },
  async stillDue(db, ref, now) {
    const day = await reminderDayStillDue(
      db,
      { weekId: ref.subjectId, date: ref.date, userId: ref.userId },
      now,
    );
    if (!day) return null;
    const [week] = await db.select().from(weeks).where(eq(weeks.id, day.week.id));
    if (!week) return null;
    const guillotine = await guillotineSeason(db, week.seasonId);
    if (guillotine && !(await stillPicking(db, guillotine, week.number, [ref.userId], now)).has(ref.userId)) {
      return null;
    }
    const made = await db
      .select({ userId: picks.userId, gameId: picks.gameId, isPow: picks.isPow })
      .from(picks)
      .where(and(eq(picks.weekId, week.id), eq(picks.userId, ref.userId)));
    const [player] = playersToRemind(day.due.games, [ref.userId], made);
    if (player) {
      return {
        league: day.league,
        message: gamesMessage(day.week, player.missing),
        gameIds: player.missing.map((g) => g.id),
      };
    }
    const needsPow =
      guillotine &&
      roundHasPow(week.number) &&
      lastGameDay(day.slate, day.due, now) &&
      !made.some((p) => p.isPow);
    return needsPow ? { league: day.league, message: powMessage(day.week), gameIds: [] } : null;
  },
};
