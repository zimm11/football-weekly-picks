import { z } from "zod";
import type { Role, WeekStatus } from "./index";
import { hasResult, isLocked, type Side } from "./rules";
import { isPostseasonWeek, LAST_WEEK, REGULAR_SEASON_WEEKS, weekLabel } from "./seasons";
import { teamName } from "./teams";

/*
 * Survivor: each week every player still alive picks one team to win outright; a loss is a strike and no team
 * can be used twice. Its rules go here as pure functions (checkSurvivorPick, survivorStatus). Nobody's status is
 * stored: it is worked out from the final weeks, so a corrected score re-derives everything.
 */

/** The most lives an admin can give a survivor pool. */
export const MAX_SURVIVOR_LIVES = 3;

/**
 * A survivor season's settings (`seasons.settings`). Both are fixed once the start week's first game kicks off.
 * `startWeek` absent means the next week with no kickoff yet, worked out when the season starts.
 */
export const survivorSettingsSchema = z.object({
  lives: z.int().min(1).max(MAX_SURVIVOR_LIVES).default(1),
  startWeek: z.int().min(1).max(18).optional(),
});
export type SurvivorSettings = z.infer<typeof survivorSettingsSchema>;

/**
 * How many games each postseason round has. A postseason week is imported only once the feed lists all of them,
 * since the feed leaves out games whose teams aren't known yet and a survivor week opens as soon as it is
 * imported.
 */
export const POSTSEASON_GAME_COUNTS: Record<number, number> = { 19: 6, 20: 4, 21: 2, 22: 1 };

// ---------- Picks ----------

export type SurvivorGame = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  homeScore: number | null;
  awayScore: number | null;
};

export type SurvivorOutcome = "won" | "lost" | "tie" | "pending";

/** The team a pick backs. */
export const pickedTeam = (game: { homeTeam: string; awayTeam: string }, side: Side) =>
  side === "home" ? game.homeTeam : game.awayTeam;

/** How a pick did, straight up. A tie is its own outcome, and a strike like a loss. */
export function survivorOutcome(
  game: { homeScore: number | null; awayScore: number | null },
  side: Side,
): SurvivorOutcome {
  if (!hasResult(game)) return "pending";
  if (game.homeScore === game.awayScore) return "tie";
  return (side === "home") === game.homeScore > game.awayScore ? "won" : "lost";
}

const lockOf = (game: SurvivorGame) => ({ kickoff: game.kickoff, final: hasResult(game) });
const matchupOf = (game: SurvivorGame) => `${teamName(game.awayTeam)} at ${teamName(game.homeTeam)}`;

/**
 * The teams a player has used before `weekNumber` this season, each with the week it was used in. The used
 * teams reset at the Wild Card round: a postseason week counts only the postseason weeks before it.
 */
export function usedTeams(
  weeks: { id: string; number: number; games: { id: string; homeTeam: string; awayTeam: string }[] }[],
  picks: { weekId: string; userId: string; gameId: string; side: Side }[],
  userId: string,
  weekNumber: number,
): Map<string, number> {
  const from = isPostseasonWeek(weekNumber) ? REGULAR_SEASON_WEEKS + 1 : 1;
  const used = new Map<string, number>();
  for (const week of [...weeks].sort((a, b) => a.number - b.number)) {
    if (week.number < from || week.number >= weekNumber) continue;
    const pick = picks.find((p) => p.weekId === week.id && p.userId === userId);
    const game = pick && week.games.find((g) => g.id === pick.gameId);
    if (pick && game) used.set(pickedTeam(game, pick.side), week.number);
  }
  return used;
}

/**
 * Whether a used team may be picked anyway: on a playoff slate, a player who has used every team still to play
 * this week may pick any of them (it can happen by the Super Bowl).
 */
export function usedTeamsWaived(
  weekNumber: number,
  games: SurvivorGame[],
  used: ReadonlyMap<string, number>,
  now: Date,
) {
  if (!isPostseasonWeek(weekNumber)) return false;
  return !games
    .filter((g) => !isLocked(lockOf(g), now))
    .some((g) => !used.has(g.homeTeam) || !used.has(g.awayTeam));
}

/**
 * Checks one survivor pick against the rules. Returns an error message, or null when the pick may be saved:
 * - one team, straight up, from this week's slate;
 * - a pick can be changed until its team's game kicks off, and only to a team whose game hasn't kicked off;
 * - no team used earlier this season (the used teams reset at the Wild Card round), unless a playoff slate has
 *   no unused team left to play.
 * `player` names someone else when an admin enters the pick for them.
 */
export function checkSurvivorPick(input: {
  weekNumber: number;
  games: SurvivorGame[];
  existing: { gameId: string; side: Side } | null;
  pick: { gameId: string; side: Side };
  used: ReadonlyMap<string, number>;
  now: Date;
  player?: string;
}): string | null {
  const { weekNumber, games, existing, pick, used, now, player } = input;
  const game = games.find((g) => g.id === pick.gameId);
  if (!game) return "That game is not part of this week.";
  if (existing && existing.gameId === pick.gameId && existing.side === pick.side) return null;
  const current = existing && games.find((g) => g.id === existing.gameId);
  if (current && isLocked(lockOf(current), now)) {
    return `${player ? `${player}'s` : "Your"} pick is locked: ${matchupOf(current)} ${hasResult(current) ? "is final" : "has kicked off"}.`;
  }
  if (isLocked(lockOf(game), now)) {
    return `${matchupOf(game)} ${hasResult(game) ? "is final" : "has already kicked off"}.`;
  }
  const team = pickedTeam(game, pick.side);
  const usedIn = used.get(team);
  if (usedIn !== undefined && !usedTeamsWaived(weekNumber, games, used, now)) {
    return `${player ?? "You"} used the ${teamName(team)} in ${weekLabel(usedIn)}.`;
  }
  return null;
}

// ---------- Status ----------

/** Why a player took a strike, or went out. */
export type SurvivorReason = { kind: "lost" | "tie"; team: string } | { kind: "missed" } | { kind: "left" };

/** "Bears lost", "Bears tied", "No pick", "Left the league". */
export function survivorReasonText(reason: SurvivorReason): string {
  switch (reason.kind) {
    case "lost":
      return `${teamName(reason.team)} lost`;
    case "tie":
      return `${teamName(reason.team)} tied`;
    case "missed":
      return "No pick";
    case "left":
      return "Left the league";
  }
}

export type SurvivorWeekInput = { id: string; number: number; status: WeekStatus; games: SurvivorGame[] };
export type SurvivorPickInput = { weekId: string; userId: string; gameId: string; side: Side };
export type SurvivorMember = { userId: string; joinedAt: Date; removedAt: Date | null };

export type SurvivorPlayerStatus = {
  userId: string;
  alive: boolean;
  /** Strikes that count, in week order. A cancelled week's are gone. */
  strikes: { weekNumber: number; reason: SurvivorReason }[];
  livesLeft: number;
  /** The week they went out in, and why; null while alive. */
  outWeek: number | null;
  outReason: SurvivorReason | null;
  winner: boolean;
};

export type SurvivorWeekResult = {
  weekId: string;
  number: number;
  /** The week would have put out everyone still in, so it put out nobody and its strikes were cancelled. */
  cancelled: boolean;
  /** Who went out this week. */
  out: string[];
  /** How many were still in after it. */
  aliveAfter: number;
};

export type SurvivorStatus = {
  /** Who plays this season: every member when the start week began, plus anyone who joined in time to pick it. */
  entrants: string[];
  /** Every entrant: alive first (most lives left first), then the rest by how long they lasted. */
  players: SurvivorPlayerStatus[];
  /** The final weeks counted, in order. */
  weeks: SurvivorWeekResult[];
  lastFinalWeek: number | null;
  over: boolean;
  /** One when a player outlasted everyone; several when they were still in after the Super Bowl. */
  winners: string[];
  /** The week the pool plays next, or null once it is over. */
  nextWeek: number | null;
};

const kickoffs = (games: SurvivorGame[]) => games.map((g) => g.kickoff.getTime());

/**
 * Works a survivor season out from its weeks, picks and membership. Only final weeks count, from the start week
 * on, in order. In each:
 * - a player who has left (not in the league at the week's last kickoff) is out from that week on;
 * - a loss, an NFL tie, or no pick is a strike, and a player is out when their strikes reach the lives;
 * - a week that would put out every player still in puts out nobody, and its strikes are cancelled.
 * One player left after a final week wins; several still in after the Super Bowl share the title.
 *
 * `recorded` is `week_participants` by week id: who was in the league at each final week's last kickoff, the
 * start week included. Without a record, that is worked out from the membership dates.
 */
export function survivorStatus(input: {
  startWeek: number;
  lives: number;
  weeks: SurvivorWeekInput[];
  picks: SurvivorPickInput[];
  members: SurvivorMember[];
  recorded?: ReadonlyMap<string, ReadonlySet<string>>;
}): SurvivorStatus {
  const { startWeek, lives, picks, members, recorded } = input;
  const byNumber = new Map(input.weeks.map((w) => [w.number, w]));
  const memberOf = new Map(members.map((m) => [m.userId, m]));
  const start = byNumber.get(startWeek);
  const entrants = start ? survivorEntrants(start, members, picks, recorded?.get(start.id)) : [];

  const strikes = new Map<string, SurvivorPlayerStatus["strikes"]>(entrants.map((id) => [id, []]));
  const out = new Map<string, { week: number; reason: SurvivorReason }>();
  const results: SurvivorWeekResult[] = [];
  let alive = new Set(entrants);
  let lastFinalWeek: number | null = null;
  let over = false;
  let winners: string[] = [];

  for (let number = startWeek; number <= LAST_WEEK && start; number++) {
    const week = byNumber.get(number);
    if (week?.status !== "final") break;
    const times = kickoffs(week.games);
    const lastKickoff = times.length ? Math.max(...times) : null;
    const inWeek = recorded?.get(week.id);
    const leftBy = (userId: string) => {
      if (lastKickoff === null) return false;
      // The record stands whatever the membership says now, so leaving or rejoining later changes nothing.
      if (inWeek?.size) return !inWeek.has(userId);
      const m = memberOf.get(userId);
      if (!m) return true;
      if (m.removedAt !== null && m.removedAt.getTime() <= lastKickoff) return true;
      // Left and came back: a fresh membership that started after this week doesn't count for it.
      return number !== startWeek && m.joinedAt.getTime() > lastKickoff;
    };

    const leavers = [...alive].filter(leftBy);
    const struck = new Map<string, SurvivorReason>();
    for (const userId of alive) {
      if (leavers.includes(userId)) continue;
      const pick = picks.find((p) => p.weekId === week.id && p.userId === userId);
      const game = pick && week.games.find((g) => g.id === pick.gameId);
      if (!pick || !game) {
        if (week.games.length) struck.set(userId, { kind: "missed" });
        continue;
      }
      const outcome = survivorOutcome(game, pick.side);
      if (outcome === "lost" || outcome === "tie") {
        struck.set(userId, { kind: outcome, team: pickedTeam(game, pick.side) });
      }
    }
    const goingOut = [...struck.keys()].filter((id) => (strikes.get(id)?.length ?? 0) + 1 >= lives);
    const staying = [...alive].filter((id) => !leavers.includes(id) && !goingOut.includes(id));
    const cancelled = staying.length === 0 && goingOut.length > 0;

    const outThisWeek: string[] = [];
    for (const userId of leavers) {
      out.set(userId, { week: number, reason: { kind: "left" } });
      outThisWeek.push(userId);
    }
    if (!cancelled) {
      for (const [userId, reason] of struck) {
        strikes.get(userId)?.push({ weekNumber: number, reason });
        if (goingOut.includes(userId)) {
          out.set(userId, { week: number, reason });
          outThisWeek.push(userId);
        }
      }
    }
    alive = new Set([...alive].filter((id) => !out.has(id)));
    lastFinalWeek = number;
    results.push({ weekId: week.id, number, cancelled, out: outThisWeek, aliveAfter: alive.size });
    if (alive.size <= 1 || number === LAST_WEEK) {
      over = true;
      winners = [...alive];
      break;
    }
  }

  const order = new Map(entrants.map((id, i) => [id, i]));
  const players = entrants
    .map((userId): SurvivorPlayerStatus => {
      const gone = out.get(userId);
      const counted = strikes.get(userId) ?? [];
      return {
        userId,
        alive: !gone,
        strikes: counted,
        livesLeft: gone ? 0 : Math.max(0, lives - counted.length),
        outWeek: gone?.week ?? null,
        outReason: gone?.reason ?? null,
        winner: winners.includes(userId),
      };
    })
    .sort(
      (a, b) =>
        Number(b.alive) - Number(a.alive) ||
        b.livesLeft - a.livesLeft ||
        (b.outWeek ?? 0) - (a.outWeek ?? 0) ||
        (order.get(a.userId) ?? 0) - (order.get(b.userId) ?? 0),
    );
  const nextWeek = over
    ? null
    : lastFinalWeek === null
      ? startWeek
      : lastFinalWeek < LAST_WEEK
        ? lastFinalWeek + 1
        : null;
  return { entrants, players, weeks: results, lastFinalWeek, over, winners, nextWeek };
}

/**
 * Who plays a survivor season: everyone in the league at the start week's last kickoff who joined before it, plus
 * anyone who picked in the start week (so a player who picked and then left is still listed, as out). Once the
 * start week is final, "in the league at its last kickoff" is the week's record (`recorded`), which leaving or
 * rejoining later can't change. With no slate yet, every current member.
 */
export function survivorEntrants(
  start: SurvivorWeekInput,
  members: SurvivorMember[],
  picks: SurvivorPickInput[],
  recorded?: ReadonlySet<string>,
): string[] {
  const picked = new Set(picks.filter((p) => p.weekId === start.id).map((p) => p.userId));
  if (recorded?.size) {
    return members.filter((m) => recorded.has(m.userId) || picked.has(m.userId)).map((m) => m.userId);
  }
  const times = kickoffs(start.games);
  if (!times.length) return members.filter((m) => m.removedAt === null).map((m) => m.userId);
  const last = Math.max(...times);
  return members
    .filter(
      (m) =>
        picked.has(m.userId) ||
        (m.joinedAt.getTime() < last && (m.removedAt === null || m.removedAt.getTime() > last)),
    )
    .map((m) => m.userId);
}

// ---------- Requests and responses ----------

export const survivorPickSchema = z.object({
  gameId: z.uuid(),
  side: z.enum(["home", "away"]),
  /** An admin entering the pick for another player. */
  userId: z.uuid().optional(),
});
export type SurvivorPickRequest = z.infer<typeof survivorPickSchema>;

const survivorScore = z.int().min(0).max(200).nullable();
/** The admin's score correction: both scores, or both null to clear the result of a game still to finish. */
export const survivorScoreSchema = z
  .object({ homeScore: survivorScore, awayScore: survivorScore })
  .refine((s) => (s.homeScore === null) === (s.awayScore === null), "Enter both scores, or neither.");

export type SurvivorGameView = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  homeScore: number | null;
  awayScore: number | null;
};

export type SurvivorView = {
  leagueId: string;
  year: number;
  /** Seasons this league has, newest first. */
  years: number[];
  timeZone: string;
  role: Role;
  /** Null when this year has no pool (an admin can start one). */
  settings: { lives: number; startWeek: number | null } | null;
  /** The start week's first game has kicked off: lives and start week are fixed. */
  started: boolean;
  over: boolean;
  /** The winner, or everyone sharing the title. Empty until the pool is over. */
  winners: string[];
  /** Every entrant: alive first, then the rest by how long they lasted. */
  players: {
    userId: string;
    displayName: string;
    /** No longer in the league. */
    removed: boolean;
    alive: boolean;
    livesLeft: number;
    strikes: number;
    outWeek: number | null;
    outReason: SurvivorReason | null;
    winner: boolean;
  }[];
  /** The season's weeks in order (drafts for admins only), with what happened in each final one. */
  weeks: {
    id: string;
    number: number;
    status: WeekStatus;
    cancelled: boolean;
    out: string[];
    aliveAfter: number | null;
    games: SurvivorGameView[];
  }[];
  /**
   * Picks that have been revealed: another player's once their team's game has kicked off, and your own always.
   * Nothing is said about a pick before then, not even that one exists.
   */
  picks: {
    userId: string;
    weekId: string;
    gameId: string;
    side: Side;
    team: string;
    outcome: SurvivorOutcome;
  }[];
  /** The week being played, with your own pick and the teams you have used, or null between weeks. */
  current: {
    weekId: string;
    number: number;
    myPick: { gameId: string; side: Side; byAdmin: boolean } | null;
    used: { team: string; weekNumber: number }[];
    /** On a playoff slate with no unused team left to play, any team may be picked. */
    usedWaived: boolean;
  } | null;
  /** You're in the league but not in this season's pool (you joined after it began). */
  watching: boolean;
};
