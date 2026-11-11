import {
  coveringSide,
  type ScoredGame,
  type ScoredPick,
  type Side,
  seasonStandings,
  type WeekEntry,
} from "./rules";

/*
 * Season analytics, derived from scored weeks. Pure functions: callers pass only final weeks,
 * so nothing here can reveal picks from a week still in play.
 */

export type Record3 = { wins: number; losses: number; pushes: number };

/** How a player did on each kind of pick. A pick'em game (spread 0) counts as neither favorite nor underdog. */
export type PickSplits = { favorite: Record3; underdog: Record3; home: Record3; away: Record3 };

/** One player's result in one final week. Null in a player's list for a week they weren't part of. */
export type WeeklyResult = { points: number; rank: number; isWinner: boolean };

export type PlayerSeasonStats = {
  userId: string;
  /** One slot per final week, in week order. */
  weekly: (WeeklyResult | null)[];
  powLosses: number;
  powPushes: number;
  splits: PickSplits;
  /** Places moved in the season table since the week before the latest one: +2 means up two. Null in week one. */
  rankChange: number | null;
};

export type WeekSummaryStats = {
  topPoints: number | null;
  averagePoints: number | null;
};

export type StatsWeek = {
  games: ScoredGame[];
  picks: ScoredPick[];
  entries: WeekEntry[];
};

const emptyRecord = (): Record3 => ({ wins: 0, losses: 0, pushes: 0 });

/** Share of decided picks won, 0–1; null with nothing decided. Pushes don't count either way. */
export function winRate(r: { wins: number; losses: number }): number | null {
  const decided = r.wins + r.losses;
  return decided === 0 ? null : r.wins / decided;
}

/** Which side of a game was favored, from the stored home line. Null for a pick'em. */
export function favoredSide(spread: number | null): Side | null {
  if (!spread) return null;
  return spread < 0 ? "home" : "away";
}

function tally(record: Record3, outcome: "win" | "loss" | "push") {
  if (outcome === "win") record.wins += 1;
  else if (outcome === "loss") record.losses += 1;
  else record.pushes += 1;
}

export function weekSummary(entries: WeekEntry[]): WeekSummaryStats {
  if (entries.length === 0) return { topPoints: null, averagePoints: null };
  const points = entries.map((e) => e.points);
  return {
    topPoints: Math.max(...points),
    averagePoints: points.reduce((a, b) => a + b, 0) / points.length,
  };
}

/** Per-player analytics for a season: week-by-week results, POW record, pick splits, and movement. */
export function seasonStats(weeks: StatsWeek[], userIds: string[]): PlayerSeasonStats[] {
  const byUser = new Map(
    userIds.map((userId): [string, PlayerSeasonStats] => [
      userId,
      {
        userId,
        weekly: [],
        powLosses: 0,
        powPushes: 0,
        splits: {
          favorite: emptyRecord(),
          underdog: emptyRecord(),
          home: emptyRecord(),
          away: emptyRecord(),
        },
        rankChange: null,
      },
    ]),
  );

  for (const week of weeks) {
    const entryOf = new Map(week.entries.map((e) => [e.userId, e]));
    const gameById = new Map(week.games.map((g) => [g.id, g]));
    for (const stats of byUser.values()) {
      const entry = entryOf.get(stats.userId);
      stats.weekly.push(entry ? { points: entry.points, rank: entry.rank, isWinner: entry.isWinner } : null);
      if (!entry?.powGameId) continue;
      const pow = gameById.get(entry.powGameId);
      const powPick = week.picks.find((p) => p.userId === stats.userId && p.gameId === entry.powGameId);
      const covered = pow ? coveringSide(pow) : null;
      if (!powPick || covered === null) continue;
      if (covered === "push") stats.powPushes += 1;
      else if (covered !== powPick.side) stats.powLosses += 1;
    }
    for (const pick of week.picks) {
      const stats = byUser.get(pick.userId);
      const game = gameById.get(pick.gameId);
      // Only players scored in the week count, matching the standings.
      if (!stats || !game || !entryOf.has(pick.userId)) continue;
      const covered = coveringSide(game);
      if (covered === null) continue;
      const outcome = covered === "push" ? "push" : covered === pick.side ? "win" : "loss";
      tally(stats.splits[pick.side], outcome);
      const favored = favoredSide(game.spread);
      if (favored) tally(stats.splits[favored === pick.side ? "favorite" : "underdog"], outcome);
    }
  }

  if (weeks.length >= 2) {
    const rankOf = (ws: StatsWeek[]) =>
      new Map(
        seasonStandings(
          ws.map((w) => w.entries),
          userIds,
        ).map((e) => [e.userId, e.rank]),
      );
    const before = rankOf(weeks.slice(0, -1));
    const now = rankOf(weeks);
    for (const stats of byUser.values()) {
      const a = before.get(stats.userId);
      const b = now.get(stats.userId);
      stats.rankChange = a !== undefined && b !== undefined ? a - b : null;
    }
  }

  return userIds.map((id) => byUser.get(id) as PlayerSeasonStats);
}
