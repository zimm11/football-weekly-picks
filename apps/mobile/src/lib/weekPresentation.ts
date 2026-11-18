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
import { layout, widths } from "../components/theme";
import { gameLocked, matchup, type PickDraft, savedDraft } from "./pickDraft";

export const kickoffDay = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" }).format(
    new Date(iso),
  );
/**
 * A kickoff's time of day in the league's time zone: "8:15 PM EST", or "8:15 PM" with `zone: false` where the
 * zone is said once nearby (the pick sheet's day heading, `kickoffZone`).
 */
export const kickoffTime = (iso: string, timeZone: string, { zone = true }: { zone?: boolean } = {}) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    ...(zone ? { timeZoneName: "short" as const } : {}),
  }).format(new Date(iso));
/** The league time zone's short name at a kickoff ("EST", "EDT", "UTC"), as `kickoffTime` would say it. */
export function kickoffZone(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(
    new Date(iso),
  );
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}
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
/** The pick sheet's grid: the gap between cards and between a card's buttons, a card's padding, the POW's width. */
export const PICK_GRID = {
  gap: 8,
  cardPad: 10,
  powWidth: 56,
  rowTeamWidth: 160,
  twoColumnsFrom: 768,
  /** Under this a stacked button's name steps down a size, so "Commanders" fits a 320px phone. */
  smallNameUnder: 104,
} as const;

/**
 * How the pick sheet lays out its games for a window this wide: one column, or two from 768px; and each team
 * button stacked (badge over name over line) or, once it is at least 160px wide, a row (badge beside them),
 * with a smaller name on the narrowest phones (`smallName`). Worked out from the window and the page's
 * paddings rather than measured, so nothing is fed back into state.
 */
export function pickSheetLayout(windowWidth: number, hasPow: boolean) {
  const { gap, cardPad, powWidth, rowTeamWidth, twoColumnsFrom, smallNameUnder } = PICK_GRID;
  const columns = windowWidth >= twoColumnsFrom ? 2 : 1;
  const content = Math.min(windowWidth, widths.page) - 2 * layout.pageX;
  const card = (content - (columns - 1) * gap) / columns;
  const teamWidth = (card - 2 * cardPad - (hasPow ? powWidth + 2 * gap : gap)) / 2;
  const team = teamWidth >= rowTeamWidth ? ("row" as const) : ("stack" as const);
  return {
    columns,
    /** The room inside a card, for its Stats & news row. */
    cardInner: card - 2 * cardPad,
    teamWidth,
    team,
    smallName: team === "stack" && teamWidth < smallNameUnder,
  };
}

/** Items in rows of `size`, in order, the last row short: a grid read row by row keeps kickoff and tab order. */
export function rowsOf<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) rows.push(items.slice(i, i + Math.max(1, size)));
  return rows;
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
  // The scoreboard line: which side covered (each side's score in full ink), "push", or null before a result.
  return { team, pick, pow, outcome, earned, score, result, label, covered };
}
