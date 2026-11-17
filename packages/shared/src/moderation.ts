import { z } from "zod";

/*
 * Moderation of what players post: reports, blocks, the screening model's verdicts, mutes and suspensions.
 * None of it ever touches picking: a muted or suspended player still picks, sees standings and joins leagues.
 */

/** Where players reach the people who run the app. Also on the App Store listing. */
export const SUPPORT_EMAIL = "support@pow-pickem.com";

export const REPORT_REASONS = ["harassment", "hate", "sexual", "threat_self_harm", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: "Harassment or bullying",
  hate: "Hate",
  sexual: "Sexual content",
  threat_self_harm: "Threats or self-harm",
  spam: "Spam",
  other: "Something else",
};

export const REPORT_NOTE_MAX = 500;
export const APPEAL_NOTE_MAX = 300;
/** Most reports one player can send in 24 hours, so reporting can't be used to flood the queue. */
export const REPORT_DAILY_LIMIT = 20;
/** Most replies one player can post in a minute, across the app. */
export const REPLY_MINUTE_LIMIT = 10;
/** An account this new gets the tighter limits below. */
export const NEW_ACCOUNT_MS = 24 * 60 * 60_000;
export const NEW_ACCOUNT_THREAD_LIMIT = 2;
export const NEW_ACCOUNT_REPLY_LIMIT = 20;
/** Removals counted against an author: the last 30 days. */
export const STRIKE_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** A removed message's text is kept this long, for appeals, then cleared. */
export const REMOVED_TEXT_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** An open report older than this is flagged in the operator's digest: the target is to act within 24 hours. */
export const REPORT_OVERDUE_MS = 20 * 60 * 60_000;

export const MUTE_DURATIONS = { "24h": 24 * 60 * 60_000, "7d": 7 * 24 * 60 * 60_000 } as const;
export type MuteDuration = keyof typeof MUTE_DURATIONS;
export const MUTE_DURATION_LABELS: Record<MuteDuration, string> = { "24h": "24 hours", "7d": "7 days" };

/** What other players see in place of a message that isn't shown. Old clients show these words as the text. */
export const REMOVED_TEXT = "Message removed";
export const HIDDEN_TEXT = "Hidden while it's reviewed";
export const BLOCKED_TEXT = "Message from a blocked player";

/** The refusals players see, kept in one place so the API and the app say the same thing. */
export const MODERATION_MESSAGES = {
  rejected: "That doesn't meet the league's guidelines.",
  rejectedName: "Choose a different name.",
  suspended: "Posting is turned off for your account.",
  terms: "Agree to the terms to post.",
} as const;

// ---------- Requests ----------

const reason = z.enum(REPORT_REASONS, "Choose a reason");
const note = (max: number) => z.string().trim().max(max).optional();

export const reportSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("post"),
    leagueId: z.uuid(),
    threadId: z.uuid(),
    postId: z.uuid(),
    reason,
    note: note(REPORT_NOTE_MAX),
  }),
  z.object({
    kind: z.literal("display_name"),
    leagueId: z.uuid(),
    userId: z.uuid(),
    reason,
    note: note(REPORT_NOTE_MAX),
  }),
  z.object({ kind: z.literal("league_name"), leagueId: z.uuid(), reason, note: note(REPORT_NOTE_MAX) }),
]);
export type ReportInput = z.infer<typeof reportSchema>;

export const muteDurationSchema = z.enum(["24h", "7d"]);
/**
 * `remove` takes the content down (a name is reset); `dismiss` leaves it up, showing it again if it was hidden.
 * An appeal takes `restore` (put the message back) or `dismiss` (keep it removed).
 */
export const resolveReportSchema = z.object({
  action: z.enum(["remove", "dismiss", "restore"]),
  /** Also mute the author, for this long. */
  mute: muteDurationSchema.optional(),
});
/** Mute for a while, or lift a mute with null. */
export const muteSchema = z.object({ duration: muteDurationSchema.nullable() });
export const suspensionSchema = z.object({
  suspended: z.boolean(),
  note: z.string().trim().max(APPEAL_NOTE_MAX).optional(),
});
export const appealSchema = z.object({ note: note(APPEAL_NOTE_MAX) });

// ---------- Screening ----------

/** The screening model's probability for each answer. */
export type ScreeningScores = { allow: number; block: number };
/** Screening has two outcomes: posted, or refused. Reports and the review queue handle everything in between. */
export type ScreeningVerdict = "allow" | "block";

/**
 * Where the verdict changes. Set from labeled messages with `pnpm moderation:eval`
 * (`apps/api/scripts/moderation-eval.ts`); change it only after running that again.
 */
export const SCREENING_THRESHOLDS = {
  /** At or above: refused when posting. */
  block: 0.7,
  /** At or above on a player's report, checked by the larger model in context: removed without waiting. */
  reportRemove: 0.9,
} as const;

export function screeningVerdict(
  scores: ScreeningScores,
  thresholds: { block: number } = SCREENING_THRESHOLDS,
): ScreeningVerdict {
  return scores.block >= thresholds.block ? "block" : "allow";
}

// ---------- Strikes and mutes ----------

/**
 * What a removal does to its author, given how many of their messages were removed in the last 30 days, this one
 * included: the second mutes them for 24 hours, the third for 7 days and asks the operator about a suspension.
 */
export function strikeConsequence(strikes: number): { mute: MuteDuration; reviewSuspension: boolean } | null {
  if (strikes >= 3) return { mute: "7d", reviewSuspension: true };
  if (strikes === 2) return { mute: "24h", reviewSuspension: false };
  return null;
}

/** The later of two mute ends, ignoring any already over. */
export function activeMute(now: Date, ...until: (Date | null | undefined)[]): Date | null {
  const ends = until.filter((d): d is Date => !!d && d > now).map((d) => d.getTime());
  return ends.length ? new Date(Math.max(...ends)) : null;
}

/** "You're muted for another 3 hours." Rounded up, so it never says "0 hours". */
export function mutedMessage(until: Date, now: Date): string {
  const hours = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 3_600_000));
  if (hours < 48) return `You're muted for another ${hours} ${hours === 1 ? "hour" : "hours"}.`;
  return `You're muted for another ${Math.ceil(hours / 24)} days.`;
}

// ---------- Responses ----------

/** The signed-in player's own moderation state, on `GET /me`. */
export type ModerationStatus = {
  termsAccepted: boolean;
  /** An app-wide mute (strikes or the operator); a league admin's mute shows on that league's threads. */
  mutedUntil: string | null;
  suspended: boolean;
};

/**
 * How a message is shown to the player reading it. `review`: their own message, waiting for review. `hidden`:
 * waiting for review, seen by others as a placeholder (admins still get the text). `removed`: taken down, for
 * everyone. `blocked`: from a player they blocked, collapsed until they choose to show it.
 */
export type PostState = "visible" | "review" | "hidden" | "removed" | "blocked";

export type ReportKind = "post" | "display_name" | "league_name";
export type ReportSource = "player" | "recheck" | "appeal";

/** One item in a moderation queue. Never carries picks or standings. */
export type ReportItem = {
  id: string;
  kind: ReportKind;
  source: ReportSource;
  /** `flagged` for the screening model's flags, `appeal` for an author asking for a review. */
  reason: ReportReason | "flagged" | "appeal";
  note: string | null;
  createdAt: string;
  league: { id: string; name: string } | null;
  /** Null for automatic flags. */
  reporterName: string | null;
  /** Who wrote the message or holds the name; null for a league name. */
  subject: { userId: string; displayName: string } | null;
  post: {
    id: string;
    threadId: string;
    threadTitle: string;
    position: number;
    body: string;
    hidden: boolean;
    removed: boolean;
  } | null;
  /** Other open reports on the same message or name. */
  otherReports: number;
  /** The subject is an admin of the league, so only the operator reviews it. */
  aboutAdmin: boolean;
};

export type ReportQueue = { items: ReportItem[] };

export type BlockedPlayer = { userId: string; displayName: string; blockedAt: string };

/** A player with three or more removals in 30 days, for the operator to decide on a suspension. */
export type RepeatOffender = {
  userId: string;
  displayName: string;
  removals: number;
  mutedUntil: string | null;
  suspended: boolean;
};

export type OperatorReportQueue = ReportQueue & { repeatOffenders: RepeatOffender[] };
