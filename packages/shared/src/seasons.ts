import type { WeekStatus, WeekSummary } from "./index";
import { pickWindow } from "./rules";
import { NFL_TIME_ZONE, zonedParts } from "./time";

export const WEEK_PHASE_LABEL = {
  draft: "Draft",
  accepting: "Accepting picks",
  underway: "Games underway",
  awaiting: "Awaiting finalization",
  final: "Final",
} as const;
export type WeekPhase = keyof typeof WEEK_PHASE_LABEL;

type PhaseGame = { kickoff: Date | string; homeScore: number | null; awayScore: number | null };
const hasResult = (game: PhaseGame) => game.homeScore !== null && game.awayScore !== null;

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

/** Preparing a future or draft-only season does not displace the latest published season. */
export function preferredSeasonYear(weeks: { year: number; status: WeekStatus }[], now: Date): number {
  const current = seasonYear(now);
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
  timeZone: string,
  now: Date,
) {
  let availablePickCount = 0;
  let myAvailablePickCount = 0;
  let myMissingPickCount = 0;
  for (const game of games) {
    const window = pickWindow({ kickoff: new Date(game.kickoff), final: hasResult(game) }, timeZone, now);
    if (window === "closed") continue;
    availablePickCount++;
    if (!pickedGameIds.has(game.id)) myMissingPickCount++;
    if (window === "open" || !pickedGameIds.has(game.id)) myAvailablePickCount++;
  }
  return { availablePickCount, myAvailablePickCount, myMissingPickCount };
}

/** Prefer actionable picks over an older week whose games have all locked. */
export function currentWeek(weeks: WeekSummary[]): WeekSummary | undefined {
  const open = weeks
    .filter((week) => week.status === "open")
    .sort((a, b) => a.year - b.year || a.number - b.number);
  return (
    open.find((week) => week.myMissingPickCount > 0) ??
    open.find((week) => week.myAvailablePickCount > 0) ??
    open.find((week) => week.availablePickCount > 0) ??
    open.at(-1)
  );
}
