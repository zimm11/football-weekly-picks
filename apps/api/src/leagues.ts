import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { games, leagueMembers, leagues, picks, seasons, tiebreakerGuesses, weeks } from "@picks/db";
import {
  createLeagueSchema,
  effectiveTiebreakerId,
  type InvitePreview,
  type LeagueDetail,
  type LeagueSummary,
  type PlayerSeasonStats,
  type Standings,
  scoreWeek,
  seasonStandings,
  seasonStats,
  updateLeagueSchema,
  weekSummary,
} from "@picks/shared";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "./auth";
import {
  type AppDeps,
  body,
  fail,
  isActive,
  leagueParam,
  listMemberRecords,
  requireAdmin,
  requireMember,
  toMember,
  weekParticipants,
} from "./context";

/** Every player in the standings has stats, since both are built from the same list. */
function omitUserId(stats: PlayerSeasonStats | undefined): Omit<PlayerSeasonStats, "userId"> {
  if (!stats) throw new Error("Missing season stats for a standings entry");
  const { userId: _, ...rest } = stats;
  return rest;
}

const newInviteCode = () => randomBytes(9).toString("base64url");

export function leagueRoutes({ db, verifyToken }: AppDeps) {
  const auth = requireAuth(verifyToken);

  async function leagueByInvite(code: string) {
    const [league] = await db.select().from(leagues).where(eq(leagues.inviteCode, code));
    if (!league) fail(404, "This invite link is no longer valid. Ask the league admin for a new one.");
    return league;
  }

  return (
    new Hono<{ Variables: AuthVariables }>()
      .get("/leagues", auth, async (c) => {
        const rows: LeagueSummary[] = await db
          .select({ id: leagues.id, name: leagues.name, role: leagueMembers.role })
          .from(leagueMembers)
          .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
          .where(and(eq(leagueMembers.userId, c.var.user.id), isNull(leagueMembers.removedAt)))
          .orderBy(asc(leagues.createdAt));
        return c.json(rows);
      })
      .post("/leagues", auth, body(createLeagueSchema), async (c) => {
        const { name, timeZone } = c.req.valid("json");
        const id = await db.transaction(async (tx) => {
          const [league] = await tx
            .insert(leagues)
            .values({ name, timeZone, inviteCode: newInviteCode() })
            .returning({ id: leagues.id });
          if (!league) throw new Error("League insert returned no row");
          await tx
            .insert(leagueMembers)
            .values({ leagueId: league.id, userId: c.var.user.id, role: "admin" });
          return league.id;
        });
        return c.json({ id }, 201);
      })
      .get("/leagues/:leagueId", auth, leagueParam, async (c) => {
        const { leagueId } = c.req.valid("param");
        const { league, role } = await requireMember(db, leagueId, c.var.user.id);
        const weekRows = await db
          .select({ id: weeks.id, year: seasons.year, number: weeks.number, status: weeks.status })
          .from(weeks)
          .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
          .where(eq(seasons.leagueId, leagueId))
          .orderBy(desc(seasons.year), desc(weeks.number));
        const weekIds = weekRows.map((w) => w.id);
        const [gameCountRows, pickCountRows] = weekIds.length
          ? await Promise.all([
              db
                .select({ weekId: games.weekId, n: count() })
                .from(games)
                .where(inArray(games.weekId, weekIds))
                .groupBy(games.weekId),
              db
                .select({ weekId: picks.weekId, n: count() })
                .from(picks)
                .where(and(inArray(picks.weekId, weekIds), eq(picks.userId, c.var.user.id)))
                .groupBy(picks.weekId),
            ])
          : [[], []];
        const gameCounts = new Map(gameCountRows.map((r) => [r.weekId, r.n]));
        const pickCounts = new Map(pickCountRows.map((r) => [r.weekId, r.n]));
        const detail: LeagueDetail = {
          id: league.id,
          name: league.name,
          timeZone: league.timeZone,
          role,
          inviteCode: role === "admin" ? league.inviteCode : null,
          members: (await listMemberRecords(db, leagueId)).filter(isActive).map(toMember),
          weeks: weekRows
            .filter((w) => role === "admin" || w.status !== "draft")
            .map((w) => ({
              ...w,
              gameCount: gameCounts.get(w.id) ?? 0,
              myPickCount: pickCounts.get(w.id) ?? 0,
            })),
        };
        return c.json(detail);
      })
      .patch("/leagues/:leagueId", auth, leagueParam, body(updateLeagueSchema), async (c) => {
        const { leagueId } = c.req.valid("param");
        requireAdmin((await requireMember(db, leagueId, c.var.user.id)).role);
        await db.update(leagues).set(c.req.valid("json")).where(eq(leagues.id, leagueId));
        return c.json({ ok: true });
      })
      /**
       * Removes a player from the league. The membership row is kept and marked, so weeks they already
       * played keep their results; they lose access until they rejoin through an invite link.
       */
      .delete(
        "/leagues/:leagueId/members/:userId",
        auth,
        zValidator("param", z.object({ leagueId: z.uuid(), userId: z.uuid() })),
        async (c) => {
          const { leagueId, userId } = c.req.valid("param");
          requireAdmin((await requireMember(db, leagueId, c.var.user.id)).role);
          if (userId === c.var.user.id) fail(409, "You can't remove yourself from a league you run.");
          await db
            .update(leagueMembers)
            .set({ removedAt: new Date() })
            .where(
              and(
                eq(leagueMembers.leagueId, leagueId),
                eq(leagueMembers.userId, userId),
                isNull(leagueMembers.removedAt),
              ),
            );
          return c.json({ ok: true });
        },
      )
      /** Replaces the invite code, so links already handed out stop working. */
      .post("/leagues/:leagueId/invite", auth, leagueParam, async (c) => {
        const { leagueId } = c.req.valid("param");
        requireAdmin((await requireMember(db, leagueId, c.var.user.id)).role);
        const inviteCode = newInviteCode();
        await db.update(leagues).set({ inviteCode }).where(eq(leagues.id, leagueId));
        return c.json({ inviteCode });
      })
      .get("/invites/:code", auth, async (c) => {
        const league = await leagueByInvite(c.req.param("code"));
        const [member] = await db
          .select({ userId: leagueMembers.userId })
          .from(leagueMembers)
          .where(
            and(
              eq(leagueMembers.leagueId, league.id),
              eq(leagueMembers.userId, c.var.user.id),
              isNull(leagueMembers.removedAt),
            ),
          );
        const preview: InvitePreview = {
          leagueId: league.id,
          leagueName: league.name,
          alreadyMember: !!member,
        };
        return c.json(preview);
      })
      .post("/invites/:code/join", auth, async (c) => {
        const league = await leagueByInvite(c.req.param("code"));
        await db
          .insert(leagueMembers)
          .values({ leagueId: league.id, userId: c.var.user.id })
          // A removed player rejoining starts a fresh membership; weeks they picked in before still count.
          .onConflictDoUpdate({
            target: [leagueMembers.leagueId, leagueMembers.userId],
            set: { removedAt: null, joinedAt: new Date() },
            setWhere: isNotNull(leagueMembers.removedAt),
          });
        return c.json({ leagueId: league.id });
      })
      .get(
        "/leagues/:leagueId/standings",
        auth,
        leagueParam,
        zValidator(
          "query",
          z.object({
            year: z
              .string()
              .regex(/^\d{4}$/)
              .optional(),
          }),
        ),
        async (c) => {
          const { leagueId } = c.req.valid("param");
          await requireMember(db, leagueId, c.var.user.id);
          const seasonRows = await db
            .select()
            .from(seasons)
            .where(eq(seasons.leagueId, leagueId))
            .orderBy(desc(seasons.year));
          const season =
            seasonRows.find((s) => s.year === Number(c.req.valid("query").year)) ?? seasonRows[0];
          const members = await listMemberRecords(db, leagueId);
          const memberOf = new Map(members.map((m) => [m.userId, m]));
          const nameOf = (userId: string) => memberOf.get(userId)?.displayName ?? "Player";

          // Only final weeks count, so standings never reveal picks from a week still in play.
          const finalWeeks = season
            ? await db
                .select()
                .from(weeks)
                .where(and(eq(weeks.seasonId, season.id), eq(weeks.status, "final")))
                .orderBy(asc(weeks.number))
            : [];
          const weekIds = finalWeeks.map((w) => w.id);
          const [gameRows, pickRows, guessRows] = weekIds.length
            ? await Promise.all([
                db.select().from(games).where(inArray(games.weekId, weekIds)),
                db.select().from(picks).where(inArray(picks.weekId, weekIds)),
                db.select().from(tiebreakerGuesses).where(inArray(tiebreakerGuesses.weekId, weekIds)),
              ])
            : [[], [], []];
          const statsWeeks = finalWeeks.map((week) => {
            const weekGames = gameRows.filter((g) => g.weekId === week.id);
            const weekPicks = pickRows.filter((p) => p.weekId === week.id);
            const entries = scoreWeek({
              games: weekGames,
              picks: weekPicks,
              guesses: guessRows.filter((g) => g.weekId === week.id),
              // Each week is scored for the people who were in the league when it was played.
              userIds: weekParticipants(members, weekGames, weekPicks).map((m) => m.userId),
              tiebreakerGameId: effectiveTiebreakerId(week.tiebreakerGameId, weekGames),
            });
            return { games: weekGames, picks: weekPicks, entries };
          });
          const scored = statsWeeks.map((w) => w.entries);
          // The table lists current members plus anyone since removed who played a counted week.
          const userIds = members
            .filter((m) => isActive(m) || scored.some((week) => week.some((e) => e.userId === m.userId)))
            .map((m) => m.userId);

          const statsOf = new Map(seasonStats(statsWeeks, userIds).map((s) => [s.userId, s]));

          const standings: Standings = {
            years: seasonRows.map((s) => s.year),
            year: season?.year ?? null,
            entries: seasonStandings(scored, userIds).map((e) => ({
              ...e,
              ...omitUserId(statsOf.get(e.userId)),
              displayName: nameOf(e.userId),
              removed: memberOf.get(e.userId)?.removedAt != null,
            })),
            weeks: finalWeeks.map((week, i) => ({
              id: week.id,
              number: week.number,
              winners: (scored[i] ?? []).filter((e) => e.isWinner).map((e) => nameOf(e.userId)),
              ...weekSummary(scored[i] ?? []),
            })),
          };
          return c.json(standings);
        },
      )
  );
}
