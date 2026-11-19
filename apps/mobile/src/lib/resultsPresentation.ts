import {
  coveringSide,
  formatLine,
  type Game,
  type LeagueManagement,
  type LeagueType,
  lineFor,
  PLAYOFF_ROUNDS,
  pickPoints,
  type Side,
  type WeekPhase,
  type WeekStatus,
  weekLabel,
} from "@picks/shared";
import { matchup } from "./pickDraft";
import type { PickOutcome } from "./weekPresentation";

/*
 * How results, standings and the recap are laid out and worded, as pure functions: the stat tiles' rows, the
 * player's place in one line, the playoff round strip, the recap's title and headline, and the matchup sheet's
 * stat names. The screens draw them.
 */

/** Stat tiles across a row: three under 1024px of window, six from 1024 (never two). */
export const statColumns = (windowWidth: number) => (windowWidth >= 1024 ? 6 : 3);

/**
 * Tiles in rows of `columns`, in order, each row with how many empty slots pad it to full width, so a short last
 * row keeps the others' tile width.
 */
export function tileRows<T>(items: T[], columns: number): { items: T[]; pad: number }[] {
  const size = Math.max(1, columns);
  const rows: { items: T[]; pad: number }[] = [];
  for (let i = 0; i < items.length; i += size) {
    const row = items.slice(i, i + size);
    rows.push({ items: row, pad: size - row.length });
  }
  return rows;
}

export const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;

/** "Sam", or "Shared by 2" when several share it; undefined with nobody. */
export function sharedName(names: string[]): string | undefined {
  if (names.length === 0) return undefined;
  return names.length === 1 ? names[0] : `Shared by ${names.length}`;
}

/**
 * The player's place in the season in one line, from the standings (final weeks only): "3rd of 4 · 5 pts behind
 * Sam", "1st of 4 · Leading the league", "2nd of 4 · Level on points with Sam". Null when they aren't in them.
 */
export function standingLine(
  entries: { userId: string; rank: number; points: number; displayName: string }[],
  userId: string,
): string | null {
  const me = entries.find((entry) => entry.userId === userId);
  if (!me) return null;
  const place = `${ordinal(me.rank)} of ${entries.length}`;
  const leader = entries.find((entry) => entry.userId !== userId && entry.rank === 1) ?? entries[0];
  if (me.rank === 1 || !leader) return `${place} · Leading the league`;
  const behind = leader.points - me.points;
  return behind > 0
    ? `${place} · ${behind} ${behind === 1 ? "pt" : "pts"} behind ${leader.displayName}`
    : `${place} · Level on points with ${leader.displayName}`;
}

export type RoundStep = {
  number: number;
  label: string;
  /** Final; open for picks; the round that opens next; or one after that. */
  state: "final" | "open" | "next" | "later";
};

/**
 * The four playoff rounds in order (Wild Card · Divisional · Conference · Super Bowl), each with where it
 * stands, from the selected season's rounds as the league lists them. The first round neither final nor open
 * is next; a draft (a commissioner sees one) is still next, since players can't pick it yet.
 */
export function playoffRoundSteps(weeks: { number: number; status: WeekStatus }[]): RoundStep[] {
  let nextFound = false;
  return PLAYOFF_ROUNDS.map((number) => {
    const status = weeks.find((w) => w.number === number)?.status;
    let state: RoundStep["state"];
    if (status === "final") state = "final";
    else if (status === "open") state = "open";
    else if (!nextFound && !weeks.some((w) => w.status === "open")) {
      state = "next";
      nextFound = true;
    } else state = "later";
    if (state === "open") nextFound = true;
    return { number, label: weekLabel(number), state };
  });
}

/** The recap's title, with the year when the week isn't in the season on screen: "2025 Super Bowl is final". */
export function recapTitle(number: number, weekYear: number, selectedYear?: number) {
  const name = weekLabel(number);
  return selectedYear !== undefined && weekYear !== selectedYear
    ? `${weekYear} ${name} is final`
    : `${name} is final`;
}

/** The recap's headline icon: a trophy for a win (or a title), the Low Point Loser's face, or none. */
export type RecapMood = "won" | "lpl" | null;

/** A weekly recap's headline and its icon. */
export function weeklyRecapHeadline({
  rank,
  playerCount,
  isWinner,
  winnerCount,
  lowPointLoser,
}: {
  rank?: number;
  playerCount: number;
  isWinner?: boolean;
  winnerCount: number;
  lowPointLoser: boolean;
}): { text: string; mood: RecapMood } {
  if (rank === undefined) return { text: "The results are in.", mood: null };
  if (isWinner)
    return {
      text:
        winnerCount > 1
          ? "You shared the win. Half a trophy is still a trophy."
          : "You won the week. Take a bow.",
      mood: "won",
    };
  if (lowPointLoser) return { text: "You're this week's Low Point Loser. Somebody had to be.", mood: "lpl" };
  return { text: `You finished ${ordinal(rank)} of ${playerCount}.`, mood: null };
}

/** Words the feed sends in Title Case that stay capitalized in sentence case. */
const KEEP = new Set(["NFL", "TD", "TDs", "QB", "QBR", "INT", "YDS", "3rd", "4th", "RZ"]);

/**
 * A stat name in sentence case: "Total Yards Per Game" → "Total yards per game". Abbreviations (all capitals,
 * or a known one) keep their case; the first word keeps its capital.
 */
export function sentenceCase(text: string): string {
  return text
    .split(" ")
    .map((word, index) => {
      if (index === 0 || KEEP.has(word) || (word.length > 1 && word === word.toUpperCase())) return word;
      return word.toLowerCase();
    })
    .join(" ");
}

/** A draft a commissioner has something to do with, as the Picks tab shows it. */
export type DraftCard = { weekId: string; title: string; detail: string; action: string };

type BetweenWeeksLeague = {
  type: LeagueType;
  management: LeagueManagement;
  admin: boolean;
  weeks: { id: string; number: number; status: WeekStatus; gameCount: number }[];
};

/**
 * The drafts the Picks tab shows its commissioner a card for, in the league's order. A Hands-on draft always (the
 * commissioner sets it up and opens it: "Set up" while it has no games, "Review and open" once it has); in a
 * league that runs itself only a draft with games (waiting on a line, or imported by hand): an empty one is
 * filled and opened by the feed, so there is nothing to review, and "No week is open" says when it opens.
 * Players are never sent drafts, and get no card.
 */
export function draftCards(league: BetweenWeeksLeague): DraftCard[] {
  if (!league.admin) return [];
  const automatic = league.management === "auto";
  return league.weeks
    .filter((w) => w.status === "draft" && (!automatic || w.gameCount > 0))
    .map((draft) => {
      const name = weekLabel(draft.number);
      if (!automatic && draft.gameCount === 0)
        return {
          weekId: draft.id,
          title: `${name} is a draft`,
          detail: "Players can't see it yet. Add its games, then open it for picks.",
          action: `Set up ${name}`,
        };
      return {
        weekId: draft.id,
        title: `${name} is ready to review`,
        detail: `It's a draft, so players can't see it yet.${
          !automatic
            ? ""
            : league.type === "playoff"
              ? " It opens by itself once every game has a line."
              : " It opens by itself on Tuesday at 9 AM Eastern, or as soon as every game has a line after that."
        }`,
        action: automatic ? `Review ${name}` : `Review and open ${name}`,
      };
    });
}

/**
 * The weekly Picks tab's card while no week is open and no draft card stands in for it: the heading, when the
 * next week opens, and the commissioner's way to start one ("Set up a week", "Start season"), if any.
 */
export function noWeekOpen(league: BetweenWeeksLeague): {
  title: string;
  detail: string;
  action: "Set up a week" | "Start season" | null;
} {
  const automatic = league.management === "auto";
  const drafts = league.weeks.filter((w) => w.status === "draft");
  // An empty draft in a league that runs itself: the feed draws it on its Tuesday.
  const waiting = automatic ? drafts.find((w) => w.gameCount === 0) : undefined;
  const detail = automatic
    ? !league.admin
      ? // Players aren't sent draft weeks, so an empty list doesn't mean the season hasn't started.
        "Weeks open by themselves on Tuesday at 9 AM Eastern, with that morning's lines."
      : waiting
        ? `${weekLabel(waiting.number)} opens by itself on Tuesday at 9 AM Eastern, with that morning's lines.`
        : league.weeks.length
          ? "The next week opens by itself on Tuesday at 9 AM Eastern, with that morning's lines."
          : "Start the season on the League tab, and each week opens by itself."
    : league.admin
      ? "Set up a week and open it, and the pick sheet shows up here for everyone."
      : "The pick sheet shows up here as soon as the commissioner opens the next week.";
  // A draft waiting means the season is under way: its controls are on the League tab.
  const action =
    league.admin && drafts.length === 0
      ? automatic && league.weeks.length === 0
        ? "Start season"
        : "Set up a week"
      : null;
  return { title: "No week is open", detail, action };
}

/*
 * Results so far: a commissioner's view of an open week (`WeekView.resultsSoFar`). The server sends each player's
 * pick only on games that have locked, and names those games (`lockedGameIds`, as the server judged them). Any
 * other game is held back rather than read as "no pick", and nothing is claimed as an outcome: no winner, no Low
 * Point Loser, no awards. What is held back is the server's word, never this device's clock: a clock running
 * ahead, or a copy remembered from before a kickoff, would otherwise say a player has no pick when they do.
 */

/**
 * The weeks the Results tab lists above the final ones for a commissioner: open weeks with a game under way or
 * every score in (`underway`, `awaiting`), latest first. None for a player, and none that hasn't kicked off.
 */
export function inProgressWeeks<T extends { number: number; status: WeekStatus; phase: WeekPhase }>(
  weeks: T[],
  admin: boolean,
): T[] {
  if (!admin) return [];
  return weeks
    .filter((w) => w.status === "open" && (w.phase === "underway" || w.phase === "awaiting"))
    .sort((a, b) => b.number - a.number);
}

/** The words the results page's summary tiles use: a final week's outcome, or where things stand so far. */
export function resultsTileLabels({ provisional, playoff }: { provisional: boolean; playoff: boolean }) {
  return provisional
    ? { place: "Your place", top: "Top score so far" }
    : { place: "Your finish", top: playoff ? "Top score" : "Winning score" };
}

/** A pick cell's outcome: a pick's own (`PickOutcome`), or `hidden` when the server hasn't revealed its game. */
export type ResultCellOutcome = PickOutcome | "hidden";

/**
 * One player's cell for one game on the results page, and its accessible name. On a final week (and on a
 * locked game so far) it is the pick against its line, the POW, the outcome and the points; "no pick" when there
 * is none. Results so far, a game the server didn't reveal (`revealed` false: not in `lockedGameIds`) is
 * `hidden` (its picks are held back until kickoff), never "no pick".
 */
export function resultPickCell(
  game: Game,
  pick: { side: Side } | undefined,
  {
    pow,
    powBonus,
    provisional = false,
    revealed = true,
  }: { pow: boolean; powBonus?: number; provisional?: boolean; revealed?: boolean },
): { outcome: ResultCellOutcome; team: string | null; earned: number | null; label: string } {
  if (provisional && !revealed)
    return { outcome: "hidden", team: null, earned: null, label: `${matchup(game)}, hidden until kickoff.` };
  const scored = { ...game, kickoff: new Date(game.kickoff) };
  const covered = coveringSide(scored);
  const outcome: PickOutcome = !pick
    ? "none"
    : covered === null
      ? "pending"
      : covered === pick.side
        ? "won"
        : covered === "push"
          ? "push"
          : "lost";
  const team = pick ? (pick.side === "home" ? game.homeTeam : game.awayTeam) : null;
  const earned = pick ? pickPoints(scored, { side: pick.side, isPow: pow }, powBonus) : null;
  const final = game.homeScore !== null && game.awayScore !== null;
  const tail =
    provisional && !final
      ? " Not final yet."
      : ` Final ${game.awayScore ?? "pending"} to ${game.homeScore ?? "pending"}.`;
  const label = `${matchup(game)}, ${pick && team ? formatLine(team, lineFor(pick.side, game.spread ?? 0)) : "No pick"}${pow ? ", POW" : ""}, ${outcome === "none" ? "no pick" : outcome}${earned === null ? "" : `, ${earned} points`}.${tail}`;
  return { outcome, team, earned, label };
}

/**
 * A player's tiebreaker guess on the results page: the guess, "—" for none, or, results so far, "Shows at
 * kickoff" while the tiebreaker game hasn't locked (the server holds guesses back until then).
 */
export function resultGuess(
  guess: number | null,
  {
    provisional = false,
    tiebreakerLocked = true,
  }: { provisional?: boolean; tiebreakerLocked?: boolean } = {},
): string {
  if (guess !== null) return String(guess);
  return provisional && !tiebreakerLocked ? "Shows at kickoff" : "—";
}

/**
 * Game by game's line under a game's split: how many got it right, "Nobody scored" on a push, and, results so
 * far, "Result pending" until the game has a result (rather than "0 of 4 got it right").
 */
export function breakdownLine({
  covered,
  right,
  players,
  provisional = false,
}: {
  covered: Side | "push" | null;
  right: number;
  players: number;
  provisional?: boolean;
}): string {
  if (covered === "push") return "Nobody scored";
  if (provisional && covered === null) return "Result pending";
  return `${right} of ${players} got it right`;
}

/**
 * The games results so far can say anything about: those the server revealed (`lockedGameIds`), in the
 * week's order. A final week shows every game.
 */
export function revealedGames(
  games: Game[],
  { provisional = false, lockedGameIds = [] }: { provisional?: boolean; lockedGameIds?: string[] } = {},
): Game[] {
  if (!provisional) return games;
  return games.filter((game) => lockedGameIds.includes(game.id));
}

/**
 * The commissioner's POW tile, results so far: Won, Lost or Push once its game has a result, To play before,
 * None without one. `won` is the entry's `powWon`.
 */
export function provisionalPowValue(powGame: Game | undefined, won: boolean): string {
  if (!powGame) return "None";
  const covered = coveringSide({ ...powGame, kickoff: new Date(powGame.kickoff) });
  if (covered === null) return "To play";
  if (covered === "push") return "Push";
  return won ? "Won" : "Lost";
}
