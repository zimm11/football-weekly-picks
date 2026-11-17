import {
  type Game,
  hasResult,
  isPostseasonWeek,
  type POSTSEASON_ROUNDS,
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
    winners: view.over ? view.winners.map(name) : [],
  };
}

/**
 * The teams `userId` has used before `weekNumber`, from the picks the screen can see (earlier weeks are all
 * revealed). The postseason counts only its own weeks, as the rules do.
 */
export function usedBy(view: SurvivorView, userId: string, weekNumber: number): Set<string> {
  const from = isPostseasonWeek(weekNumber) ? 19 : 1;
  const numberOf = new Map(view.weeks.map((w) => [w.id, w.number]));
  return new Set(
    view.picks
      .filter((p) => {
        const n = numberOf.get(p.weekId) ?? 0;
        return p.userId === userId && n >= from && n < weekNumber;
      })
      .map((p) => p.team),
  );
}
