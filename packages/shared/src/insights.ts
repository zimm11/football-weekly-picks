/*
 * Background on a game for the player deciding how to pick it: team form, news and a win prediction from the
 * schedule provider. None of it comes from this league's picks.
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
  /**
   * ESPN's Matchup Predictor: each team's chance (0–1) of winning outright, from its pregame simulations.
   * The two needn't add up to 1; the rest is the chance of a tie. Null when ESPN publishes none, as for a
   * finished game.
   */
  prediction: { home: number; away: number } | null;
  /** The provider's own page for the game. */
  url: string | null;
};

export type GameInsights = {
  /** Null for a game the admin added by hand, or when the provider can't be reached. */
  matchup: MatchupInsights | null;
};
