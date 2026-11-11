import { zValidator } from "@hono/zod-validator";
import { type Db, leagueMembers, leagues, profiles, seasons, weeks } from "@picks/db";
import type { Member, Role } from "@picks/shared";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { VerifyToken } from "./auth";
import type { NflProvider } from "./nfl";

export type AppDeps = {
  db: Db;
  verifyToken: VerifyToken;
  /** Public config handed to clients at runtime (so the web build needs no baked-in env). */
  publicConfig: { supabaseUrl: string; supabasePublishableKey: string };
  /** Source of schedules, spreads and results. */
  nfl: NflProvider;
  /** Injected so tests can pin the clock that pick locks are measured against. */
  now?: () => Date;
};

type Status = 400 | 403 | 404 | 409 | 502;

export function fail(status: Status, message: string): never {
  throw new HTTPException(status, { message });
}

/** Validates a JSON body, answering failures in the API's `{ error }` shape. */
export const body = <T extends z.ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) return c.json({ error: result.error.issues[0]?.message ?? "Invalid input" }, 400);
  });

const param = <T extends z.ZodType>(schema: T) =>
  zValidator("param", schema, (result, c) => {
    if (!result.success) return c.json({ error: "Not found" }, 404);
  });

export const leagueParam = param(z.object({ leagueId: z.uuid() }));
export const weekParam = param(z.object({ weekId: z.uuid() }));
export const gameParam = param(z.object({ gameId: z.uuid() }));

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
    .select({ league: leagues, role: leagueMembers.role })
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
export async function listMemberRecords(db: Db, leagueId: string): Promise<MemberRecord[]> {
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
    .orderBy(asc(leagueMembers.joinedAt));
}

export const isActive = (member: MemberRecord) => member.removedAt === null;

/** Current members, in the shape the API returns. */
export const toMember = ({ userId, displayName, role }: MemberRecord): Member => ({
  userId,
  displayName,
  role,
});

/**
 * Who counts in a week's results, so that history doesn't shift when membership does:
 * - a player removed after the week's last kickoff stays in it; one removed earlier drops out;
 * - a player who joined after the week's last kickoff isn't added to it (unless they somehow picked).
 */
export function weekParticipants(
  members: MemberRecord[],
  games: { kickoff: Date }[],
  picks: { userId: string }[],
): MemberRecord[] {
  if (games.length === 0) return members.filter(isActive);
  const lastKickoff = new Date(Math.max(...games.map((g) => g.kickoff.getTime())));
  const picked = new Set(picks.map((p) => p.userId));
  return members.filter(
    (m) =>
      (m.removedAt === null || m.removedAt > lastKickoff) &&
      (m.joinedAt <= lastKickoff || picked.has(m.userId)),
  );
}
