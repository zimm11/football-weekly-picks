import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  doublePrecision,
  index,
  integer,
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

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const userRef = () =>
  uuid()
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" });

/** What a player is called on leaderboards. */
export const profiles = pgTable("profiles", {
  userId: userRef().primaryKey(),
  displayName: text().notNull(),
  createdAt: createdAt(),
}).enableRLS();

/** A group of players who pick against each other, run by an admin. */
export const leagues = pgTable("leagues", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  /** IANA zone the 6am game-day lock is measured in. */
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
    role: text({ enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    joinedAt: createdAt(),
    /** Set when the admin removes the player. They lose access, but stay in the results of weeks already played. */
    removedAt: timestamp({ withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] }), index("league_members_user_idx").on(t.userId)],
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
    status: text({ enum: ["draft", "open", "final"] })
      .notNull()
      .default("draft"),
    /**
     * The admin's explicit choice of tiebreaker game. Null means "use the default" (the last Monday game, else
     * the last game), worked out from the slate on every read. Players guess this game's total, and it
     * receives automatic POWs.
     */
    tiebreakerGameId: uuid().references((): AnyPgColumn => games.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [unique("weeks_season_number_key").on(t.seasonId, t.number)],
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
  (t) => [index("games_week_idx").on(t.weekId), unique("games_week_external_key").on(t.weekId, t.externalId)],
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
    side: text({ enum: ["home", "away"] }).notNull(),
    /** The player's Pick of the Week. At most one per player per week. */
    isPow: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("picks_game_user_key").on(t.gameId, t.userId),
    index("picks_week_idx").on(t.weekId),
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
  (t) => [primaryKey({ columns: [t.weekId, t.userId] })],
).enableRLS();
