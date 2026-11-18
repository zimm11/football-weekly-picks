import type { WeekStatus, WeekSummary } from "./index";
import { hasResult, isLocked } from "./rules";
import { NFL_TIME_ZONE, zonedParts } from "./time";

export const WEEK_PHASE_LABEL = {
  draft: "Draft",
  accepting: "Accepting picks",
  underway: "Games underway",
  awaiting: "Awaiting finalization",
  final: "Final",
} as const;
export type WeekPhase = keyof typeof WEEK_PHASE_LABEL;

/*
 * One week number line for every league type. Weeks 1–18 are the regular season; the postseason rounds follow as
 * 19 (Wild Card), 20 (Divisional), 21 (Conference) and 22 (Super Bowl). The schedule provider maps 19–22 onto
 * ESPN's postseason weeks.
 */
export const REGULAR_SEASON_WEEKS = 18;
/** The last week on the line: the Super Bowl. */
export const LAST_WEEK = 22;
export const POSTSEASON_ROUNDS = {
  19: "Wild Card",
  20: "Divisional",
  21: "Conference",
  22: "Super Bowl",
} as const satisfies Record<number, string>;

export const isPostseasonWeek = (number: number) => number > REGULAR_SEASON_WEEKS && number <= LAST_WEEK;

/** "Week 7", or the round's name for 19–22 ("Wild Card", "Super Bowl"). */
export function weekLabel(number: number): string {
  return POSTSEASON_ROUNDS[number as keyof typeof POSTSEASON_ROUNDS] ?? `Week ${number}`;
}

type PhaseGame = { kickoff: Date | string; homeScore: number | null; awayScore: number | null };

/** Display phases never reveal picks or finalize a week automatically. */
export function weekPhase(status: WeekStatus, games: PhaseGame[], now: Date): WeekPhase {
  if (status !== "open") return status;
  if (games.length > 0 && games.every(hasResult)) return "awaiting";
  if (games.some((game) => hasResult(game) || new Date(game.kickoff) <= now)) return "underway";
  return "accepting";
}

/** The NFL season's starting year, including January games in the preceding year's season. */
export function seasonYear(now: Date): number {
  const { year, month } = zonedParts(now, NFL_TIME_ZONE);
  return month <= 2 ? year - 1 : year;
}

/**
 * The September day of Week 1's Thursday: the NFL opens on the Thursday after Labor Day (the first Monday of
 * September). Week n's Thursday is 7 × (n − 1) days later; a day past the month's edge rolls over, as `Date.UTC`
 * does. Every calendar estimate below starts here.
 */
export function openingThursday(year: number): number {
  const firstOfSeptember = new Date(Date.UTC(year, 8, 1)).getUTCDay();
  const laborDay = 1 + ((8 - firstOfSeptember) % 7);
  return laborDay + 3;
}

/**
 * When an NFL regular-season week is expected to start, from the calendar alone: its Thursday at 23:00 UTC (7 PM
 * Eastern, 6 PM in winter, a little before the night game), or noon Eastern on Thanksgiving, whose games start in
 * the afternoon. Used to offer start weeks and to pace automation before the feed has been asked; the imported
 * slate's real kickoffs decide everything after that.
 */
export function estimatedWeekStart(year: number, number: number): Date {
  const day = openingThursday(year) + 7 * (number - 1);
  const thursday = new Date(Date.UTC(year, 8, day));
  // Thanksgiving is the fourth Thursday of November.
  const thanksgiving =
    thursday.getUTCMonth() === 10 && thursday.getUTCDate() >= 22 && thursday.getUTCDate() <= 28;
  return new Date(Date.UTC(year, 8, day, thanksgiving ? 17 : 23));
}

/** The first regular-season week of `year` with no kickoff yet at `now`, or null once Week 18 has begun. */
export function nextStartWeek(year: number, now: Date): number | null {
  for (let number = 1; number <= REGULAR_SEASON_WEEKS; number++) {
    if (estimatedWeekStart(year, number) > now) return number;
  }
  return null;
}

/**
 * The season a league opens on. Preparing a future or draft-only season does not displace the latest published
 * season: that is weekly pick'em's rule, where a season begins with its first open week.
 *
 * `started` (the league's `startedSeasons`) lists the years whose season exists before any of its weeks does: a
 * playoff or survivor season is there from Start season (or the league's creation), months before its first
 * round or week opens. When this NFL season is one of them the league opens on it, not on last year's finished
 * one. A future year among them changes nothing.
 */
export function preferredSeasonYear(
  weeks: { year: number; status: WeekStatus }[],
  now: Date,
  started: readonly number[] = [],
): number {
  const current = seasonYear(now);
  if (started.includes(current)) return current;
  const published = weeks.filter((week) => week.year <= current && week.status !== "draft");
  if (published.length) return Math.max(...published.map((week) => week.year));
  const drafts = weeks.filter((week) => week.year <= current);
  return drafts.length ? Math.max(...drafts.map((week) => week.year)) : current;
}

/** Continue after the latest prepared week, then offer gaps; never suggest a duplicate at season's end. */
export function nextWeekNumber(weeks: { number: number }[], maxWeek: number): number | null {
  const taken = new Set(weeks.map((week) => week.number));
  const latest = Math.max(0, ...taken);
  for (let number = latest + 1; number <= maxWeek; number++) {
    if (!taken.has(number)) return number;
  }
  for (let number = 1; number <= maxWeek; number++) {
    if (!taken.has(number)) return number;
  }
  return null;
}

/** Counts only the requesting player's opportunities; no other player's choices enter the response. */
export function weekPickAvailability(
  games: (PhaseGame & { id: string })[],
  pickedGameIds: Set<string>,
  now: Date,
) {
  let availablePickCount = 0;
  let myMissingPickCount = 0;
  for (const game of games) {
    if (isLocked({ kickoff: new Date(game.kickoff), final: hasResult(game) }, now)) continue;
    availablePickCount++;
    if (!pickedGameIds.has(game.id)) myMissingPickCount++;
  }
  // Every game that hasn't locked can still be picked or changed.
  return { availablePickCount, myAvailablePickCount: availablePickCount, myMissingPickCount };
}

/** Prefer actionable picks over an older week whose games have all locked. */
export function currentWeek(weeks: WeekSummary[]): WeekSummary | undefined {
  const open = weeks
    .filter((week) => week.status === "open")
    .sort((a, b) => a.year - b.year || a.number - b.number);
  return (
    open.find((week) => week.myMissingPickCount > 0) ??
    open.find((week) => week.availablePickCount > 0) ??
    open.at(-1)
  );
}
