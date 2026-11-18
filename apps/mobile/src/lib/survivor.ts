import {
  type Game,
  hasResult,
  isPostseasonWeek,
  LAST_WEEK,
  type POSTSEASON_ROUNDS,
  REGULAR_SEASON_WEEKS,
  type Side,
  type SurvivorGameView,
  type SurvivorOutcome,
  type SurvivorView,
  survivorReasonText,
  teamName,
  weekLabel,
} from "@picks/shared";

/*
 * The survivor screens' rules of presentation, kept pure so they're tested without a screen: what each team
 * button says, the grid's cells, the lines above the pick cards and in the recap.
 */

export type SurvivorPlayer = SurvivorView["players"][number];
export type SurvivorWeek = SurvivorView["weeks"][number];
export type SurvivorDraft = { gameId: string; side: Side };

/** A game is closed to picks from its kickoff, or once it has a result. */
export const survivorGameLocked = (
  game: Pick<SurvivorGameView, "kickoff" | "homeScore" | "awayScore">,
  at: Date,
) => hasResult(game) || new Date(game.kickoff) <= at;

/** The shape the matchup sheet takes. Survivor has no spread, so the sheet shows win prices only. */
export const asMatchupGame = (game: SurvivorGameView): Game => ({ ...game, spread: null, points: 0 });

/** "Bears at Packers". */
export const survivorMatchup = (game: Pick<SurvivorGameView, "homeTeam" | "awayTeam">) =>
  `${teamName(game.awayTeam)} at ${teamName(game.homeTeam)}`;

/** "Out in Week 7: Bears lost". */
export function outLine(player: Pick<SurvivorPlayer, "outWeek" | "outReason">): string | null {
  if (player.outWeek === null || !player.outReason) return null;
  return `Out in ${weekLabel(player.outWeek)}: ${survivorReasonText(player.outReason)}`;
}

/** "7 of 12 alive". */
export function aliveCount(view: Pick<SurvivorView, "players">): string {
  return `${view.players.filter((p) => p.alive).length} of ${view.players.length} alive`;
}

/** The week being played, with its games, or undefined between weeks. */
export const currentWeek = (view: SurvivorView) =>
  view.current ? view.weeks.find((w) => w.id === view.current?.weekId) : undefined;

/**
 * What one team button shows for the signed-in player: selected, disabled, and the reason it is disabled
 * ("Used in Week 3", "Kicked off"). `locked` is the player's saved pick having kicked off (it can't move).
 */
export function teamChoice(input: {
  view: SurvivorView;
  game: SurvivorGameView;
  side: Side;
  draft: SurvivorDraft | null;
  canPick: boolean;
  now: Date;
}): { selected: boolean; disabled: boolean; note: string | null } {
  const { view, game, side, draft, canPick, now } = input;
  const team = side === "home" ? game.homeTeam : game.awayTeam;
  const selected = draft?.gameId === game.id && draft.side === side;
  const used = view.current?.used.find((u) => u.team === team);
  const saved = view.current?.myPick;
  const savedGame = saved && currentWeek(view)?.games.find((g) => g.id === saved.gameId);
  const pickLocked = !!savedGame && survivorGameLocked(savedGame, now);
  const gameLocked = survivorGameLocked(game, now);
  const note =
    used && !view.current?.usedWaived
      ? `Used in ${weekLabel(used.weekNumber)}`
      : gameLocked && !selected
        ? "Kicked off"
        : null;
  const disabled = !canPick || pickLocked || gameLocked || (!!used && !view.current?.usedWaived);
  return { selected, disabled, note };
}

/** The draft differs from the saved pick. */
export function draftChanged(view: SurvivorView, draft: SurvivorDraft | null): boolean {
  const saved = view.current?.myPick ?? null;
  if (!draft) return false;
  return !saved || saved.gameId !== draft.gameId || saved.side !== draft.side;
}

/** The weeks the grid shows: the pool's weeks players can see, from the start week. */
export const gridWeeks = (view: SurvivorView) =>
  view.weeks.filter((w) => w.status !== "draft" && w.number >= (view.settings?.startWeek ?? 1));

/** A short column title: "W12", or the round ("WC", "Div", "Conf", "SB"). */
export function weekShort(number: number): string {
  if (!isPostseasonWeek(number)) return `W${number}`;
  return ({ 19: "WC", 20: "Div", 21: "Conf", 22: "SB" } as const)[number as keyof typeof POSTSEASON_ROUNDS];
}

export type GridCell =
  | { kind: "pick"; team: string; outcome: SurvivorOutcome; label: string }
  | { kind: "missed"; label: string }
  | { kind: "empty"; label: string };

const OUTCOME_WORD: Record<SurvivorOutcome, string> = {
  won: "won",
  lost: "lost",
  tie: "tied",
  pending: "to play",
};

/**
 * One grid cell: the team picked once it is revealed, with how it did. A final week with no pick for a player
 * still in it says "No pick"; any other empty cell says nothing (a pick not yet revealed looks like no pick).
 */
export function gridCell(view: SurvivorView, player: SurvivorPlayer, week: SurvivorWeek): GridCell {
  const label = weekLabel(week.number);
  const pick = view.picks.find((p) => p.userId === player.userId && p.weekId === week.id);
  if (pick) {
    return {
      kind: "pick",
      team: pick.team,
      outcome: pick.outcome,
      label: `${label}: ${teamName(pick.team)}, ${OUTCOME_WORD[pick.outcome]}`,
    };
  }
  const played = player.outWeek === null || player.outWeek >= week.number;
  if (week.status === "final" && played && player.outReason?.kind !== "left") {
    return { kind: "missed", label: `${label}: no pick` };
  }
  return { kind: "empty", label: `${label}: nothing to show` };
}

/** The line under a player's name in the grid. */
export function playerStatus(view: SurvivorView, player: SurvivorPlayer): string {
  if (player.winner) return view.winners.length > 1 ? "Shared the title" : "Won the pool";
  if (!player.alive) return outLine(player) ?? "Out";
  const lives = view.settings?.lives ?? 1;
  return lives > 1 ? `Alive · ${player.livesLeft} of ${lives} lives` : "Alive";
}

/** The heading above the pick cards for the signed-in player. */
export function pickHeadline(view: SurvivorView, userId: string): { title: string; detail: string | null } {
  const me = view.players.find((p) => p.userId === userId);
  if (!view.settings) return { title: "No pool this season", detail: null };
  if (view.watching || !me) {
    return {
      title: "You're watching this season",
      detail: "You joined after the pool began. You'll play next season.",
    };
  }
  if (me.winner) {
    return {
      title: view.winners.length > 1 ? "You share the title" : "You won the pool",
      detail: view.winners.length > 1 ? "Still standing after the Super Bowl." : "Last one standing.",
    };
  }
  if (!me.alive) return { title: outLine(me) ?? "You're out", detail: "You can still follow the pool." };
  return { title: "You're still in", detail: null };
}

/** Names, joined: "Pat", "Pat and Sam", "Pat, Sam and Lee". */
export function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** What the recap after a week says: how the player did, who went out, and how many are left. */
export function recapSummary(view: SurvivorView, weekId: string, userId: string) {
  const week = view.weeks.find((w) => w.id === weekId);
  if (week?.status !== "final") return null;
  const name = (id: string) => view.players.find((p) => p.userId === id)?.displayName ?? "Player";
  const me = view.players.find((p) => p.userId === userId);
  const label = weekLabel(week.number);
  const youOut = me?.outWeek === week.number;
  const headline = !me
    ? `${label} is in the books.`
    : youOut
      ? `You went out: ${me.outReason ? survivorReasonText(me.outReason) : "out"}.`
      : me.outWeek !== null && me.outWeek < week.number
        ? `You went out in ${weekLabel(me.outWeek)}.`
        : me.winner
          ? view.winners.length > 1
            ? "You made it through the Super Bowl and share the title."
            : "You're the last one standing. You won the pool."
          : "You're still in.";
  const others = week.out.filter((id) => id !== userId).map(name);
  const wentOut = week.cancelled
    ? `${label} would have put out everyone still in, so nobody went out.`
    : others.length
      ? `${listNames(others)} went out.`
      : youOut
        ? null
        : "Nobody else went out.";
  return {
    title: `${label} is final`,
    headline,
    wentOut,
    left: week.aliveAfter ?? view.players.filter((p) => p.alive).length,
    total: view.players.length,
    /** The player's lives, for the pips, while they are still playing. */
    lives: me?.alive && !view.over ? { left: me.livesLeft, of: view.settings?.lives ?? 1 } : null,
    winners: view.over ? view.winners.map(name) : [],
  };
}

/**
 * The teams `userId` has used before `weekNumber`, each with its week, in the order they were used: from the
 * picks the screen can see (earlier weeks are all revealed, and a player's own always are). The postseason counts
 * only its own weeks, as the rules do.
 */
function usedBefore(view: SurvivorView, userId: string, weekNumber: number) {
  const from = isPostseasonWeek(weekNumber) ? REGULAR_SEASON_WEEKS + 1 : 1;
  const numberOf = new Map(view.weeks.map((w) => [w.id, w.number]));
  return view.picks
    .flatMap((p) => {
      const n = numberOf.get(p.weekId) ?? 0;
      return p.userId === userId && n >= from && n < weekNumber ? [{ team: p.team, weekNumber: n }] : [];
    })
    .sort((a, b) => a.weekNumber - b.weekNumber);
}

/** The teams `userId` has used before `weekNumber` (see `usedBefore`). */
export function usedBy(view: SurvivorView, userId: string, weekNumber: number): Set<string> {
  return new Set(usedBefore(view, userId, weekNumber).map((u) => u.team));
}

/**
 * The week the pool plays next: the one being played, else the week after the last final one (the start week
 * before any is). Null when there is no pool, it is over, or its start week isn't known. Worked out from the
 * weeks every player is sent, the way the rules count them: final weeks in order from the start week.
 */
export function nextSurvivorWeek(
  view: Pick<SurvivorView, "settings" | "over" | "current" | "weeks">,
): number | null {
  if (!view.settings || view.over) return null;
  if (view.current) return view.current.number;
  const start = view.settings.startWeek;
  if (start === null) return null;
  const final = new Set(view.weeks.filter((w) => w.status === "final").map((w) => w.number));
  let next = start;
  while (final.has(next)) next++;
  return next <= LAST_WEEK ? next : null;
}

/**
 * The teams the signed-in player can't pick again, for the "Teams used" tile: the API's list while a week is
 * being played, and between weeks the same list worked out from their own picks, so the tile doesn't read
 * "0 · None yet" while the pool waits for the next slate.
 */
export function teamsUsed(view: SurvivorView, userId: string): { team: string; weekNumber: number }[] {
  if (view.current) return view.current.used;
  return usedBefore(view, userId, nextSurvivorWeek(view) ?? LAST_WEEK + 1);
}

/** A week inside a sentence: "Week 11", "the Wild Card round", "the Super Bowl". */
export const weekInSentence = (number: number) =>
  !isPostseasonWeek(number)
    ? weekLabel(number)
    : number === LAST_WEEK
      ? `the ${weekLabel(number)}`
      : `the ${weekLabel(number)} round`;

const capitalized = (text: string) => `${text[0]?.toUpperCase() ?? ""}${text.slice(1)}`;

/** A day in the league's time zone, as "2026-11-22", for counting days between two moments. */
const dayKey = (at: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    at,
  );

/**
 * When a game kicks off, inside a sentence, in the league's time zone: "today at 8:15 PM EST", "tomorrow at …",
 * "Sunday at 1:00 PM EST" within the coming week, else "Sunday, Nov 29 at 1:00 PM EST".
 */
export function kickoffWhen(iso: string, timeZone: string, now: Date): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
  const days = Math.round(
    (Date.parse(dayKey(at, timeZone)) - Date.parse(dayKey(now, timeZone))) / 86_400_000,
  );
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(at);
  const day =
    days === 0
      ? "today"
      : days === 1
        ? "tomorrow"
        : days > 1 && days < 7
          ? weekday
          : `${weekday}, ${new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(at)}`;
  return `${day} at ${time}`;
}

/**
 * The status card at the top of the Pick tab: whether the signed-in player has anything left to do this week.
 * It always describes what is saved, never an unsaved choice (the save bar says that). Null when the player
 * has no pick to make for another reason (out, watching, the pool over, no week being played): the pool's
 * status card says why.
 * - `needs`: still in, the week open, nothing saved, and a team left to pick.
 * - `set`: a saved pick whose game hasn't kicked off. `locked`: it has, with no result yet.
 * - `won` / `lost`: the saved pick's game has a result (a tie is `lost`), before the week is final.
 * - `missed`: nothing saved and no team left to pick.
 * Before the week is final it says only what is certain (see below).
 */
export type PickBanner = {
  kind: "needs" | "set" | "locked" | "won" | "lost" | "missed";
  title: string;
  detail: string;
};

export function pickBanner(view: SurvivorView, userId: string, now: Date): PickBanner | null {
  const week = currentWeek(view);
  const me = view.players.find((p) => p.userId === userId);
  // The week being played is always an open one: once it is final the pool's status card, worked out by the
  // rules (`survivorStatus`), says how it went, and the banner has nothing to add.
  if (!week || week.status === "final" || !view.current || !me?.alive || view.watching || view.over)
    return null;
  const when = (iso: string) => kickoffWhen(iso, view.timeZone, now);
  const label = weekInSentence(week.number);
  /*
   * Nothing counts until the week is final, so the banner says only what is certain. A loss, tie or missed
   * pick with a life to spare is a strike for sure: that player stays in, so the week can't be one that "would
   * put out everyone still in" (the rule that cancels a week's strikes). On the last life it puts the player
   * out, unless everyone still in goes out too.
   */
  const spare = me.livesLeft > 1;
  const lifeAfter = `You'll have ${me.livesLeft - 1} ${me.livesLeft - 1 === 1 ? "life" : "lives"} left once the week is final.`;
  const lastLife = "You're out when the week is final, unless everyone still in goes out too.";
  const saved = view.current.myPick;
  const game = saved && week.games.find((g) => g.id === saved.gameId);
  if (saved && game) {
    const team = saved.side === "home" ? game.homeTeam : game.awayTeam;
    const other = saved.side === "home" ? game.awayTeam : game.homeTeam;
    const name = teamName(team);
    if (!survivorGameLocked(game, now)) {
      return {
        kind: "set",
        title: `You're all set for ${label}`,
        detail: `You picked the ${name}. You can change it until they kick off ${when(game.kickoff)}.`,
      };
    }
    if (!hasResult(game)) {
      return { kind: "locked", title: `Your pick is in: ${name}`, detail: "Their game is under way." };
    }
    const mine = (saved.side === "home" ? game.homeScore : game.awayScore) ?? 0;
    const theirs = (saved.side === "home" ? game.awayScore : game.homeScore) ?? 0;
    const score = `${name} ${mine}, ${teamName(other)} ${theirs}.`;
    if (mine > theirs) {
      // The pool goes on past this week only if someone else is sure to stay in too: a life to spare, or a
      // pick of theirs already won. Otherwise this week could be the one that ends it, so no next week is named.
      const othersStay = view.players.some(
        (p) =>
          p.alive &&
          p.userId !== userId &&
          (p.livesLeft > 1 ||
            view.picks.some((k) => k.userId === p.userId && k.weekId === week.id && k.outcome === "won")),
      );
      const next = week.number < LAST_WEEK && othersStay ? ` to ${weekInSentence(week.number + 1)}` : "";
      return { kind: "won", title: `${name} won: you're through${next}`, detail: `Final: ${score}` };
    }
    const result = mine === theirs ? "tied" : "lost";
    return spare
      ? { kind: "lost", title: `${name} ${result}: that's a strike`, detail: `${score} ${lifeAfter}` }
      : { kind: "lost", title: `${name} ${result} on your last life`, detail: lastLife };
  }
  const used = new Set(view.current.usedWaived ? [] : view.current.used.map((u) => u.team));
  const pickable = week.games
    .filter((g) => !survivorGameLocked(g, now) && (!used.has(g.homeTeam) || !used.has(g.awayTeam)))
    .sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const next = pickable[0];
  if (!next) {
    return spare
      ? {
          kind: "missed",
          title: `No pick for ${label}: that's a strike`,
          detail: `No team is left for you to pick. ${lifeAfter}`,
        }
      : { kind: "missed", title: `No pick for ${label} on your last life`, detail: lastLife };
  }
  const first = !week.games.some((g) => survivorGameLocked(g, now));
  return {
    kind: "needs",
    title: `Pick a team for ${label}`,
    detail: `${first ? "First" : "Next"} kickoff ${when(next.kickoff)}.`,
  };
}

/** "1 of 2 lives left", for the lives pips. */
export const livesLeftLabel = (left: number, lives: number) =>
  `${left} of ${lives} ${lives === 1 ? "life" : "lives"} left`;

/**
 * The Standings grid's columns for a card `width` wide: whole week columns always (`cell` wide, `visible` of
 * them in view; the scroller snaps to them), with the slack given to the name column (up to 320) when the
 * weeks don't fill the card, then to the cells (up to `maxCell`). `fixed` is the pinned Lives column's width.
 */
export function gridLayout(input: {
  width: number;
  weeks: number;
  name: number;
  fixed: number;
  minCell?: number;
  maxCell?: number;
}): { name: number; cell: number; visible: number } {
  const { width, weeks, fixed, minCell = 56, maxCell = minCell } = input;
  const columns = Math.max(1, weeks);
  const room = width - input.name - fixed;
  const fit = Math.max(1, Math.floor(room / minCell));
  if (columns > fit) return { name: input.name, cell: room / fit, visible: fit };
  const name = Math.max(input.name, Math.min(320, width - fixed - columns * minCell));
  const cell = Math.min(maxCell, Math.max(minCell, (width - fixed - name) / columns));
  return { name, cell, visible: columns };
}

/**
 * What the Pick tab says while no week is being played: which week comes next and what opens it, so the wait
 * isn't a dead end. `standings` asks for a link to Standings (the pool is over).
 */
export function waitingLine(view: SurvivorView): { detail: string; standings: boolean } {
  if (!view.settings) {
    return {
      detail:
        view.role === "admin"
          ? "Start the pool from the League tab."
          : "A commissioner can start the pool from the League tab.",
      standings: false,
    };
  }
  if (view.over) return { detail: "The pool is over. See how it finished on Standings.", standings: true };
  const next = nextSurvivorWeek(view);
  if (next === null) {
    return {
      detail: "The next week opens as soon as its games are on the pro football schedule.",
      standings: false,
    };
  }
  const opens = "as soon as its games are on the pro football schedule";
  // Before the first week is played, say where the pool begins.
  const begun = view.weeks.some((w) => w.status === "final");
  if (!begun && next === view.settings.startWeek) {
    return { detail: `The pool starts with ${weekInSentence(next)}. It opens ${opens}.`, standings: false };
  }
  return { detail: `${capitalized(weekInSentence(next))} opens ${opens}.`, standings: false };
}
