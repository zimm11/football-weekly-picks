import { isLocked, type LockableGame } from "./rules";
import { zonedParts, zonedTimeToUtc } from "./time";

/** Pick reminders go out at this hour (league time zone) on the evening before a game day. */
export const REMINDER_HOUR = 19;

export type ReminderDay<G> = {
  /** The game day, `YYYY-MM-DD` in the league's time zone. */
  date: string;
  /** When the reminder became due: 7pm the evening before. */
  remindAt: Date;
  /** When it stops being worth sending: the day's first kickoff. */
  expiresAt: Date;
  /** That day's games that can still be picked. */
  games: G[];
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The game day whose reminder is due at `now`, if any: from 7pm the evening before until that day's first
 * kickoff. Consecutive game days' windows don't overlap unless a day's first game kicks off after 7pm, and then
 * each day still gets its own reminder (its own dedupe key), one run apart.
 */
export function dueReminderDay<G extends LockableGame>(
  games: G[],
  timeZone: string,
  now: Date,
): ReminderDay<G> | null {
  const byDate = new Map<string, G[]>();
  for (const game of games) {
    const p = zonedParts(game.kickoff, timeZone);
    const date = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    byDate.set(date, [...(byDate.get(date) ?? []), game]);
  }
  for (const [date, dayGames] of byDate) {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    // Day 0 of a month rolls back to the last day of the previous one.
    const remindAt = zonedTimeToUtc(year, month, day - 1, REMINDER_HOUR, timeZone);
    const expiresAt = new Date(Math.min(...dayGames.map((g) => g.kickoff.getTime())));
    if (now < remindAt || now >= expiresAt) continue;
    const open = dayGames
      .filter((g) => !isLocked(g, now))
      .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
    return open.length ? { date, remindAt, expiresAt, games: open } : null;
  }
  return null;
}

/** The day's games a player hasn't picked yet. */
export function missingPicks<G extends { id: string }>(games: G[], pickedGameIds: Set<string>): G[] {
  return games.filter((g) => !pickedGameIds.has(g.id));
}
