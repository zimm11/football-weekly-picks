import { formatLine, type Game, LEAGUE_TYPE_INFO, roundHasPow, teamName, type WeekView } from "@picks/shared";
import { gameLocked, savedDraft } from "./pickDraft";

export const kickoffDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" }).format(
    new Date(iso),
  );
export const kickoffTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
export function gameDays(games: Game[], timeZone: string) {
  const groups: { day: string; games: Game[] }[] = [];
  for (const game of games) {
    const day = kickoffDay(game.kickoff, timeZone);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.games.push(game);
    else groups.push({ day, games: [game] });
  }
  return groups;
}
/** What the league calls one of its weeks in running text: "week", or "round" in a playoff league. */
export const weekUnit = (view: Pick<WeekView, "leagueType">): "week" | "round" =>
  LEAGUE_TYPE_INFO[view.leagueType ?? "weekly"].unit === "round" ? "round" : "week";

/** Whether this week has a POW: every week but a playoff league's Super Bowl (`roundHasPow`). */
export const weekHasPow = (view: Pick<WeekView, "number" | "playoff">) =>
  !view.playoff || (view.playoff.pow ?? roundHasPow(view.number));

export function pickStatus(view: WeekView, at: Date) {
  const saved = savedDraft(view);
  const unpicked = view.games.filter((game) => !saved.sides[game.id]);
  const left = unpicked.filter((game) => !gameLocked(game, at)).length;
  const tiebreaker = view.games.find((game) => game.id === view.tiebreakerGameId);
  return {
    savedCount: view.games.length - unpicked.length,
    left,
    missed: unpicked.length - left,
    needsTotal: !!tiebreaker && view.myTiebreakerTotal === null && !gameLocked(tiebreaker, at),
    needsPow: weekHasPow(view) && saved.pow === null && view.games.some((game) => !gameLocked(game, at)),
  };
}
export function favoriteLine(game: Pick<Game, "homeTeam" | "awayTeam">, line: number) {
  return line === 0
    ? "Pick'em"
    : line < 0
      ? formatLine(teamName(game.homeTeam), line)
      : formatLine(teamName(game.awayTeam), -line);
}
export function ordinal(n: number) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th")}`;
}
export const formatRecord = (record: { wins: number; losses: number; pushes: number }) =>
  `${record.wins}–${record.losses}${record.pushes > 0 ? `–${record.pushes}` : ""}`;
