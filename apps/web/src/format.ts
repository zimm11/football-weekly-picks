import type { Game } from "@picks/shared";

export { seasonYear } from "@picks/shared";

/** "Thursday, Nov 12", in the league's time zone. */
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

/**
 * When something was posted, the way a chat app says it: "Just now", "12 min ago", "3:42 PM",
 * "Yesterday, 9:15 PM", "Tue, 9:15 PM", then "Nov 2" (with the year once it isn't this one).
 */
export function relativeTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const time = then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(then)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${then.toLocaleDateString("en-US", { weekday: "short" })}, ${time}`;
  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: then.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
