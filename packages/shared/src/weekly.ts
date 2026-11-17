import { NFL_TIME_ZONE, zonedParts, zonedTimeToUtc } from "./time";

/*
 * Weekly pick'em's Automatic management, as pure functions: when the feed opens a week, and when a missing line
 * is worth telling the admins about. The steps themselves (prepare, open, sync, finalize) are the API's
 * (apps/api/src/automation/weekly.ts).
 */

/** An automatic week opens on Tuesday (0 = Sunday) … */
export const WEEKLY_OPEN_WEEKDAY = 2;
/** … at 9 AM Eastern, once every game has a line. Spreads freeze then. */
export const WEEKLY_OPEN_HOUR = 9;

/** How long before a week's first kickoff a missing line is reported to the admins. */
export const MISSING_LINE_NOTICE_MS = 24 * 60 * 60_000;

/**
 * When an automatic week opens: the last Tuesday 9 AM Eastern at or before its first kickoff (the Tuesday of a
 * Thursday-to-Monday week). The week still waits for every line, so it opens at this time or as soon as the last
 * line is in after it.
 */
export function weeklyOpensAt(firstKickoff: Date): Date {
  const kickoff = zonedParts(firstKickoff, NFL_TIME_ZONE);
  const back = (kickoff.weekday - WEEKLY_OPEN_WEEKDAY + 7) % 7;
  // Day arithmetic past a month's edge rolls over, as Date.UTC does.
  const opens = zonedTimeToUtc(
    kickoff.year,
    kickoff.month,
    kickoff.day - back,
    WEEKLY_OPEN_HOUR,
    NFL_TIME_ZONE,
  );
  // A Tuesday game before 9 AM opens with the Tuesday before.
  return opens > firstKickoff
    ? zonedTimeToUtc(kickoff.year, kickoff.month, kickoff.day - back - 7, WEEKLY_OPEN_HOUR, NFL_TIME_ZONE)
    : opens;
}

/** The earliest kickoff on a slate, or null for an empty one. */
export function firstKickoff(games: { kickoff: Date }[]): Date | null {
  if (games.length === 0) return null;
  return new Date(Math.min(...games.map((g) => g.kickoff.getTime())));
}

/** Whether the admins should hear about a game still without a line: from 24 hours before the first kickoff. */
export function missingLineDue(games: { kickoff: Date; spread: number | null }[], now: Date): boolean {
  const first = firstKickoff(games);
  return (
    !!first &&
    games.some((g) => g.spread === null) &&
    now.getTime() >= first.getTime() - MISSING_LINE_NOTICE_MS
  );
}

/**
 * Whether an automatic league's admin may still change spreads and point values: until the week's first kickoff.
 * After that the slate's values stand, though a score can be corrected at any time.
 */
export function slateEditable(games: { kickoff: Date }[], now: Date): boolean {
  const first = firstKickoff(games);
  return !first || now < first;
}
