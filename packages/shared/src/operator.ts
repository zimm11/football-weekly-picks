import { z } from "zod";

/*
 * Feedback players send to the people who run the app, and the operator screen that reads it.
 * An operator is an account named in the API's `OPERATOR_USER_IDS`; it is not a league role.
 */

export const FEEDBACK_KINDS = ["bug", "feature", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  bug: "Bug",
  feature: "Feature request",
  other: "Something else",
};
export type FeedbackStatus = "open" | "done";

export const FEEDBACK_MAX_LENGTH = 4000;
/** Most reports one player can send in 24 hours. */
export const FEEDBACK_DAILY_LIMIT = 5;

/** Paths only: no query strings, fragments, invite capabilities or external destinations. */
export const feedbackPageSchema = z
  .string()
  .max(200)
  .regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/)
  .refine((path) => !path.startsWith("/join/") && path !== "/feedback");

export const sendFeedbackSchema = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(1, "Enter a message").max(FEEDBACK_MAX_LENGTH),
  /** The app path the player was on before opening the form. */
  page: feedbackPageSchema.optional(),
});
export type SendFeedback = z.infer<typeof sendFeedbackSchema>;

export const updateFeedbackSchema = z.object({ status: z.enum(["open", "done"]) });

export const FEEDBACK_PAGE_SIZE = 50;
export const feedbackQuerySchema = z.object({ before: z.uuid().optional() });
export type FeedbackPage = { items: FeedbackItem[]; nextCursor: string | null };

export type FeedbackItem = {
  id: string;
  kind: FeedbackKind;
  message: string;
  status: FeedbackStatus;
  page: string | null;
  userAgent: string | null;
  createdAt: string;
  /** Null when the sender's account has since been deleted. */
  author: { displayName: string | null; email: string | null } | null;
};

/** A running total with how much of it arrived recently. */
export type GrowthCount = { total: number; last7Days: number; last30Days: number };

/** One Monday-to-Sunday week (UTC) of activity. */
export type OperatorWeek = {
  /** The Monday the week starts on, as `YYYY-MM-DD`. */
  weekStart: string;
  signups: number;
  leaguesCreated: number;
  /** Picks first made that week. */
  picks: number;
  /** Players who made at least one pick that week. */
  players: number;
};

export type OperatorLeague = {
  id: string;
  name: string;
  createdAt: string;
  /** Current members; removed players are not counted. */
  members: number;
  /** When a pick in this league was last saved, if ever. */
  lastPickAt: string | null;
};

export type OperatorSignup = {
  email: string | null;
  displayName: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  /** Leagues they are currently in. */
  leagues: number;
};

/**
 * App-wide numbers for the operator. Counts only: it never carries a player's picks, so the rule that
 * picks stay private until a week is final still holds.
 */
export type OperatorOverview = {
  generatedAt: string;
  accounts: GrowthCount;
  leagues: GrowthCount;
  picks: GrowthCount;
  messages: GrowthCount;
  /** Players who saved a pick or posted a message in the last 7 and 30 days. */
  activePlayers: { last7Days: number; last30Days: number };
  /** Leagues where someone saved a pick in the last 7 days. */
  activeLeagues: number;
  openFeedback: number;
  /** Most recent week first. */
  weeks: OperatorWeek[];
  recentLeagues: OperatorLeague[];
  recentSignups: OperatorSignup[];
};
