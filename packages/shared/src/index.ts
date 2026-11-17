import { z } from "zod";
import type { ModerationStatus, PostState } from "./moderation";
import type { SeasonEntry, Side, WeekEntry } from "./rules";
import type { WeekPhase } from "./seasons";
import type { PlayerSeasonStats, WeekSummaryStats } from "./stats";
import { TEAM_ABBRS } from "./teams";
import { canonicalTimeZone, MAX_TIME_ZONE_LENGTH } from "./time";

export * from "./accounts";
export * from "./awards";
export * from "./insights";
export * from "./moderation";
export * from "./operator";
export * from "./reminders";
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

/*
 * Longest text a player can save. Everything below is screened by the moderation model before it is saved
 * (`apps/api/src/screening.ts`), which is paid per token, so these also bound what one post can cost.
 */
export const DISPLAY_NAME_MAX = 40;
export const LEAGUE_NAME_MAX = 80;
export const THREAD_TITLE_MAX = 120;
/** A thread's first message or a reply. */
export const MESSAGE_BODY_MAX = 2000;

const tooLong = (what: string, max: number) =>
  `Keep the ${what} to ${max.toLocaleString("en-US")} characters or fewer.`;

/** Line breaks, tabs and the other control characters, plus Unicode's own line and paragraph separators. */
const CONTROL_CHARACTERS = /[\p{Cc}\u2028\u2029]/u;

/**
 * A name or title: one line of text. These end up in email subjects, notification titles and table cells, so
 * a line break in one is never wanted, and in a subject it would be a way to forge headers.
 */
const singleLine = (what: string, max: number, empty: string) =>
  z
    .string()
    .trim()
    .min(1, empty)
    .max(max, tooLong(what, max))
    .refine((value) => !CONTROL_CHARACTERS.test(value), "Use a single line of text.");

/** Collapses anything `singleLine` would refuse into spaces, for text stored before that rule. */
export const toSingleLine = (text: string) =>
  text.replace(new RegExp(`${CONTROL_CHARACTERS.source}+`, "gu"), " ").trim();

export const updateProfileSchema = z.object({
  displayName: singleLine("name", DISPLAY_NAME_MAX, "Enter a name"),
  /** Agrees to the Terms of use at the same time, as the first name step does. */
  acceptTerms: z.literal(true).optional(),
});

/** Most active players a league can have, admins included. */
export const MAX_LEAGUE_MEMBERS = 100;
/** Most leagues one player can be an active member of, whether they created or joined them. */
export const MAX_LEAGUES_PER_USER = 25;

/** Which notification emails a player wants. Omitted fields are left as they are. */
export const updateNotificationsSchema = z
  .object({ newThreads: z.boolean(), pickReminders: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type NotificationSettings = { newThreads: boolean; pickReminders: boolean };

/** One-click unsubscribe, from a link in a notification email. */
export const unsubscribeSchema = z.object({ token: z.string().min(1).max(512) });
export type UnsubscribeResult = { kind: "new_thread" | "pick_reminder" };

/** A time zone, stored in its canonical spelling (see `canonicalTimeZone`). */
const timeZoneSchema = z
  .string()
  .max(MAX_TIME_ZONE_LENGTH, "Unknown time zone")
  .transform((timeZone, ctx) => {
    const canonical = canonicalTimeZone(timeZone);
    if (canonical) return canonical;
    ctx.addIssue({ code: "custom", message: "Unknown time zone" });
    return z.NEVER;
  });

export const createLeagueSchema = z.object({
  name: singleLine("league name", LEAGUE_NAME_MAX, "Enter a league name"),
  timeZone: timeZoneSchema.default("America/New_York"),
});

export const updateLeagueSchema = z
  .object({
    name: singleLine("league name", LEAGUE_NAME_MAX, "Enter a league name").optional(),
    timeZone: timeZoneSchema.optional(),
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

/** `isOperator` is true for the accounts that run the app; it unlocks the operator screen. */
export type Me = {
  id: string;
  email?: string;
  displayName: string | null;
  isOperator: boolean;
  notifications: NotificationSettings;
  moderation: ModerationStatus;
};

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
  /** Same as `availablePickCount` now that picks stay changeable until kickoff; kept for clients that read it. */
  myAvailablePickCount: number;
  /** Unpicked games that have not closed yet. */
  myMissingPickCount: number;
};
export type Member = {
  userId: string;
  displayName: string;
  role: Role;
  /** The signed-in player has blocked this member. */
  blocked?: boolean;
  /** Admins only: this member's mute in this league, if one is running. */
  mutedUntil?: string | null;
};

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
  /** The most recently finalized week whose results this player hasn't been shown yet, if any. */
  recapWeekId: string | null;
  /** Admins only: open moderation reports they can review in this league. Null for members. */
  openReports?: number | null;
};

export type InvitePreview = {
  leagueId: string;
  leagueName: string;
  alreadyMember: boolean;
  /** The league has reached its player limit, so the invite can't be used right now. */
  full: boolean;
};

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
  weeks: ({
    id: string;
    number: number;
    winners: string[];
    /** Display names of the week's Low Point Loser(s). */
    lowPointLosers: string[];
  } & WeekSummaryStats)[];
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

export const createThreadSchema = z.object({
  title: singleLine("title", THREAD_TITLE_MAX, "Enter a title"),
  body: z
    .string()
    .trim()
    .min(1, "Enter a message")
    .max(MESSAGE_BODY_MAX, tooLong("message", MESSAGE_BODY_MAX)),
});
export const replySchema = createThreadSchema.pick({ body: true }).extend({
  quotedPostId: z.uuid().optional(),
});
export const pinThreadSchema = z.object({ pinned: z.boolean() });
export const readThreadSchema = z.object({ version: z.int().min(1) });
export const MESSAGE_REACTIONS = [
  { emoji: "👍", label: "Like" },
  { emoji: "😂", label: "Laugh" },
  { emoji: "🔥", label: "Fire" },
  { emoji: "🎉", label: "Celebrate" },
  { emoji: "😮", label: "Wow" },
  { emoji: "🙏", label: "Thanks" },
  { emoji: "🏈", label: "Football" },
] as const;
type MessageReactionEmoji = (typeof MESSAGE_REACTIONS)[number]["emoji"];
export const messageReactionSchema = z.object({
  emoji: z.enum(MESSAGE_REACTIONS.map((r) => r.emoji) as [MessageReactionEmoji, ...MessageReactionEmoji[]]),
  active: z.boolean(),
});
export type MessageEmoji = z.infer<typeof messageReactionSchema>["emoji"];
export type MessageReaction = { emoji: MessageEmoji; count: number; reacted: boolean };
export type MessageThread = {
  pinned: boolean;
  id: string;
  title: string;
  authorName: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  unread: boolean;
};
export type MessageQuote = { id: string; authorName: string; body: string; state?: PostState };
export type MessagePost = {
  quote: MessageQuote | null;
  reactions: MessageReaction[];
  id: string;
  /** A placeholder (`REMOVED_TEXT`, `HIDDEN_TEXT`) when the reader may not see the text. */
  body: string;
  authorName: string;
  authorId: string;
  /** How to show it to this reader. */
  state: PostState;
  /** Written by the signed-in player. */
  mine: boolean;
  position: number;
  createdAt: string;
  /** The author of a removed message can ask once for it to be reviewed again. */
  canAppeal: boolean;
};
export type ThreadDetail = {
  id: string;
  title: string;
  version: number;
  pinned: boolean;
  canPin: boolean;
  canDelete: boolean;
  /** League admins can hide, remove and restore single messages. */
  canModerate: boolean;
  /** Why the signed-in player can't post or react here right now (a mute, a suspension), or null. */
  postingBlocked: string | null;
  /** The player hasn't agreed to the terms yet, so the app asks before their first post. */
  needsTerms: boolean;
  posts: MessagePost[];
};

export * from "./messages";
export * from "./push";
