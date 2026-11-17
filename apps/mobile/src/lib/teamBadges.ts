import type { TeamAbbr } from "@picks/shared";

/**
 * The app's own team badges: a roundel in the team's colors holding a generic glyph for the team or its city.
 * They are deliberately not the teams' logos. Colors are facts anyone may use; a team's mark is its owner's, so
 * no glyph here copies one (no star for Dallas, no horseshoe for Indianapolis, no fleur-de-lis for New Orleans).
 * Keep it that way when changing one: pick a common object, drawn by Phosphor or by us, never a tracing.
 *
 * `fill` is the disc, `glyph` the picture on it and `ring` an optional rim in a second team color, which also
 * keeps a dark disc visible on the app's navy cards. Hues are sometimes a step lighter or deeper than the team's
 * own so the glyph still reads at 20px (`teamBadges.test.ts` holds the contrast floor).
 */
export type TeamGlyph =
  | "airplane"
  | "anchor"
  | "axe"
  | "bell"
  | "bird"
  | "buildings"
  | "bull"
  | "cactus"
  | "cat"
  | "cheese"
  | "claws"
  | "cowboy-hat"
  | "crown"
  | "dog"
  | "feather"
  | "flag"
  | "flame"
  | "hammer"
  | "horse"
  | "lightning"
  | "medal"
  | "mountains"
  | "music"
  | "palm"
  | "paw"
  | "pickaxe"
  | "skull"
  | "snowflake"
  | "spiral"
  | "sword";

export type TeamBadge = { glyph: TeamGlyph; fill: string; color: string; ring?: string };

const badge = (glyph: TeamGlyph, fill: string, color: string, ring?: string): TeamBadge => ({
  glyph,
  fill,
  color,
  ring,
});

export const TEAM_BADGES: Record<TeamAbbr, TeamBadge> = {
  ARI: badge("cactus", "#97233F", "#FFFFFF", "#FFB612"),
  ATL: badge("bird", "#101820", "#E0263C", "#C8102E"),
  // A quill, for Baltimore's poet and his raven.
  BAL: badge("feather", "#241773", "#FFFFFF", "#B8962A"),
  BUF: badge("snowflake", "#00338D", "#FFFFFF", "#C60C30"),
  CAR: badge("cat", "#101820", "#0085CA", "#0085CA"),
  CHI: badge("paw", "#0B162A", "#E64100", "#C83803"),
  CIN: badge("claws", "#FB4F14", "#101820"),
  CLE: badge("dog", "#311D00", "#FF3C00", "#FF3C00"),
  DAL: badge("cowboy-hat", "#041E42", "#B0B7BC", "#869397"),
  DEN: badge("mountains", "#FB4F14", "#002244", "#FFFFFF"),
  DET: badge("crown", "#0076B6", "#FFFFFF", "#B0B7BC"),
  GB: badge("cheese", "#203731", "#FFB612", "#FFB612"),
  HOU: badge("bull", "#03202F", "#FFFFFF", "#A71930"),
  IND: badge("horse", "#002C5F", "#FFFFFF", "#A2AAAD"),
  JAX: badge("cat", "#006778", "#F0C24B", "#D7A22A"),
  KC: badge("flame", "#E31837", "#FFD35C", "#FFB81C"),
  LAC: badge("lightning", "#0073B5", "#FFC20E", "#FFC20E"),
  // A ram's horn is a spiral.
  LAR: badge("spiral", "#003594", "#FFD100", "#FFD100"),
  LV: badge("skull", "#101820", "#A5ACAF", "#A5ACAF"),
  MIA: badge("palm", "#008E97", "#FFFFFF", "#FC4C02"),
  MIN: badge("axe", "#4F2683", "#FFC62F", "#FFC62F"),
  NE: badge("flag", "#002244", "#B0B7BC", "#C60C30"),
  NO: badge("music", "#101820", "#D3BC8D", "#D3BC8D"),
  NYG: badge("buildings", "#0B2265", "#FFFFFF", "#A71930"),
  NYJ: badge("airplane", "#125740", "#FFFFFF", "#FFFFFF"),
  PHI: badge("bell", "#004C54", "#A5ACAF", "#A5ACAF"),
  PIT: badge("hammer", "#101820", "#FFB612", "#FFB612"),
  SEA: badge("bird", "#002244", "#69BE28", "#69BE28"),
  SF: badge("pickaxe", "#AA0000", "#C9B074", "#B3995D"),
  TB: badge("anchor", "#D50A0A", "#1C1A17", "#FF7900"),
  TEN: badge("sword", "#0C2340", "#4B92DB", "#C8102E"),
  WSH: badge("medal", "#5A1414", "#FFB612", "#FFB612"),
};

/** The team's badge, or nothing for a side that isn't one of the 32 (a Pro Bowl side, a team typed by hand). */
export function teamBadge(abbr: string): TeamBadge | undefined {
  return Object.hasOwn(TEAM_BADGES, abbr) ? TEAM_BADGES[abbr as TeamAbbr] : undefined;
}
