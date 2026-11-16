import { zValidator } from "@hono/zod-validator";
import {
  type Db,
  games,
  leagueMembers,
  leagues,
  picks,
  profiles,
  seasons,
  weekParticipants as weekParticipantRows,
  weeks,
} from "@picks/db";
import type { Member, Role } from "@picks/shared";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { VerifyToken } from "./auth";
import type { InsightsProvider } from "./insights";
import type { NflProvider } from "./nfl";
import type { EmailDeps } from "./outbox";
import type { PushSender } from "./pushSender";

export type PublicConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  /** Set only while a local `CLOCK_OVERRIDE` is active: how far the API's clock is shifted from real time. */
  clockOffsetMs?: number;
};

export type AppDeps = {
  db: Db;
  verifyToken: VerifyToken;
  /** Public config handed to clients at runtime (so the web build needs no baked-in env). */
  publicConfig: PublicConfig;
  /** Source of schedules, spreads and results. */
  nfl: NflProvider;
  /** Source of team stats, news and prediction-market prices. Without one, games carry no insights. */
  insights?: InsightsProvider;
  /** Injected so tests can pin the clock that pick locks are measured against. */
  now?: () => Date;
  /** Notification email. Absent means the API queues and sends none. */
  email?: EmailDeps;
  /** Membership and posting caps; injected so tests can use their own numbers. Defaults to the shared limits. */
  limits?: { membersPerLeague: number; leaguesPerUser: number; threadsPerDay?: number };
  /** Web Push transport. Without one (no VAPID keys), nothing is queued or sent and devices can't subscribe. */
  push?: PushSender;
  /**
   * Runs work after the response is sent: a new thread's emails and notifications. By default it just starts the
   * task. The Worker hands it to the request's `waitUntil` and keeps the request's database connection open until
   * it finishes; tests replace it so they can wait for the work. Tasks catch and log their own errors.
   */
  background?: (task: () => Promise<unknown>) => void;
  /** Accounts that run the app (`OPERATOR_USER_IDS`): they can read feedback and app-wide counts. */
  operatorUserIds?: readonly string[];
};

/** Whether this account runs the app. Decided by user id, which a player cannot change, never by email. */
export const isOperator = (deps: Pick<AppDeps, "operatorUserIds">, userId: string) =>
  deps.operatorUserIds?.includes(userId) ?? false;

type Status = 400 | 403 | 404 | 409 | 429 | 502 | 503;

export function fail(status: Status, message: string): never {
  throw new HTTPException(status, { message });
}

/** Validates a JSON body, answering failures in the API's `{ error }` shape. */
export const body = <T extends z.ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? "Invalid input" }, 400);
  });

/** Validates path parameters. A malformed id names nothing, so it is a 404 like an unknown one. */
export const param = <T extends z.ZodType>(schema: T) =>
  zValidator("param", schema, (result, c) => {
    if (!result.success) return c.json({ error: "Not found" }, 404);
  });

/** Validates the query string, answering failures in the API's `{ error }` shape. */
export const query = <T extends z.ZodType>(schema: T, message?: string) =>
  zValidator("query", schema, (result, c) => {
    if (!result.success) {
      return c.json({ error: message ?? result.error.issues[0]?.message ?? "Invalid input" }, 400);
    }
  });

export const leagueParam = param(z.object({ leagueId: z.uuid() }));
export const weekParam = param(z.object({ weekId: z.uuid() }));
export const gameParam = param(z.object({ gameId: z.uuid() }));

/** A database handle or an open transaction. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Store = Db | Tx;

/**
 * Players need a display name before they create or join a league or post, so nobody shows up as "Player". The
 * web app asks for one before anything else; this holds other clients to the same rule.
 */
export async function requireDisplayName(db: Store, userId: string) {
  const [profile] = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.userId, userId));
  if (!profile) fail(409, "Choose a display name first.");
}

/** Join condition: the user is a current (not removed) member of the joined league. */
const activeMember = (userId: string) =>
  and(
    eq(leagueMembers.leagueId, leagues.id),
    eq(leagueMembers.userId, userId),
    isNull(leagueMembers.removedAt),
  );

/** The caller's role in a league. Non-members get a 404, so league ids don't leak. */
export async function requireMember(db: Db, leagueId: string, userId: string) {
  const [row] = await db
    .select({ league: leagues, role: leagueMembers.role, joinedAt: leagueMembers.joinedAt })
    .from(leagues)
    .innerJoin(leagueMembers, activeMember(userId))
    .where(eq(leagues.id, leagueId));
  if (!row) fail(404, "League not found");
  return row;
}

export function requireAdmin(role: Role) {
  if (role !== "admin") fail(403, "Only the league admin can do that");
}

/** A week with its season, league and the caller's role. Draft weeks are invisible to non-admins. */
export async function requireWeek(db: Db, weekId: string, userId: string) {
  const [row] = await db
    .select({ week: weeks, season: seasons, league: leagues, role: leagueMembers.role })
    .from(weeks)
    .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
    .innerJoin(leagues, eq(leagues.id, seasons.leagueId))
    .innerJoin(leagueMembers, activeMember(userId))
    .where(eq(weeks.id, weekId));
  if (!row || (row.week.status === "draft" && row.role !== "admin")) fail(404, "Week not found");
  return row;
}
export type WeekContext = Awaited<ReturnType<typeof requireWeek>>;

export type MemberRecord = Member & { joinedAt: Date; removedAt: Date | null };

/** Everyone who has ever been in the league, including removed players (needed to score past weeks). */
export async function listMemberRecords(db: Store, leagueId: string): Promise<MemberRecord[]> {
  // Joining order, then name and id for members who joined at the same instant, so the list never
  // reshuffles between reads.
  return db
    .select({
      userId: leagueMembers.userId,
      displayName: sql<string>`coalesce(${profiles.displayName}, 'Player')`,
      role: leagueMembers.role,
      joinedAt: leagueMembers.joinedAt,
      removedAt: leagueMembers.removedAt,
    })
    .from(leagueMembers)
    .leftJoin(profiles, eq(profiles.userId, leagueMembers.userId))
    .where(eq(leagueMembers.leagueId, leagueId))
    .orderBy(
      asc(leagueMembers.joinedAt),
      asc(sql`coalesce(${profiles.displayName}, 'Player')`),
      asc(leagueMembers.userId),
    );
}

export const isActive = (member: MemberRecord) => member.removedAt === null;

/** Current members, in the shape the API returns. */
export const toMember = ({ userId, displayName, role }: MemberRecord): Member => ({
  userId,
  displayName,
  role,
});

/**
 * Who counts in a week's results, so that history doesn't shift when membership does. A week finalized since
 * `week_participants` existed uses the players recorded then (`recorded`). Otherwise it is worked out from the
 * membership history:
 * - a player removed after the week's last kickoff stays in it; one removed earlier drops out;
 * - a player who joined after the week's last kickoff isn't added to it (unless they somehow picked).
 */
export function weekParticipants(
  members: MemberRecord[],
  games: { kickoff: Date }[],
  picks: { userId: string }[],
  recorded?: ReadonlySet<string>,
): MemberRecord[] {
  if (recorded?.size) return members.filter((m) => recorded.has(m.userId));
  if (games.length === 0) return members.filter(isActive);
  const lastKickoff = new Date(Math.max(...games.map((g) => g.kickoff.getTime())));
  const picked = new Set(picks.map((p) => p.userId));
  return members.filter(
    (m) =>
      (m.removedAt === null || m.removedAt > lastKickoff) &&
      (m.joinedAt <= lastKickoff || picked.has(m.userId)),
  );
}

/** The players recorded for each of these weeks when they were finalized. Weeks with none are left out. */
export async function recordedParticipants(db: Store, weekIds: string[]) {
  const byWeek = new Map<string, Set<string>>();
  if (weekIds.length === 0) return byWeek;
  const rows = await db
    .select()
    .from(weekParticipantRows)
    .where(inArray(weekParticipantRows.weekId, weekIds));
  for (const { weekId, userId } of rows) {
    const players = byWeek.get(weekId) ?? new Set<string>();
    players.add(userId);
    byWeek.set(weekId, players);
  }
  return byWeek;
}

/**
 * Records who a week being finalized is scored for, so that leaving or rejoining the league later can't change
 * its results. Finalizing again after a reopen keeps everyone already recorded and adds anyone who now
 * qualifies (say, by picking a game added after the reopen). Nobody is ever dropped.
 */
export async function recordWeekParticipants(db: Store, weekId: string, leagueId: string) {
  const members = await listMemberRecords(db, leagueId);
  const gameRows = await db.select({ kickoff: games.kickoff }).from(games).where(eq(games.weekId, weekId));
  const pickRows = await db.select({ userId: picks.userId }).from(picks).where(eq(picks.weekId, weekId));
  // Worked out from the membership history rather than the record, so that newly qualifying players are found.
  const qualifying = weekParticipants(members, gameRows, pickRows);
  if (qualifying.length === 0) return;
  await db
    .insert(weekParticipantRows)
    .values(qualifying.map((m) => ({ weekId, userId: m.userId })))
    .onConflictDoNothing();
}
