import { NFL_TIME_ZONE, zonedParts } from "./time";

/*
 * The league's rules as pure functions. Everything time-dependent takes `now`.
 *
 * Spreads are stored as the home team's line: -3.5 means the home team is favored by 3.5.
 */

export type Side = "home" | "away";

/** Extra points for winning your Pick of the Week. */
export const POW_BONUS = 5;

// ---------- Point values ----------

export function isMondayGame(kickoff: Date): boolean {
  return zonedParts(kickoff, NFL_TIME_ZONE).weekday === 1;
}

export function isSundayNightGame(kickoff: Date): boolean {
  const p = zonedParts(kickoff, NFL_TIME_ZONE);
  return p.weekday === 0 && p.hour >= 19;
}

function isHoliday(kickoff: Date): boolean {
  const p = zonedParts(kickoff, NFL_TIME_ZONE);
  const thanksgiving = p.month === 11 && p.weekday === 4 && p.day >= 22 && p.day <= 28;
  const christmas = p.month === 12 && p.day === 25;
  return thanksgiving || christmas;
}

/** What a game is worth by its time slot. The admin can override this per game. */
export function defaultPoints(kickoff: Date): number {
  if (isHoliday(kickoff)) return 4;
  const { weekday } = zonedParts(kickoff, NFL_TIME_ZONE);
  if (weekday === 4 || weekday === 1) return 3; // Thursday, Monday
  if (weekday === 0) return isSundayNightGame(kickoff) ? 2 : 1;
  return 2; // Tuesday, Wednesday, Friday, Saturday
}

// ---------- Locks ----------

/** What the lock rules need to know about a game. `final` means a result has been entered. */
export type LockableGame = { kickoff: Date; final: boolean };

/**
 * A game locks at kickoff: until then its pick can be made or changed, and the POW can be put on it, moved
 * off it, or removed. A game with a result is locked whatever the clock says, so nobody can pick a game
 * whose outcome is already recorded (e.g. after the admin enters a score early).
 */
export function isLocked(game: LockableGame, now: Date): boolean {
  return game.final || now >= game.kickoff;
}

export type PickInput = { gameId: string; side: Side };
export type ExistingPick = PickInput & { isPow: boolean };

/**
 * Checks a player's submission against the lock rules.
 * Returns an error message for the first change that isn't allowed, or null if everything is.
 * Picks already saved and not mentioned in `picks` are left alone (a pick can't be withdrawn).
 */
export function checkPickSubmission(input: {
  games: (LockableGame & { id: string; label: string })[];
  existing: ExistingPick[];
  picks: PickInput[];
  powGameId: string | null;
  now: Date;
}): string | null {
  const { games, existing, picks, powGameId, now } = input;
  const gameById = new Map(games.map((g) => [g.id, g]));
  const existingByGame = new Map(existing.map((p) => [p.gameId, p]));
  const closed = (game: LockableGame) => (game.final ? "is final" : "has already kicked off");

  for (const pick of picks) {
    const game = gameById.get(pick.gameId);
    if (!game) return "That game is not part of this week.";
    if (existingByGame.get(pick.gameId)?.side === pick.side) continue;
    if (isLocked(game, now)) return `${game.label} ${closed(game)}.`;
  }

  const currentPow = existing.find((p) => p.isPow)?.gameId ?? null;
  if (powGameId !== currentPow) {
    // A POW whose game has been removed from the slate is free to move.
    const currentGame = currentPow ? gameById.get(currentPow) : undefined;
    if (currentGame && isLocked(currentGame, now)) {
      return `Your POW can't be moved or removed: its game ${closed(currentGame)}.`;
    }
    if (powGameId) {
      const game = gameById.get(powGameId);
      if (!game) return "That game is not part of this week.";
      if (isLocked(game, now)) return `${game.label} can't be your POW: it ${closed(game)}.`;
      if (!existingByGame.has(powGameId) && !picks.some((p) => p.gameId === powGameId)) {
        return `Pick a side in ${game.label} before making it your POW.`;
      }
    }
  }
  return null;
}

/** The tiebreaker guess can be entered or changed until the tiebreaker game locks. */
export function checkTiebreakerGuess(input: {
  tiebreakerGame: LockableGame | null;
  existing: number | null;
  total: number | null;
  now: Date;
}): string | null {
  const { tiebreakerGame, existing, total, now } = input;
  if (total === existing) return null;
  if (!tiebreakerGame) return "This week has no tiebreaker game yet.";
  if (isLocked(tiebreakerGame, now)) {
    return `The tiebreaker game ${tiebreakerGame.final ? "is final" : "has already kicked off"}.`;
  }
  if (total === null) return "A tiebreaker guess can't be removed once it is entered.";
  return null;
}

/**
 * The week's tiebreaker game: the admin's explicit choice if it is still on the slate, otherwise the default.
 * Computed on every read, so the default follows the slate as games are added or removed.
 */
export function effectiveTiebreakerId(
  chosenGameId: string | null,
  games: { id: string; kickoff: Date }[],
): string | null {
  if (chosenGameId && games.some((g) => g.id === chosenGameId)) return chosenGameId;
  return defaultTiebreakerGame(games)?.id ?? null;
}

/** The game that decides tiebreakers: the last Monday game, else the last game. */
export function defaultTiebreakerGame<G extends { id: string; kickoff: Date }>(games: G[]): G | undefined {
  const latest = (list: G[]) =>
    list.reduce<G | undefined>((a, g) => (!a || g.kickoff >= a.kickoff ? g : a), undefined);
  return latest(games.filter((g) => isMondayGame(g.kickoff))) ?? latest(games);
}

// ---------- Scoring ----------

export type ScoredGame = {
  id: string;
  kickoff: Date;
  spread: number | null;
  points: number;
  homeScore: number | null;
  awayScore: number | null;
};

/** Which side beat the spread. `null` until the game has a final score. */
export function coveringSide(game: ScoredGame): Side | "push" | null {
  if (game.homeScore === null || game.awayScore === null) return null;
  const margin = game.homeScore + (game.spread ?? 0) - game.awayScore;
  if (margin === 0) return "push";
  return margin > 0 ? "home" : "away";
}

export type WeekEntry = {
  userId: string;
  points: number;
  wins: number;
  losses: number;
  pushes: number;
  /** The player's chosen POW. Null when they didn't choose one: there is no automatic POW. */
  powGameId: string | null;
  powWon: boolean;
  mondayWins: number;
  sundayNightWins: number;
  tiebreakerGuess: number | null;
  rank: number;
  isWinner: boolean;
};

export type ScoredPick = { userId: string; gameId: string; side: Side; isPow: boolean };

/**
 * Scores one week.
 *
 * - A winning pick earns the game's points; a winning POW earns POW_BONUS more. A push earns nothing.
 * - Only a POW the player chose counts. A player who chose none has no POW that week.
 * - Weekly ranking: points, then games won, then closest tiebreaker guess (on equal distance, the guess that
 *   did not go over wins). Players still level share the rank.
 */
export function scoreWeek(input: {
  games: ScoredGame[];
  picks: ScoredPick[];
  guesses: { userId: string; total: number }[];
  userIds: string[];
  tiebreakerGameId: string | null;
}): WeekEntry[] {
  const { games, picks, guesses, userIds, tiebreakerGameId } = input;
  const gameById = new Map(games.map((g) => [g.id, g]));
  const guessByUser = new Map(guesses.map((g) => [g.userId, g.total]));
  const tiebreakerGame = tiebreakerGameId ? gameById.get(tiebreakerGameId) : undefined;
  const actualTotal =
    tiebreakerGame && tiebreakerGame.homeScore !== null && tiebreakerGame.awayScore !== null
      ? tiebreakerGame.homeScore + tiebreakerGame.awayScore
      : null;

  const entries = userIds.map((userId): WeekEntry => {
    const mine = picks.filter((p) => p.userId === userId && gameById.has(p.gameId));
    const chosenPow = mine.find((p) => p.isPow)?.gameId;
    const entry: WeekEntry = {
      userId,
      points: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      powGameId: chosenPow ?? null,
      powWon: false,
      mondayWins: 0,
      sundayNightWins: 0,
      tiebreakerGuess: guessByUser.get(userId) ?? null,
      rank: 0,
      isWinner: false,
    };
    for (const pick of mine) {
      const game = gameById.get(pick.gameId);
      if (!game) continue;
      const covered = coveringSide(game);
      if (covered === null) continue;
      if (covered === "push") entry.pushes += 1;
      else if (covered !== pick.side) entry.losses += 1;
      else {
        entry.wins += 1;
        entry.points += game.points;
        if (isMondayGame(game.kickoff)) entry.mondayWins += 1;
        if (isSundayNightGame(game.kickoff)) entry.sundayNightWins += 1;
        if (entry.powGameId === game.id) {
          entry.powWon = true;
          entry.points += POW_BONUS;
        }
      }
    }
    return entry;
  });

  const tiebreak = (e: WeekEntry) => {
    if (actualTotal === null || e.tiebreakerGuess === null)
      return { distance: Number.POSITIVE_INFINITY, over: 1 };
    return {
      distance: Math.abs(e.tiebreakerGuess - actualTotal),
      over: e.tiebreakerGuess > actualTotal ? 1 : 0,
    };
  };
  const compare = (a: WeekEntry, b: WeekEntry) => {
    const ta = tiebreak(a);
    const tb = tiebreak(b);
    return (
      b.points - a.points ||
      b.wins - a.wins ||
      (ta.distance === tb.distance ? 0 : ta.distance < tb.distance ? -1 : 1) ||
      ta.over - tb.over
    );
  };
  return rank(entries, compare).map((e) => ({ ...e, isWinner: e.rank === 1 }));
}

export type SeasonEntry = {
  userId: string;
  points: number;
  wins: number;
  losses: number;
  pushes: number;
  powWins: number;
  mondayWins: number;
  sundayNightWins: number;
  weeksWon: number;
  rank: number;
};

/** Season standings: total points, then most POWs won, most wins, most Monday night wins, most Sunday night wins. */
export function seasonStandings(weeks: WeekEntry[][], userIds: string[]): SeasonEntry[] {
  const byUser = new Map(
    userIds.map((userId): [string, SeasonEntry] => [
      userId,
      {
        userId,
        points: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        powWins: 0,
        mondayWins: 0,
        sundayNightWins: 0,
        weeksWon: 0,
        rank: 0,
      },
    ]),
  );
  for (const week of weeks) {
    for (const e of week) {
      const total = byUser.get(e.userId);
      if (!total) continue;
      total.points += e.points;
      total.wins += e.wins;
      total.losses += e.losses;
      total.pushes += e.pushes;
      total.powWins += e.powWon ? 1 : 0;
      total.mondayWins += e.mondayWins;
      total.sundayNightWins += e.sundayNightWins;
      total.weeksWon += e.isWinner ? 1 : 0;
    }
  }
  return rank(
    [...byUser.values()],
    (a, b) =>
      b.points - a.points ||
      b.powWins - a.powWins ||
      b.wins - a.wins ||
      b.mondayWins - a.mondayWins ||
      b.sundayNightWins - a.sundayNightWins,
  );
}

/** Sorts and assigns 1-based ranks; entries the comparator can't separate share a rank. */
function rank<T extends { rank: number }>(entries: T[], compare: (a: T, b: T) => number): T[] {
  const sorted = [...entries].sort(compare);
  let previous: T | undefined;
  return sorted.map((entry, i) => {
    const ranked = { ...entry, rank: previous && compare(previous, entry) === 0 ? previous.rank : i + 1 };
    previous = ranked;
    return ranked;
  });
}
