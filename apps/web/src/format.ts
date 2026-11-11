import type { Game } from "@picks/shared";

/** "Thursday, Nov 12", in the league's time zone (the one the 6am lock is measured in). */
export function kickoffDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/** "8:15 PM EST" */
export function kickoffTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** "WSH at NYG" */
export const matchup = (game: Pick<Game, "homeTeam" | "awayTeam">) => `${game.awayTeam} at ${game.homeTeam}`;

/** The NFL season a date falls in: January and February belong to the season that started the year before. */
export function seasonYear(now: Date): number {
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}
