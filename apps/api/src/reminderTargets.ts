// Who gets a pick reminder, worked out once for both channels: the email outbox (outbox.ts) and push
// (pushQueue.ts) queue from `dueReminders`, and both recheck a queued reminder with `reminderStillApplies` just
// before sending it. Each league type says who is due in its own handler (`REMINDERS`): weekly pick'em's is
// `dueReminderTargets` / `reminderStillDue` below; the others are in reminders/<type>.ts. The timing rule itself
// (7pm league time the evening before a game day, until that day's first kickoff) is `dueReminderDay` in
// packages/shared, shared by every type.

import { type Db, games, leagueMembers, leagues, picks, seasons, squareBoards, weeks } from "@picks/db";
import { dueReminderDay, hasResult, type LeagueType, missingPicks, type ReminderDay } from "@picks/shared";
import { and, asc, eq, exists, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { logError } from "./logging";
import { playoffReminders } from "./reminders/playoff";
import { squaresReminders } from "./reminders/squares";
import { survivorReminders } from "./reminders/survivor";
import type { ReminderGame } from "./templates";

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
 * Every open week of a `types` league whose reminder is due at `now`, with the current members still missing
 * picks for that day. A handful of queries however many leagues there are. Channel preferences (email switches,
 * push devices) are the caller's to apply.
 */
export async function dueReminderTargets(
  db: Db,
  now: Date,
  types: LeagueType[] = ["weekly"],
): Promise<ReminderWeek[]> {
  const soon = new Date(now.getTime() + REMINDER_LOOKAHEAD_MS);
  const candidates = await db
    .select({ week: weeks, league: leagues })
    .from(weeks)
    .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .where(
      and(
        eq(weeks.status, "open"),
        inArray(leagues.type, types),
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

// ---------- Every league type ----------

/**
 * What a reminder says. `games`: weekly pick'em's, listing the day's unpicked games ("3 games to pick for
 * Sunday"). `text`: any other type's own words. Neither carries a pick, a team choice or a square.
 */
export type ReminderMessage =
  | { kind: "games"; weekId: string; weekNumber: number; games: (ReminderGame & { id: string })[] }
  | { kind: "text"; heading: string; intro: string; pushBody: string; path: string; actionLabel: string };

/** One due reminder occasion: a week or a board, on one game day, with the players to remind. */
export type ReminderTarget = {
  league: League;
  /** The week or board the reminder is for. With `date`, it names the reminder in dedupe keys. */
  subjectId: string;
  weekId: string | null;
  boardId: string | null;
  /** The game day, `YYYY-MM-DD` in the league's time zone. */
  date: string;
  /** When it stops being worth sending, usually the day's first kickoff. */
  expiresAt: Date;
  /** `gameIds`: what a push reminder was queued for, rechecked before it is sent (may be empty). */
  players: { userId: string; gameIds: string[]; message: ReminderMessage }[];
};

/** A queued reminder, as the send-time recheck reads it back. */
export type ReminderRef = { subjectId: string; date: string; userId: string };

/** A reminder that still applies, with what to say now. */
export type StillDueReminder = { league: League; message: ReminderMessage; gameIds: string[] };

/** One league type's reminders: who is due now, and the recheck just before each is sent. */
export type ReminderHandler = {
  due(db: Db, now: Date): Promise<ReminderTarget[]>;
  /** Null when the reminder no longer applies (left the league, already picked, too late, board locked, …). */
  stillDue(db: Store, ref: ReminderRef, now: Date): Promise<StillDueReminder | null>;
};

const gamesMessage = (week: Week, missing: SlateGame[]): ReminderMessage => ({
  kind: "games",
  weekId: week.id,
  weekNumber: week.number,
  games: missing,
});

/** Weekly pick'em: games still unpicked on the next game day. */
export const weeklyReminders: ReminderHandler = {
  async due(db, now) {
    return (await dueReminderTargets(db, now, ["weekly"])).map(({ league, week, due, players }) => ({
      league,
      subjectId: week.id,
      weekId: week.id,
      boardId: null,
      date: due.date,
      expiresAt: due.expiresAt,
      players: players.map(({ userId, missing }) => ({
        userId,
        gameIds: missing.map((g) => g.id),
        message: gamesMessage(week, missing),
      })),
    }));
  },
  async stillDue(db, ref, now) {
    const still = await reminderStillDue(
      db,
      { weekId: ref.subjectId, date: ref.date, userId: ref.userId },
      now,
    );
    return still
      ? {
          league: still.league,
          message: gamesMessage(still.week, still.missing),
          gameIds: still.missing.map((g) => g.id),
        }
      : null;
  },
};

export const REMINDERS: Record<LeagueType, ReminderHandler> = {
  weekly: weeklyReminders,
  playoff: playoffReminders,
  squares: squaresReminders,
  survivor: survivorReminders,
};

/**
 * Every type's due reminders. A failure is the caller's to log (`email_queue`, `push_queue`); within a type, one
 * bad week is logged and skipped as weekly pick'em's are.
 */
export async function dueReminders(db: Db, now: Date): Promise<ReminderTarget[]> {
  return (await Promise.all(Object.values(REMINDERS).map((handler) => handler.due(db, now)))).flat();
}

/** The type of league a reminder's week or board belongs to, or null when it is gone. */
async function subjectType(db: Store, subjectId: string): Promise<LeagueType | null> {
  const [week] = await db
    .select({ type: leagues.type })
    .from(weeks)
    .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .where(eq(weeks.id, subjectId));
  if (week) return week.type;
  const [board] = await db
    .select({ type: leagues.type })
    .from(squareBoards)
    .innerJoin(leagues, eq(leagues.id, squareBoards.leagueId))
    .where(eq(squareBoards.id, subjectId));
  return board?.type ?? null;
}

/** The send-time recheck for any type's reminder, dispatched by the type of league it belongs to. */
export async function reminderStillApplies(
  db: Store,
  ref: ReminderRef,
  now: Date,
): Promise<StillDueReminder | null> {
  const type = await subjectType(db, ref.subjectId);
  return type ? REMINDERS[type].stillDue(db, ref, now) : null;
}
