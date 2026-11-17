import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

/*
 * Source of truth for the database schema.
 * After editing: `pnpm db:generate --name <desc>` → review the SQL in supabase/migrations → `pnpm db:reset`.
 *
 * Every table has RLS enabled with no policies. The API connects as a privileged role and
 * bypasses RLS; this stops clients holding the public publishable key from reading or writing
 * tables directly through Supabase's auto-generated REST API.
 */

/*
 * The values each enum-like text column may hold. `text({ enum })` only types the column in TypeScript, so
 * every such column also gets a CHECK constraint (`oneOf`) built from the same list.
 */
const MEMBER_ROLES = ["admin", "member"] as const;
const WEEK_STATUSES = ["draft", "open", "final"] as const;
const PICK_SIDES = ["home", "away"] as const;
const FEEDBACK_KINDS = ["bug", "feature", "other"] as const;
const FEEDBACK_STATUSES = ["open", "done"] as const;
const NOTIFICATION_KINDS = ["new_thread", "pick_reminder"] as const;
/** Email also carries the operator's moderation alerts and daily digest, which have no push counterpart. */
const EMAIL_KINDS = [...NOTIFICATION_KINDS, "moderation"] as const;
/** The model's verdict on a post. `skipped`: not checked (screening off, or posted before screening existed). */
const SCREENING_VERDICTS = ["allow", "block", "unchecked", "skipped"] as const;
const REPORT_KINDS = ["post", "display_name", "league_name"] as const;
/** Where a report came from: a player, the screening model's recheck of a post saved unchecked, or an appeal. */
const REPORT_SOURCES = ["player", "recheck", "appeal"] as const;
const REPORT_REASONS = [
  "harassment",
  "hate",
  "sexual",
  "threat_self_harm",
  "spam",
  "other",
  "flagged",
  "appeal",
] as const;
const REPORT_STATUSES = ["open", "removed", "dismissed"] as const;
const MODERATION_ACTIONS = [
  "remove",
  "hide",
  "restore",
  "dismiss",
  "mute",
  "unmute",
  "suspend",
  "unsuspend",
  "reset_name",
] as const;
const EMAIL_STATUSES = ["pending", "sending", "sent", "failed", "skipped"] as const;
const PUSH_STATUSES = ["pending", "sent", "skipped", "failed"] as const;

/** A CHECK constraint holding `column` to `values`. The values are fixed identifiers, written into the SQL. */
const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`);

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const userRef = () =>
  uuid()
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" });

/** What a player is called on leaderboards, and which emails they want. */
export const profiles = pgTable("profiles", {
  userId: userRef().primaryKey(),
  displayName: text().notNull(),
  /** Email the player when someone starts a message thread in one of their leagues. */
  emailNewThreads: boolean().notNull().default(true),
  /** Email the player the evening before a game day on which they still have games to pick. */
  emailPickReminders: boolean().notNull().default(true),
  /** When the player agreed to the Terms of use. Posting, replying and reacting need it. */
  termsAcceptedAt: timestamp({ withTimezone: true }),
  /** No posts, replies or reactions anywhere until then: from repeated removals, or the operator. Never limits picking. */
  mutedUntil: timestamp({ withTimezone: true }),
  /** Set by the operator: no posts, replies, reactions or name changes until lifted. Never limits picking. */
  suspendedAt: timestamp({ withTimezone: true }),
  /**
   * When the player deleted their account. The profile stays as "Deleted player" so results from weeks already
   * played keep a name; everything personal is gone, and the account can't sign in or use the API again.
   */
  deletedAt: timestamp({ withTimezone: true }),
  createdAt: createdAt(),
}).enableRLS();

/** A group of players who pick against each other, run by league admins. */
export const leagues = pgTable("leagues", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  /** IANA zone game days and kickoff times are shown in. */
  timeZone: text().notNull().default("America/New_York"),
  /** Anyone holding this code can join. Admins can rotate it. */
  inviteCode: text().notNull().unique(),
  createdAt: createdAt(),
}).enableRLS();

/** Who is in a league, and whether they run it. */
export const leagueMembers = pgTable(
  "league_members",
  {
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: userRef(),
    role: text({ enum: MEMBER_ROLES }).notNull().default("member"),
    joinedAt: createdAt(),
    /** Set when the admin removes the player. They lose access, but stay in the results of weeks already played. */
    removedAt: timestamp({ withTimezone: true }),
    /** A league admin's mute: no posts, replies or reactions in this league until then. Never limits picking. */
    mutedUntil: timestamp({ withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.leagueId, t.userId] }),
    index("league_members_user_idx").on(t.userId),
    oneOf("league_members_role_check", t.role, MEMBER_ROLES),
  ],
).enableRLS();

/** One NFL season of a league. A league keeps its members from year to year. */
export const seasons = pgTable(
  "seasons",
  {
    id: uuid().primaryKey().defaultRandom(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    /** The year the NFL season starts in. */
    year: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("seasons_league_year_key").on(t.leagueId, t.year)],
).enableRLS();

/** One week of a season: the unit players pick, and the admin opens and closes. */
export const weeks = pgTable(
  "weeks",
  {
    id: uuid().primaryKey().defaultRandom(),
    seasonId: uuid()
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    /** Regular-season week, 1–18. */
    number: integer().notNull(),
    /** draft: the admin is setting games and spreads. open: players pick. final: scored, picks revealed. */
    status: text({ enum: WEEK_STATUSES }).notNull().default("draft"),
    /**
     * The admin's explicit choice of tiebreaker game. Null means "use the default" (the last Monday game, else
     * the last game), worked out from the slate on every read. Players guess this game's total.
     */
    tiebreakerGameId: uuid().references((): AnyPgColumn => games.id, { onDelete: "set null" }),
    /**
     * When the admin last closed the week. Null while it isn't final, and for weeks closed before results
     * recaps existed, which never get one.
     */
    finalizedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("weeks_season_number_key").on(t.seasonId, t.number),
    index("weeks_tiebreaker_game_idx").on(t.tiebreakerGameId),
    oneOf("weeks_status_check", t.status, WEEK_STATUSES),
    // Also in the database, from a hand-written migration because Drizzle can't express its delete rule:
    // `weeks_tiebreaker_game_week_fk`, (tiebreaker_game_id, id) → games (id, week_id), ON DELETE SET NULL
    // (tiebreaker_game_id). It keeps the tiebreaker to one of the week's own games.
  ],
).enableRLS();

/** A game on a week's slate, with the spread and point value the league is using for it. */
export const games = pgTable(
  "games",
  {
    id: uuid().primaryKey().defaultRandom(),
    weekId: uuid()
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    /** The schedule provider's id for the game; null for games the admin added by hand. */
    externalId: text(),
    /** Team abbreviation, e.g. "PHI". */
    homeTeam: text().notNull(),
    /** Team abbreviation, e.g. "DAL". */
    awayTeam: text().notNull(),
    kickoff: timestamp({ withTimezone: true }).notNull(),
    /** The home team's line: -3.5 means the home team is favored by 3.5. Null until a line is set. */
    spread: doublePrecision(),
    /** What a correct pick is worth. */
    points: integer().notNull(),
    /** Final score. Null until the game is final; a game with a score is closed to picks. */
    homeScore: integer(),
    /** Final score. Null until the game is final. */
    awayScore: integer(),
    createdAt: createdAt(),
  },
  (t) => [
    index("games_week_idx").on(t.weekId),
    unique("games_week_external_key").on(t.weekId, t.externalId),
    // Lets picks and the tiebreaker point at (game, week) pairs, so a pick can't claim another week's game.
    unique("games_id_week_key").on(t.id, t.weekId),
  ],
).enableRLS();

/** A player's pick of one side of one game. */
export const picks = pgTable(
  "picks",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Denormalized from the game so "one POW per player per week" can be a unique index. */
    weekId: uuid()
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    gameId: uuid()
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: userRef(),
    /** The team picked to beat the spread. */
    side: text({ enum: PICK_SIDES }).notNull(),
    /** The player's Pick of the Week. At most one per player per week. */
    isPow: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("picks_game_user_key").on(t.gameId, t.userId),
    // The pick save and the week view read one player's picks for a week.
    index("picks_week_user_idx").on(t.weekId, t.userId),
    index("picks_user_idx").on(t.userId),
    oneOf("picks_side_check", t.side, PICK_SIDES),
    // The denormalized week must be the game's own. It cascades like the single-column key on `gameId`, so
    // removing a game never depends on which of the two keys Postgres checks first.
    foreignKey({
      name: "picks_game_week_fk",
      columns: [t.gameId, t.weekId],
      foreignColumns: [games.id, games.weekId],
    }).onDelete("cascade"),
    uniqueIndex("picks_one_pow_per_week").on(t.weekId, t.userId).where(sql`${t.isPow}`),
  ],
).enableRLS();

/** A player's guess at the combined score of the week's tiebreaker game. */
export const tiebreakerGuesses = pgTable(
  "tiebreaker_guesses",
  {
    weekId: uuid()
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    userId: userRef(),
    /** Guessed combined points of both teams. */
    total: integer().notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.weekId, t.userId] }), index("tiebreaker_guesses_user_idx").on(t.userId)],
).enableRLS();

/**
 * Who a closed week is scored for, recorded when it is finalized: everyone in the league at its last kickoff,
 * plus anyone who picked. Later membership changes (leaving, rejoining) never change it. Finalizing again after
 * a reopen only adds players; nobody is dropped. Weeks finalized before this table existed have no rows and are
 * worked out from the membership history instead.
 */
export const weekParticipants = pgTable(
  "week_participants",
  {
    weekId: uuid()
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    userId: userRef(),
  },
  (t) => [primaryKey({ columns: [t.weekId, t.userId] }), index("week_participants_user_idx").on(t.userId)],
).enableRLS();

/**
 * A player has been shown a closed week's results recap. It counts only if it is no older than the week's
 * `finalizedAt`, so a week reopened and closed again is recapped again.
 */
export const weekRecapViews = pgTable(
  "week_recap_views",
  {
    weekId: uuid()
      .notNull()
      .references(() => weeks.id, { onDelete: "cascade" }),
    userId: userRef(),
    seenAt: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.weekId, t.userId] }), index("week_recap_views_user_idx").on(t.userId)],
).enableRLS();

/** A league-wide conversation, independent of the selected season. */
export const messageThreads = pgTable(
  "message_threads",
  {
    id: uuid().primaryKey().defaultRandom(),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    authorId: userRef(),
    title: text().notNull(),
    /** Admin-pinned announcements appear before other conversations. */
    pinned: boolean().notNull().default(false),
    /** Sequential post count; also the unread watermark. Updated under a row lock. */
    version: integer().notNull().default(1),
    createdAt: createdAt(),
    updatedAt: createdAt(),
  },
  (t) => [
    index("message_threads_league_idx").on(t.leagueId, t.updatedAt),
    index("message_threads_author_idx").on(t.authorId),
  ],
).enableRLS();

/** The opening message and subsequent replies, ordered within a thread. */
export const messagePosts = pgTable(
  "message_posts",
  {
    id: uuid().primaryKey().defaultRandom(),
    threadId: uuid()
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    authorId: userRef(),
    body: text().notNull(),
    /** Optional original message quoted by this reply; the API restricts it to the same thread. */
    quotedPostId: uuid().references((): AnyPgColumn => messagePosts.id, { onDelete: "set null" }),
    position: integer().notNull(),
    /** The screening model's verdict when it was posted (or rechecked). */
    screening: text({ enum: SCREENING_VERDICTS }).notNull().default("skipped"),
    /** The model's probabilities for allow and block, kept for tuning the threshold. */
    screeningScores: jsonb().$type<{ allow: number; block: number }>(),
    /** Waiting for review: other players see a placeholder, the author and admins still see the text. */
    hiddenAt: timestamp({ withTimezone: true }),
    /**
     * Removed by a moderator or automatically: everyone sees "Message removed" in its place. The row stays so
     * positions, unread counts and quotes still line up; the text is cleared 30 days later.
     */
    removedAt: timestamp({ withTimezone: true }),
    /** Who removed it. Null when automation did, or once that account is deleted. */
    removedBy: uuid().references(() => authUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("message_posts_thread_position_key").on(t.threadId, t.position),
    index("message_posts_author_idx").on(t.authorId, t.createdAt),
    index("message_posts_quoted_post_idx").on(t.quotedPostId),
    index("message_posts_removed_by_idx").on(t.removedBy),
    index("message_posts_unchecked_idx").on(t.createdAt).where(sql`${t.screening} = 'unchecked'`),
    index("message_posts_removed_idx").on(t.removedAt).where(sql`${t.removedAt} is not null`),
    oneOf("message_posts_screening_check", t.screening, SCREENING_VERDICTS),
  ],
).enableRLS();

/** A player's emoji on a message; each emoji can be added once and removed independently. */
export const messageReactions = pgTable(
  "message_reactions",
  {
    postId: uuid()
      .notNull()
      .references(() => messagePosts.id, { onDelete: "cascade" }),
    userId: userRef(),
    emoji: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.userId, t.emoji] }),
    index("message_reactions_user_idx").on(t.userId),
  ],
).enableRLS();

/** Highest post actually viewed by a player; older tabs cannot move it backwards. */
export const messageReads = pgTable(
  "message_reads",
  {
    threadId: uuid()
      .notNull()
      .references(() => messageThreads.id, { onDelete: "cascade" }),
    userId: userRef(),
    version: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] }), index("message_reads_user_idx").on(t.userId)],
).enableRLS();

/**
 * One item in the moderation queue: a player's report of a message, a display name or a league name; a flag from
 * the screening model's recheck of a post saved while it was down; or an author's appeal against a removal or mute. League admins review their league's
 * items, except those about admins, which only the operator sees.
 */
export const contentReports = pgTable(
  "content_reports",
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text({ enum: REPORT_KINDS }).notNull(),
    /** What the report is about, e.g. `post:<id>`, `name:<userId>` or `league:<id>`; one open report per reporter. */
    targetKey: text().notNull(),
    /** The reported message, for `post` reports. */
    postId: uuid().references(() => messagePosts.id, { onDelete: "cascade" }),
    /** Who wrote the message or holds the name. Null for a league name. */
    subjectUserId: uuid().references(() => authUsers.id, { onDelete: "cascade" }),
    /** The league it was reported in. Null for a display name flagged when it was saved. */
    leagueId: uuid().references(() => leagues.id, { onDelete: "cascade" }),
    /** Who reported it. Null for automatic flags; for an appeal, the author appealing. */
    reporterId: uuid().references(() => authUsers.id, { onDelete: "cascade" }),
    source: text({ enum: REPORT_SOURCES }).notNull(),
    reason: text({ enum: REPORT_REASONS }).notNull(),
    /** The reporter's (or appealing author's) own words, if any. */
    note: text(),
    /** open: waiting for review. removed: the content was taken down. dismissed: it stays. */
    status: text({ enum: REPORT_STATUSES }).notNull().default("open"),
    createdAt: createdAt(),
    resolvedAt: timestamp({ withTimezone: true }),
    /** Who resolved it. Null while open, when automation did, or once that account is deleted. */
    resolvedBy: uuid().references(() => authUsers.id, { onDelete: "set null" }),
  },
  (t) => [
    index("content_reports_open_idx").on(t.status, t.createdAt),
    index("content_reports_target_idx").on(t.targetKey),
    index("content_reports_post_idx").on(t.postId),
    index("content_reports_subject_idx").on(t.subjectUserId),
    index("content_reports_league_idx").on(t.leagueId),
    index("content_reports_reporter_idx").on(t.reporterId, t.createdAt),
    index("content_reports_resolved_by_idx").on(t.resolvedBy),
    uniqueIndex("content_reports_one_open_per_reporter")
      .on(t.targetKey, t.reporterId)
      .where(sql`${t.status} = 'open' and ${t.reporterId} is not null`),
    uniqueIndex("content_reports_one_open_flag")
      .on(t.targetKey)
      .where(sql`${t.status} = 'open' and ${t.reporterId} is null`),
    oneOf("content_reports_kind_check", t.kind, REPORT_KINDS),
    oneOf("content_reports_source_check", t.source, REPORT_SOURCES),
    oneOf("content_reports_reason_check", t.reason, REPORT_REASONS),
    oneOf("content_reports_status_check", t.status, REPORT_STATUSES),
    check("content_reports_post_check", sql`(${t.kind} = 'post') = (${t.postId} is not null)`),
  ],
).enableRLS();

/**
 * A player has blocked another: one-way and app-wide. The blocker no longer sees the blocked player's threads,
 * replies or reactions, and gets no notifications about their threads. Picks and standings are untouched.
 */
export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: userRef(),
    blockedId: userRef(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("user_blocks_blocked_idx").on(t.blockedId),
    check("user_blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`),
  ],
).enableRLS();

/** Append-only log of every moderation action, by a person or automatically. */
export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: uuid().primaryKey().defaultRandom(),
    action: text({ enum: MODERATION_ACTIONS }).notNull(),
    /** The message acted on, if any. */
    postId: uuid().references(() => messagePosts.id, { onDelete: "set null" }),
    /** The player acted on: the author, or the muted or suspended player. */
    userId: uuid().references(() => authUsers.id, { onDelete: "cascade" }),
    leagueId: uuid().references(() => leagues.id, { onDelete: "cascade" }),
    /** Who did it. Null when automation did, or once that account is deleted. */
    actorId: uuid().references(() => authUsers.id, { onDelete: "set null" }),
    reportId: uuid().references(() => contentReports.id, { onDelete: "set null" }),
    /** A short reason, from the moderator or the rule that acted. */
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("moderation_actions_user_idx").on(t.userId, t.createdAt),
    index("moderation_actions_created_idx").on(t.createdAt),
    index("moderation_actions_post_idx").on(t.postId),
    index("moderation_actions_league_idx").on(t.leagueId),
    index("moderation_actions_actor_idx").on(t.actorId),
    index("moderation_actions_report_idx").on(t.reportId),
    oneOf("moderation_actions_action_check", t.action, MODERATION_ACTIONS),
  ],
).enableRLS();

/** A bug report, feature request or note a player sent to the people who run the app. Read on the operator screen. */
export const feedback = pgTable(
  "feedback",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Who sent it. Null once that account is deleted; the report is kept. */
    userId: uuid().references(() => authUsers.id, { onDelete: "set null" }),
    kind: text({ enum: FEEDBACK_KINDS }).notNull(),
    message: text().notNull(),
    /** The app path the player was on when they opened the form, e.g. "/leagues/<id>/standings". */
    page: text(),
    /** The browser's user agent, to help reproduce a bug. */
    userAgent: text(),
    /** open: not dealt with yet. done: the operator has handled it. */
    status: text({ enum: FEEDBACK_STATUSES }).notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [
    index("feedback_user_created_idx").on(t.userId, t.createdAt),
    oneOf("feedback_kind_check", t.kind, FEEDBACK_KINDS),
    oneOf("feedback_status_check", t.status, FEEDBACK_STATUSES),
  ],
).enableRLS();
/** `listUnsubscribeUrl` is absent only on the operator's moderation emails, which players never receive. */
export type OutboxMessage = { subject: string; html: string; text: string; listUnsubscribeUrl?: string };

/**
 * Emails waiting to be sent, and a short history of those that were. Rows are queued with their content
 * already rendered; the address is looked up at send time from `auth.users`, so it is never copied here.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: userRef(),
    kind: text({ enum: EMAIL_KINDS }).notNull(),
    /** Identifies the email's purpose (e.g. `thread:<id>:<user>`) so a retried or repeated job never queues it twice. */
    dedupeKey: text().notNull().unique(),
    /** Rendered message: subject, HTML and plain-text bodies, and the one-click unsubscribe URL for its headers. */
    message: jsonb().$type<OutboxMessage>().notNull(),
    /** pending → sending → sent; or failed (gave up), or skipped (no address, opted out, or too late to be useful). */
    status: text({ enum: EMAIL_STATUSES }).notNull().default("pending"),
    attempts: integer().notNull().default(0),
    /** When a pending row may next be tried; also when a `sending` claim is considered abandoned. */
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** After this the email is no longer worth sending and is skipped. */
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    /** A known error code from the last failed attempt (never provider prose). */
    lastError: text(),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("email_outbox_due_idx").on(t.status, t.nextAttemptAt),
    index("email_outbox_user_idx").on(t.userId),
    oneOf("email_outbox_kind_check", t.kind, EMAIL_KINDS),
    oneOf("email_outbox_status_check", t.status, EMAIL_STATUSES),
  ],
).enableRLS();

/**
 * Notification emails handed to Cloudflare Email Sending per UTC day. The API reserves a slot here before every
 * send and stops at its daily and monthly limits, a safety cap against runaway sending. Auth's own emails don't
 * pass through the API and aren't counted here.
 */
export const emailUsage = pgTable("email_usage", {
  /** The UTC calendar day. */
  day: date({ mode: "string" }).primaryKey(),
  /** Sends reserved that day. A send the provider refused is given back. */
  sent: integer().notNull().default(0),
}).enableRLS();

/** A browser/device explicitly opted into push for one player. Endpoints and keys are private capabilities. */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: userRef(),
    /** Delivery protocol. Existing browser subscriptions keep the web default. */
    transport: text({ enum: ["web", "expo"] })
      .notNull()
      .default("web"),
    /** Supported browser push URL or Expo push token; never returned to other players or logged. */
    endpoint: text().notNull().unique(),
    /** Web Push encryption key; empty for Expo devices. */
    p256dh: text().notNull(),
    /** Web Push encryption secret; empty for Expo devices. */
    auth: text().notNull(),
    /** Preferences apply to this device, independently of the player's other devices. */
    newThreads: boolean().notNull().default(true),
    pickReminders: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index("push_subscriptions_user_idx").on(t.userId),
    oneOf("push_subscriptions_transport_check", t.transport, ["web", "expo"]),
  ],
).enableRLS();

/** Durable per-device delivery queue. Unique event keys prevent repeated cron calls from queuing twice. */
export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    id: uuid().primaryKey().defaultRandom(),
    subscriptionId: uuid()
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    leagueId: uuid()
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    threadId: uuid().references(() => messageThreads.id, { onDelete: "cascade" }),
    weekId: uuid().references(() => weeks.id, { onDelete: "cascade" }),
    kind: text({ enum: NOTIFICATION_KINDS }).notNull(),
    /** Thread id or week id + local game date, scoped to subscription by the unique index. */
    eventKey: text().notNull(),
    /** Game ids are rechecked for missing picks immediately before a reminder is sent. */
    gameIds: text().array().notNull().default(sql`'{}'::text[]`),
    status: text({ enum: PUSH_STATUSES }).notNull().default("pending"),
    attempts: integer().notNull().default(0),
    /** Accepted Expo ticket awaiting its APNs/FCM receipt; prevents resending while polling. */
    nativeReceiptId: text(),
    nextAttemptAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("push_delivery_event_key").on(t.subscriptionId, t.kind, t.eventKey),
    index("push_delivery_due_idx").on(t.status, t.nextAttemptAt),
    // Cascades from leagues, threads and weeks, and the 30-day cleanup, would otherwise scan the table.
    index("push_delivery_league_idx").on(t.leagueId),
    index("push_delivery_thread_idx").on(t.threadId),
    index("push_delivery_week_idx").on(t.weekId),
    index("push_delivery_created_idx").on(t.createdAt),
    oneOf("push_deliveries_kind_check", t.kind, NOTIFICATION_KINDS),
    oneOf("push_deliveries_status_check", t.status, PUSH_STATUSES),
  ],
).enableRLS();
