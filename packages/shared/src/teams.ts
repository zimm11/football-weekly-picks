/** NFL teams, keyed by the abbreviation the schedule provider (ESPN) uses. */
export const NFL_TEAMS = {
  ARI: "Cardinals",
  ATL: "Falcons",
  BAL: "Ravens",
  BUF: "Bills",
  CAR: "Panthers",
  CHI: "Bears",
  CIN: "Bengals",
  CLE: "Browns",
  DAL: "Cowboys",
  DEN: "Broncos",
  DET: "Lions",
  GB: "Packers",
  HOU: "Texans",
  IND: "Colts",
  JAX: "Jaguars",
  KC: "Chiefs",
  LAC: "Chargers",
  LAR: "Rams",
  LV: "Raiders",
  MIA: "Dolphins",
  MIN: "Vikings",
  NE: "Patriots",
  NO: "Saints",
  NYG: "Giants",
  NYJ: "Jets",
  PHI: "Eagles",
  PIT: "Steelers",
  SEA: "Seahawks",
  SF: "49ers",
  TB: "Buccaneers",
  TEN: "Titans",
  WSH: "Commanders",
} as const satisfies Record<string, string>;

export type TeamAbbr = keyof typeof NFL_TEAMS;
export const TEAM_ABBRS = Object.keys(NFL_TEAMS) as TeamAbbr[];

/** "Eagles" for "PHI"; falls back to the abbreviation for anything unknown (e.g. Pro Bowl sides). */
export function teamName(abbr: string): string {
  return (NFL_TEAMS as Record<string, string>)[abbr] ?? abbr;
}

/**
 * A team's logo from ESPN's image CDN, in the variant drawn for dark backgrounds. ESPN resizes it on
 * request, so a 28px logo is a few kilobytes rather than the 500px original. The abbreviations are ESPN's
 * own (they come from its schedule feed), so they map straight onto its file names.
 */
export function teamLogoUrl(abbr: string, size: number): string {
  // Twice the drawn size, so it stays sharp on a phone's high-density screen.
  const px = size * 2;
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500-dark/${abbr.toLowerCase()}.png&h=${px}&w=${px}`;
}
