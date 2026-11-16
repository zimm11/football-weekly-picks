// Who gets a pick reminder, worked out once for both channels: the email outbox (outbox.ts) and push
// (pushQueue.ts) queue from `dueReminderTargets`, and both recheck a queued reminder with `reminderStillDue`
// just before sending it. The timing rule itself (7pm league time the evening before a game day, until that
// day's first kickoff) is `dueReminderDay` in packages/shared.

import { type Db, games, leagueMembers, leagues, picks, seasons, weeks } from "@picks/db";
import { dueReminderDay, hasResult, missingPicks, type ReminderDay } from "@picks/shared";
import { and, asc, eq, exists, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { logError } from "./logging";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Store = Db | Tx;
type GameRow = typeof games.$inferSelect;
type League = typeof leagues.$inferSelect;
type Week = typeof weeks.$inferSelect;

/** A game as the lock rules read it: final only once both scores are in. */
export type SlateGame = GameRow & { final: boolean };

/** A reminder is due from 7pm the evening before its day, so only weeks with a kickoff this soon can have one. */
export const REMINDER_LOOKAHEAD_MS = 2 * 24 * 60 * 60_000;

/** One player's reminder: the due day's games they can still pick and haven't. */
export type ReminderPlayer = { userId: string; missing: SlateGame[] };

/** One open week whose reminder is due now, and the current members who still have games to pick. */
export type ReminderWeek = {
  league: League;
  week: Week;
  due: ReminderDay<SlateGame>;
  players: ReminderPlayer[];
};

/** A week's games in kickoff order, the order `dueReminderDay` walks the days in. */
export function reminderSlate(rows: GameRow[]): SlateGame[] {
  return [...rows]
    .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime() || a.id.localeCompare(b.id))
    .map((game) => ({ ...game, final: hasResult(game) }));
}

/** The members who haven't picked every one of `games`, with the games each is missing. */
export function playersToRemind(
  games: SlateGame[],
  memberIds: string[],
  made: { userId: string; gameId: string }[],
): ReminderPlayer[] {
  const picked = new Map<string, Set<string>>();
  for (const { userId, gameId } of made) picked.set(userId, (picked.get(userId) ?? new Set()).add(gameId));
  return [...new Set(memberIds)].flatMap((userId) => {
    const missing = missingPicks(games, picked.get(userId) ?? new Set());
    return missing.length ? [{ userId, missing }] : [];
  });
}

/**
 * Every open week whose reminder is due at `now`, with the current members still missing picks for that day.
 * A handful of queries however many leagues there are. Channel preferences (email switches, push devices) are
 * the caller's to apply.
 */
export async function dueReminderTargets(db: Db, now: Date): Promise<ReminderWeek[]> {
  const soon = new Date(now.getTime() + REMINDER_LOOKAHEAD_MS);
  const candidates = await db
    .select({ week: weeks, league: leagues })
    .from(weeks)
    .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .where(
      and(
        eq(weeks.status, "open"),
        exists(
          db
            .select({ one: sql`1` })
            .from(games)
            .where(and(eq(games.weekId, weeks.id), gt(games.kickoff, now), lt(games.kickoff, soon))),
        ),
      ),
    );
  if (!candidates.length) return [];

  const slates = await db
    .select()
    .from(games)
    .where(
      inArray(
        games.weekId,
        candidates.map((c) => c.week.id),
      ),
    )
    .orderBy(asc(games.kickoff), asc(games.id));
  const due = candidates.flatMap(({ week, league }) => {
    try {
      const day = dueReminderDay(
        reminderSlate(slates.filter((g) => g.weekId === week.id)),
        league.timeZone,
        now,
      );
      return day ? [{ week, league, due: day }] : [];
    } catch (error) {
      // One bad week (say, a time zone the runtime doesn't know) mustn't stop everyone else's reminders.
      logError("reminder_targets", error);
      return [];
    }
  });
  if (!due.length) return [];

  const members = await db
    .select({ leagueId: leagueMembers.leagueId, userId: leagueMembers.userId })
    .from(leagueMembers)
    .where(
      and(
        inArray(leagueMembers.leagueId, [...new Set(due.map((d) => d.league.id))]),
        isNull(leagueMembers.removedAt),
      ),
    );
  const made = await db
    .select({ userId: picks.userId, gameId: picks.gameId })
    .from(picks)
    .where(
      inArray(
        picks.gameId,
        due.flatMap((d) => d.due.games.map((g) => g.id)),
      ),
    );
  return due.flatMap((d) => {
    const players = playersToRemind(
      d.due.games,
      members.filter((m) => m.leagueId === d.league.id).map((m) => m.userId),
      made,
    );
    return players.length ? [{ ...d, players }] : [];
  });
}

/**
 * Rechecks one queued reminder just before it is sent: the player is still a current member, the week is still
 * open, `date` is still the game day whose reminder is due, and they still have games to pick that day. Returns
 * what to remind them of now, or null when the reminder no longer applies.
 */
export async function reminderStillDue(
  db: Store,
  ref: { weekId: string; date: string; userId: string },
  now: Date,
): Promise<{ league: League; week: Week; due: ReminderDay<SlateGame>; missing: SlateGame[] } | null> {
  const [row] = await db
    .select({ week: weeks, league: leagues })
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
    .where(eq(weeks.id, ref.weekId));
  if (row?.week.status !== "open") return null;
  const slate = await db
    .select()
    .from(games)
    .where(eq(games.weekId, row.week.id))
    .orderBy(asc(games.kickoff), asc(games.id));
  const due = dueReminderDay(reminderSlate(slate), row.league.timeZone, now);
  if (!due || due.date !== ref.date) return null;
  const made = await db
    .select({ userId: picks.userId, gameId: picks.gameId })
    .from(picks)
    .where(and(eq(picks.weekId, row.week.id), eq(picks.userId, ref.userId)));
  const [player] = playersToRemind(due.games, [ref.userId], made);
  return player ? { ...row, due, missing: player.missing } : null;
}
