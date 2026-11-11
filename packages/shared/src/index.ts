import { z } from "zod";
import type { SeasonEntry, Side, WeekEntry } from "./rules";
import type { WeekPhase } from "./seasons";
import type { PlayerSeasonStats, WeekSummaryStats } from "./stats";
import { TEAM_ABBRS } from "./teams";
import { isValidTimeZone } from "./time";

export * from "./rules";
export * from "./seasons";
export * from "./stats";
export * from "./teams";
export * from "./time";

/*
 * Shared API contracts, imported by the API, the web app, and (later) the mobile app.
 * Zod schemas validate request bodies; the plain types describe responses.
 */

// ---------- Requests ----------

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name").max(40),
});

export const createLeagueSchema = z.object({
  name: z.string().trim().min(1, "Enter a league name").max(80),
  timeZone: z.string().refine(isValidTimeZone, "Unknown time zone").default("America/New_York"),
});

export const updateLeagueSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a league name").max(80).optional(),
    timeZone: z.string().refine(isValidTimeZone, "Unknown time zone").optional(),
  })
  .refine((v) => v.name !== undefined || v.timeZone !== undefined, "Nothing to change");

export const updateMemberRoleSchema = z.object({ role: z.enum(["admin", "member"]) });

/** Regular season only: the league does not run through the playoffs. */
export const MAX_WEEK = 18;

export const createWeekSchema = z.object({
  year: z.int().min(2020).max(2100),
  number: z.int().min(1).max(MAX_WEEK),
  /** Pull the week's games and spreads from the schedule provider. */
  importGames: z.boolean().default(true),
});

const spreadSchema = z
  .number()
  .min(-60)
  .max(60)
  .refine((n) => Number.isInteger(n * 2), "Spreads go in half-point steps");
const pointsSchema = z.int().min(1).max(20);
const scoreSchema = z.int().min(0).max(200);
const teamSchema = z.enum(TEAM_ABBRS);

export const createGameSchema = z
  .object({
    homeTeam: teamSchema,
    awayTeam: teamSchema,
    kickoff: z.iso.datetime({ offset: true }),
    spread: spreadSchema,
    /** Defaults to the value of the game's time slot. */
    points: pointsSchema.optional(),
  })
  .refine((g) => g.homeTeam !== g.awayTeam, "A team can't play itself");
export type CreateGame = z.infer<typeof createGameSchema>;

export const updateGameSchema = z.object({
  kickoff: z.iso.datetime({ offset: true }).optional(),
  spread: spreadSchema.optional(),
  points: pointsSchema.optional(),
  /** Set both scores to mark the game final; set both to null to clear the result. */
  homeScore: scoreSchema.nullable().optional(),
  awayScore: scoreSchema.nullable().optional(),
});
export type UpdateGame = z.infer<typeof updateGameSchema>;

export const updateWeekSchema = z.object({ tiebreakerGameId: z.uuid() });

export const sideSchema = z.enum(["home", "away"]);

export const submitPicksSchema = z.object({
  picks: z.array(z.object({ gameId: z.uuid(), side: sideSchema })).max(40),
  powGameId: z.uuid().nullable(),
  /** Guess at the combined score of the tiebreaker (Monday night) game. */
  tiebreakerTotal: z
    .int("The tiebreaker guess must be a whole number")
    .min(0, "The tiebreaker guess can't be negative")
    .max(200, "The tiebreaker guess must be 200 or less")
    .nullable(),
});
export type SubmitPicks = z.infer<typeof submitPicksSchema>;

// ---------- Responses ----------

export type Role = "admin" | "member";
export type WeekStatus = "draft" | "open" | "final";

export type Me = { id: string; email?: string; displayName: string | null };

export type LeagueSummary = { id: string; name: string; role: Role };
export type WeekSummary = {
  id: string;
  year: number;
  number: number;
  status: WeekStatus;
  gameCount: number;
  /** How many of the week's games the signed-in player has picked. */
  myPickCount: number;
  phase: WeekPhase;
  /** Unscored games that have not kicked off. */
  availablePickCount: number;
  /** Games where this player can still add or change a pick. */
  myAvailablePickCount: number;
  /** Unpicked games that have not closed yet. */
  myMissingPickCount: number;
};
export type Member = { userId: string; displayName: string; role: Role };

export type LeagueDetail = {
  id: string;
  name: string;
  timeZone: string;
  role: Role;
  /** Only admins see the invite code. */
  inviteCode: string | null;
  members: Member[];
  /** Newest first. Members don't see draft weeks. */
  weeks: WeekSummary[];
};

export type InvitePreview = { leagueId: string; leagueName: string; alreadyMember: boolean };

export type Game = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  /** The home team's line: -3.5 means the home team is favored by 3.5. */
  spread: number | null;
  points: number;
  homeScore: number | null;
  awayScore: number | null;
};

export type Pick = { gameId: string; side: Side; isPow: boolean };

export type WeekResults = {
  /** `removed`: no longer in the league, but played this week. */
  entries: (WeekEntry & { displayName: string; removed: boolean })[];
  picks: { userId: string; gameId: string; side: Side }[];
};

export type WeekView = {
  id: string;
  leagueId: string;
  leagueName: string;
  timeZone: string;
  role: Role;
  year: number;
  number: number;
  status: WeekStatus;
  /** The game in effect: the admin's choice, or the default when they haven't made one. */
  tiebreakerGameId: string | null;
  games: Game[];
  myPicks: Pick[];
  myTiebreakerTotal: number | null;
  /** Admins only: who has picked, without revealing the picks. */
  submissions: { userId: string; displayName: string; pickCount: number; hasPow: boolean }[] | null;
  /** Everyone's picks and scores. Null until the week is final. */
  results: WeekResults | null;
};

export type Standings = {
  years: number[];
  year: number | null;
  /** `removed`: no longer in the league, but played in a counted week. */
  entries: (SeasonEntry & Omit<PlayerSeasonStats, "userId"> & { displayName: string; removed: boolean })[];
  /** Final weeks, in order, with their winner(s). Each entry's `weekly` lines up with this list. */
  weeks: ({ id: string; number: number; winners: string[] } & WeekSummaryStats)[];
};

// ---------- Display helpers ----------

export function weekLabel(number: number): string {
  return `Week ${number}`;
}

/** "PHI -3.5", "PHI +3.5", or "PHI PK" for a team's line. */
export function formatLine(team: string, line: number): string {
  if (line === 0) return `${team} PK`;
  return `${team} ${line > 0 ? "+" : ""}${line}`;
}

/** The line each side gets, from the stored home line. */
export function lineFor(side: Side, spread: number): number {
  return side === "home" ? spread : spread === 0 ? 0 : -spread;
}
