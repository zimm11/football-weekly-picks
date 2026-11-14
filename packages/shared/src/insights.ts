/*
 * Background on a game for the player deciding how to pick it: team form from the schedule provider and
 * prices from a national prediction market. None of it comes from this league's picks.
 */

export type TeamInsights = {
  /** Season record, e.g. "5-3-1". */
  record: string | null;
  /** The home team's record at home, or the away team's record on the road. */
  venueRecord: string | null;
  /** Oldest first. `home` says whether this team was the home side. */
  lastFive: { opponent: string; home: boolean; result: "W" | "L" | "T"; score: string }[];
  injuries: { name: string; position: string | null; status: string; injury: string | null }[];
  /** Season leaders, e.g. { label: "Passing Yards", name: "Jalen Hurts", line: "2,100 YDS, 14 TD" }. */
  leaders: { label: string; name: string; line: string }[];
  news: { headline: string; url: string; published: string }[];
};

export type MatchupInsights = {
  home: TeamInsights;
  away: TeamInsights;
  /** Season averages side by side, e.g. { label: "Points Per Game", home: "24.1", away: "19.8" }. */
  stats: { label: string; home: string; away: string }[];
  /** The posted total for the game's combined score. */
  overUnder: number | null;
  /** The provider's own page for the game. */
  url: string | null;
};

/** Probabilities are 0–1, taken from what contracts are trading at. */
export type MarketInsights = {
  source: "Kalshi";
  /** Chance the home team wins the game outright. */
  homeWin: number | null;
  /**
   * Chance each side beats the league's spread. On a whole-number line the two don't add up to 1:
   * the remainder is the chance of a push.
   */
  cover: { home: number; away: number } | null;
  /** The home team's line at which the market is closest to even, to compare with the league's. */
  spread: number | null;
};

export type GameInsights = {
  /** Null for a game the admin added by hand, or when the provider can't be reached. */
  matchup: MatchupInsights | null;
  /** Null when the market doesn't list the game or can't be reached. */
  market: MarketInsights | null;
};
