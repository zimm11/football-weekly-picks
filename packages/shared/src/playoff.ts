import { z } from "zod";
import {
  coveringSide,
  isLocked,
  type ScoredGame,
  type ScoredPick,
  scoreWeek,
  tiebreakerTotal,
  type WeekEntry,
} from "./rules";
import { openingThursday } from "./seasons";
import { NFL_TIME_ZONE, zonedTimeToUtc } from "./time";

/*
 * Playoff pick'em: the weekly game over the four postseason rounds (weeks 19–22), with one champion after the
 * Super Bowl. Its rules go here as pure functions (roundPoints, guillotineStatus, playoffStandings), the way
 * rules.ts holds the weekly ones. Everything time-dependent takes `now`.
 */

export const PLAYOFF_FORMATS = ["traditional", "guillotine"] as const;
export type PlayoffFormat = (typeof PLAYOFF_FORMATS)[number];

/** A playoff season's settings (`seasons.settings`). The format can't change after the first Wild Card kickoff. */
export const playoffSettingsSchema = z.object({
  format: z.enum(PLAYOFF_FORMATS).default("traditional"),
});
export type PlayoffSettings = z.infer<typeof playoffSettingsSchema>;

/** Extra points for a winning POW, by format. Weekly pick'em's is `POW_BONUS` in rules.ts. */
export const PLAYOFF_POW_BONUS: Record<PlayoffFormat, number> = { traditional: 3, guillotine: 1 };

/**
 * Whether a round has a POW. The Super Bowl doesn't: with one game, a POW would be no choice, only extra points
 * on the same pick, and in Guillotine there is no round after it to be put out of.
 */
export const roundHasPow = (number: number) => number !== SUPER_BOWL_ROUND;

/** What a winning POW adds in `round`: the format's bonus, or nothing in the Super Bowl. */
export const roundPowBonus = (format: PlayoffFormat, round: number) =>
  roundHasPow(round) ? PLAYOFF_POW_BONUS[format] : 0;

export const PLAYOFF_FORMAT_INFO: Record<PlayoffFormat, { name: string; description: string }> = {
  traditional: {
    name: "Traditional",
    description:
      "A Pick of the Week is optional each round before the Super Bowl. A winning one adds 3 points.",
  },
  guillotine: {
    name: "Guillotine",
    description:
      "A Pick of the Week every round before the Super Bowl. Lose it, or skip it, and you're out of picking.",
  },
};

// ---------- Rounds ----------

/** The rounds on the 1–22 week line: Wild Card, Divisional, Conference, Super Bowl. */
export const PLAYOFF_ROUNDS = [19, 20, 21, 22] as const;
export const WILD_CARD_ROUND = 19;
export const SUPER_BOWL_ROUND = 22;

/** What a winning pick is worth in each round. An admin can change a round's values before its first kickoff. */
export const ROUND_POINTS: Record<number, number> = { 19: 1, 20: 2, 21: 3, 22: 4 };

/** How many games each round has, once the feed lists them all with real teams. */
export const PLAYOFF_ROUND_GAMES: Record<number, number> = { 19: 6, 20: 4, 21: 2, 22: 1 };

export const isPlayoffRound = (number: number) => number >= WILD_CARD_ROUND && number <= SUPER_BOWL_ROUND;

/** A playoff round's points for a winning pick, whatever the game's time slot. */
export function roundPoints(number: number): number {
  const points = ROUND_POINTS[number];
  if (points === undefined) throw new Error(`Week ${number} isn't a playoff round`);
  return points;
}

/** The request body that creates a round by hand (the fallback when the feed fails). */
export const createPlayoffRoundSchema = z.object({
  year: z.int().min(2020).max(2100),
  number: z.int().min(WILD_CARD_ROUND).max(SUPER_BOWL_ROUND),
  /** Pull the round's games and spreads from the schedule provider. */
  importGames: z.boolean().default(true),
});

/**
 * When to start asking the feed for the Wild Card round: once the regular season's Week 18 is under way. The NFL
 * starts Week 1 on the Thursday after Labor Day (the first Monday of September), so Week 18's Sunday is 17 weeks
 * and 3 days later. Polling starts at 00:00 Eastern on that Sunday; the round is created once the feed lists all
 * six games with real teams, which is after the last Week 18 game.
 */
export function wildCardPollingStarts(year: number): Date {
  // Week 1's Thursday, + 17 weeks and 3 more days: Week 18's Sunday.
  return zonedTimeToUtc(year, 9, openingThursday(year) + 17 * 7 + 3, 0, NFL_TIME_ZONE);
}

// ---------- Guillotine ----------

/** One round as the guillotine reads it: its games, and the picks of the players being judged. */
export type GuillotineRound = { number: number; games: ScoredGame[]; picks: ScoredPick[] };

export type GuillotineStatus = {
  userId: string;
  /** in: still picking. out: out of picking from the round after `outIn`. */
  state: "in" | "out";
  /** The round whose POW put the player out (they pick nothing from the next round on). */
  outIn: number | null;
  /** Why: their POW lost, or they had none when the round's last game kicked off. */
  reason: "pow_lost" | "no_pow" | null;
};

/**
 * Who the guillotine has put out of picking, from the rounds given (in any order). In each of rounds 19–21:
 * - a losing POW puts the player out from the next round; a push or a win keeps them in;
 * - no POW once the round's last game has kicked off (or every game has a result) puts them out too, which is
 *   also where a player who joined after a round locked ends up;
 * - a POW whose game has no result yet decides nothing yet.
 * The Super Bowl puts nobody out: there is no round after it. Elimination never takes points away, and picks
 * already made in the round that put a player out still score.
 *
 * Privacy is the caller's: pass a player their own picks from every round, but other players' only from final
 * rounds, so the other players learn who is out when the round is final. (A league's admins see each pick once its
 * game has locked, in the week view's results so far, so they can tell sooner from the locked POWs.)
 */
export function guillotineStatus(input: {
  rounds: GuillotineRound[];
  userIds: string[];
  now: Date;
}): GuillotineStatus[] {
  const rounds = [...input.rounds]
    .filter((r) => r.number < SUPER_BOWL_ROUND && r.games.length > 0)
    .sort((a, b) => a.number - b.number);
  return input.userIds.map((userId) => {
    for (const round of rounds) {
      const pow = round.picks.find(
        (p) => p.userId === userId && p.isPow && round.games.some((g) => g.id === p.gameId),
      );
      if (pow) {
        const game = round.games.find((g) => g.id === pow.gameId);
        const covered = game ? coveringSide(game) : null;
        if (covered !== null && covered !== "push" && covered !== pow.side) {
          return { userId, state: "out", outIn: round.number, reason: "pow_lost" };
        }
      } else if (
        round.games.every((g) => isLocked({ kickoff: g.kickoff, final: coveringSide(g) !== null }, input.now))
      ) {
        return { userId, state: "out", outIn: round.number, reason: "no_pow" };
      }
    }
    return { userId, state: "in", outIn: null, reason: null };
  });
}

/** Whether a player may pick in `round`: still in, or put out by this round itself (they finish it). */
export const mayPickRound = (status: Pick<GuillotineStatus, "outIn"> | null, round: number) =>
  !status || status.outIn === null || status.outIn >= round;

/** "In", or "Out: Divisional" (the round that put them out), for the standings' status column. */
export function guillotineLabel(
  status: Pick<GuillotineStatus, "state" | "outIn">,
  label: (n: number) => string,
) {
  return status.state === "out" && status.outIn !== null ? `Out: ${label(status.outIn)}` : "In";
}

// ---------- Standings ----------

/** A final round as the standings read it. */
export type PlayoffRound = {
  number: number;
  games: ScoredGame[];
  picks: ScoredPick[];
  guesses: { userId: string; total: number }[];
  /** Who the round is scored for (`week_participants`). */
  userIds: string[];
  tiebreakerGameId: string | null;
};

export type PlayoffEntry = {
  userId: string;
  points: number;
  wins: number;
  losses: number;
  pushes: number;
  powWins: number;
  /** Their guess at the Super Bowl's combined score. Shown once the Super Bowl round is final. */
  superBowlGuess: number | null;
  rank: number;
  /** Rank 1 once the Super Bowl is final. Players still level share the title. */
  champion: boolean;
  /** Guillotine only: in or out, from the final rounds. */
  status: GuillotineStatus | null;
};

/**
 * One round scored: each participant's points, wins and POW (scoreWeek with the round's POW bonus). A POW saved
 * on a Super Bowl pick before the round lost its POW counts as a plain pick.
 */
export function scoreRound(round: PlayoffRound, format: PlayoffFormat): WeekEntry[] {
  const hasPow = roundHasPow(round.number);
  return scoreWeek({
    games: round.games,
    picks: hasPow ? round.picks : round.picks.map((p) => ({ ...p, isPow: false })),
    guesses: round.guesses,
    userIds: round.userIds,
    tiebreakerGameId: round.tiebreakerGameId,
    powBonus: roundPowBonus(format, round.number),
  });
}

/**
 * The overall table, from final rounds only (so it reveals nothing still in play). Most points, then most games
 * won, then the closest guess at the Super Bowl's combined score (on equal distance, the guess that didn't go
 * over). Players still level share the place, and after the Super Bowl the title. Survival in Guillotine doesn't
 * decide the title: if nobody survives to the Super Bowl, the points already earned do.
 */
export function playoffStandings(input: {
  rounds: PlayoffRound[];
  /** The players in the table: current members plus anyone since removed who played a counted round. */
  userIds: string[];
  format: PlayoffFormat;
  now: Date;
}): PlayoffEntry[] {
  const { rounds, userIds, format, now } = input;
  const superBowl = rounds.find((r) => r.number === SUPER_BOWL_ROUND);
  const superBowlTotal = superBowl
    ? tiebreakerTotal(superBowl.games.find((g) => g.id === superBowl.tiebreakerGameId) ?? superBowl.games[0])
    : null;
  const statuses =
    format === "guillotine"
      ? new Map(guillotineStatus({ rounds, userIds, now }).map((s) => [s.userId, s]))
      : null;
  const entries = userIds.map(
    (userId): PlayoffEntry => ({
      userId,
      points: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      powWins: 0,
      superBowlGuess: superBowl?.guesses.find((g) => g.userId === userId)?.total ?? null,
      rank: 0,
      champion: false,
      status: statuses?.get(userId) ?? null,
    }),
  );
  const byUser = new Map(entries.map((e) => [e.userId, e]));
  for (const round of rounds) {
    for (const e of scoreRound(round, format)) {
      const total = byUser.get(e.userId);
      if (!total) continue;
      total.points += e.points;
      total.wins += e.wins;
      total.losses += e.losses;
      total.pushes += e.pushes;
      total.powWins += e.powWon ? 1 : 0;
    }
  }
  const guess = (e: PlayoffEntry) =>
    superBowlTotal === null || e.superBowlGuess === null
      ? { distance: Number.POSITIVE_INFINITY, over: 1 }
      : {
          distance: Math.abs(e.superBowlGuess - superBowlTotal),
          over: e.superBowlGuess > superBowlTotal ? 1 : 0,
        };
  const compare = (a: PlayoffEntry, b: PlayoffEntry) => {
    const ga = guess(a);
    const gb = guess(b);
    return (
      b.points - a.points ||
      b.wins - a.wins ||
      (ga.distance === gb.distance ? 0 : ga.distance < gb.distance ? -1 : 1) ||
      ga.over - gb.over
    );
  };
  const sorted = [...entries].sort(compare);
  let previous: PlayoffEntry | undefined;
  return sorted.map((entry, i) => {
    const rank = previous && compare(previous, entry) === 0 ? previous.rank : i + 1;
    previous = { ...entry, rank };
    return { ...previous, champion: superBowlTotal !== null && rank === 1 };
  });
}

// ---------- Responses ----------

/** `GET /leagues/:id/playoff/standings`: the overall table and each player's status. */
export type PlayoffStandingsView = {
  years: number[];
  year: number | null;
  format: PlayoffFormat;
  /** Final rounds, in order. */
  rounds: { id: string; number: number }[];
  entries: (PlayoffEntry & { displayName: string; avatarId?: number | null; removed: boolean })[];
  /** Display names of the champion(s), once the Super Bowl is final. */
  champions: string[];
  /** The Super Bowl's combined score, once it is final. */
  superBowlTotal: number | null;
};

/** What the pick sheet of a playoff round adds (`WeekView.playoff`). */
export type PlayoffWeekInfo = {
  format: PlayoffFormat;
  /** Guillotine only: the viewer's own status, from their own picks (their POW result shows as soon as it ends). */
  me: GuillotineStatus | null;
  /** False for a player the guillotine put out in an earlier round: the sheet is read-only but the Super Bowl guess. */
  mayPick: boolean;
  /** False in the Super Bowl round, which has no POW (`roundHasPow`). Optional for older API responses. */
  pow?: boolean;
};
