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

/** "1st", "2nd", "3rd", "11th" */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** "12–8", or "12–8–1" with pushes. */
export function formatRecord(r: { wins: number; losses: number; pushes: number }): string {
  return `${r.wins}–${r.losses}${r.pushes > 0 ? `–${r.pushes}` : ""}`;
}

/** "62%", or "—" when there's nothing to measure. */
export function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** One decimal place, dropping a trailing ".0": 9.5, 12. */
export function formatAverage(n: number | null): string {
  return n === null ? "—" : String(Math.round(n * 10) / 10);
}
