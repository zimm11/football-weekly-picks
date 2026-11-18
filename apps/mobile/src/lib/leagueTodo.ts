import type { LeagueTodo } from "@picks/shared";
import { zonedParts } from "@picks/shared";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The device's own time zone: Your leagues lists several leagues, so there is no one league time zone. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const clock = (hour: number, minute: number) =>
  `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;

/**
 * When something locks, as a short phrase after "locks": "in 40 minutes" and "in 3 hours" when it is close,
 * then "today 8:15 PM", "tomorrow 1:00 PM", "Thu 8:15 PM" within the week, else "Sun, Nov 30".
 */
export function locksPhrase(locksAt: Date, now: Date, timeZone: string): string {
  const ms = locksAt.getTime() - now.getTime();
  if (ms < 60_000) return "now";
  if (ms < HOUR) {
    const minutes = Math.floor(ms / 60_000);
    return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  if (ms < 6 * HOUR) {
    const hours = Math.floor(ms / HOUR);
    return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const at = zonedParts(locksAt, timeZone);
  const today = zonedParts(now, timeZone);
  // Whole calendar days between the two wall-clock dates, whatever the offsets.
  const days = Math.round(
    (Date.UTC(at.year, at.month - 1, at.day) - Date.UTC(today.year, today.month - 1, today.day)) / DAY,
  );
  const time = clock(at.hour, at.minute);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `tomorrow ${time}`;
  if (days < 7) return `${WEEKDAYS[at.weekday]} ${time}`;
  return `${WEEKDAYS[at.weekday]}, ${MONTHS[at.month - 1]} ${at.day}`;
}

/**
 * What is waiting in one league on Your leagues, in two parts: what ("7 picks due", "Pick due", "Squares open",
 * "2 boards open") and when it locks ("locks Thu 8:15 PM", "first locks Sun 6:30 PM"; absent when the time can't
 * be read). `undefined` when nothing is waiting (or an older server sent nothing).
 */
export function leagueTodoParts(
  todo: LeagueTodo | undefined,
  now: Date,
  timeZone: string = deviceTimeZone(),
): { what: string; when?: string } | undefined {
  if (!todo) return undefined;
  const locksAt = new Date(todo.locksAt);
  const phrase = Number.isNaN(locksAt.getTime()) ? undefined : locksPhrase(locksAt, now, timeZone);
  const parts = (what: string, lead = "locks") => ({ what, ...(phrase && { when: `${lead} ${phrase}` }) });
  switch (todo.kind) {
    case "picks":
      // `locksAt` is the first of those games to kick off: the deadline that matters next.
      return parts(`${todo.count} ${todo.count === 1 ? "pick" : "picks"} due`);
    case "survivor-pick":
      return parts("Pick due");
    case "squares":
      return todo.count > 1 ? parts(`${todo.count} boards open`, "first locks") : parts("Squares open");
    default:
      return undefined;
  }
}

/**
 * The same as one plain sentence, for the row's accessible name: "7 picks due · locks Thu 8:15 PM", "Pick due ·
 * locks in 3 hours", "2 boards open · first locks Sun 6:30 PM".
 */
export function leagueTodoLine(
  todo: LeagueTodo | undefined,
  now: Date,
  timeZone: string = deviceTimeZone(),
): string | undefined {
  const parts = leagueTodoParts(todo, now, timeZone);
  return parts && (parts.when ? `${parts.what} · ${parts.when}` : parts.what);
}

/**
 * A phrase drawn so a narrow screen never leaves its last word alone on a line: the space before the last word
 * becomes a no-break space ("8:15 PM", "45 minutes", "Nov 30" stay together). For visible text only.
 */
export const keepLastWords = (phrase: string) => phrase.replace(/ (\S+)$/, "\u00a0$1");
