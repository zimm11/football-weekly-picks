import { coveringSide, type ScoredGame, type Side, tiebreakerTotal, type WeekEntry } from "./rules";

/*
 * The week's bragging rights (and the opposite), derived from a scored week. Pure functions: callers pass
 * only final weeks, so nothing here can reveal picks from a week still in play.
 */

/** Fewest picks on a game before being alone on the right side of it counts for anything. */
const LONE_WOLF_MIN_PICKS = 3;

export type WeekAwards = {
  /** User ids of the week's winner(s). */
  winners: string[];
  /** User ids of the Low Point Loser(s). */
  lowPointLosers: string[];
  /** Picked every game and won them all. */
  perfectWeeks: string[];
  /** Guessed the tiebreaker game's total exactly. */
  bullseyes: string[];
  /** The only player on the covering side of a game at least three players picked. */
  loneWolves: { userId: string; gameId: string }[];
};

/**
 * The Low Point Loser (LPL): last place in the week. Lowest points first; players level on points are
 * separated the same way the winner is (games won, then the tiebreaker guess), and whoever is still level
 * shares it. Nobody is the LPL when the whole league finished level.
 */
export function lowPointLosers(entries: WeekEntry[]): string[] {
  const last = Math.max(0, ...entries.map((e) => e.rank));
  return last > 1 ? entries.filter((e) => e.rank === last).map((e) => e.userId) : [];
}

export function weekAwards(input: {
  games: ScoredGame[];
  entries: WeekEntry[];
  picks: { userId: string; gameId: string; side: Side }[];
  tiebreakerGameId: string | null;
}): WeekAwards {
  const { games, entries, picks, tiebreakerGameId } = input;
  const scored = new Set(entries.map((e) => e.userId));
  const actualTotal = tiebreakerTotal(games.find((g) => g.id === tiebreakerGameId));

  const loneWolves: WeekAwards["loneWolves"] = [];
  for (const game of games) {
    const covered = coveringSide(game);
    if (covered !== "home" && covered !== "away") continue;
    const onGame = picks.filter((p) => p.gameId === game.id && scored.has(p.userId));
    const right = onGame.filter((p) => p.side === covered);
    const [wolf] = right;
    if (wolf && right.length === 1 && onGame.length >= LONE_WOLF_MIN_PICKS) {
      loneWolves.push({ userId: wolf.userId, gameId: game.id });
    }
  }

  return {
    winners: entries.filter((e) => e.isWinner).map((e) => e.userId),
    lowPointLosers: lowPointLosers(entries),
    perfectWeeks: entries.filter((e) => games.length > 0 && e.wins === games.length).map((e) => e.userId),
    bullseyes: entries
      .filter((e) => actualTotal !== null && e.tiebreakerGuess === actualTotal)
      .map((e) => e.userId),
    loneWolves,
  };
}
