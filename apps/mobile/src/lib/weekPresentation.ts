import {
  coveringSide,
  formatLine,
  type Game,
  LEAGUE_TYPE_INFO,
  lineFor,
  pickPoints,
  roundHasPow,
  teamName,
  type WeekView,
} from "@picks/shared";
import { gameLocked, matchup, type PickDraft, savedDraft } from "./pickDraft";

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
/**
 * What a player can still change on an open pick sheet: a pick or the POW on a game that hasn't locked
 * (`games`; never for a playoff player the guillotine put out), and the tiebreaker guess until its game locks
 * (`guess`). Both false once every game has kicked off or has a result: the sheet then offers no save.
 */
export function sheetEditable(view: WeekView, at: Date) {
  if (view.status !== "open") return { games: false, guess: false };
  const tiebreaker = view.games.find((game) => game.id === view.tiebreakerGameId);
  return {
    games: view.playoff?.mayPick !== false && view.games.some((game) => !gameLocked(game, at)),
    guess: !!tiebreaker && !gameLocked(tiebreaker, at),
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

/** How a saved pick stands: `pending` until its game has a result, `none` when there is no pick. */
export type PickOutcome = "won" | "lost" | "push" | "pending" | "none";

/**
 * What the pick sheet's compact row says about a game the player can no longer change (it has kicked off or
 * has a result): the saved pick against its line, the POW, the final score and the outcome, and the row's
 * accessible name, which carries all of it in words ("won", "lost", "push") so nothing rests on color.
 */
export function lockedGameRow(
  game: Game,
  saved: Pick<PickDraft, "sides" | "pow">,
  { hasPow, powBonus }: { hasPow: boolean; powBonus?: number },
) {
  const scored = { ...game, kickoff: new Date(game.kickoff) };
  const covered = coveringSide(scored);
  const side = saved.sides[game.id];
  // A playoff Super Bowl has no POW, and scoring ignores one saved before.
  const pow = hasPow && !!side && saved.pow === game.id;
  const team = side ? (side === "home" ? game.homeTeam : game.awayTeam) : null;
  const line = side ? lineFor(side, game.spread ?? 0) : 0;
  const pick = team ? formatLine(teamName(team), line) : null;
  const earned = side ? pickPoints(scored, { side, isPow: pow }, powBonus) : null;
  const outcome: PickOutcome = !side
    ? "none"
    : covered === null
      ? "pending"
      : covered === "push"
        ? "push"
        : covered === side
          ? "won"
          : "lost";
  const score = covered === null ? null : `${game.awayScore}–${game.homeScore}`;
  const result =
    outcome === "won" ? `Won +${earned}` : outcome === "lost" ? "Lost" : outcome === "push" ? "Push" : null;
  const said =
    outcome === "won"
      ? `, won ${earned} ${earned === 1 ? "point" : "points"}`
      : outcome === "lost" || outcome === "push"
        ? `, ${outcome}`
        : "";
  // The line in brackets ("Chiefs (-3.5)"), so the row's name never contains a team button's ("Chiefs -3.5").
  const named = team && `${teamName(team)} (${line === 0 ? "PK" : `${line > 0 ? "+" : ""}${line}`})`;
  const label = `${matchup(game)}, ${score ? `final ${score}` : "locked"}, ${named ? `your pick: ${named}${pow ? ", POW" : ""}` : "no pick"}${said}`;
  return { team, pick, pow, outcome, earned, score, result, label };
}
