import { randomBytes } from "node:crypto";
import {
  games,
  leagueMembers,
  leagues,
  picks,
  seasons,
  tiebreakerGuesses,
  weekRecapViews,
  weeks,
} from "@picks/db";
import {
  activeMute,
  type CreateLeagueResult,
  createLeagueSchema,
  defaultManagement,
  effectiveTiebreakerId,
  type InvitePreview,
  type LeagueDetail,
  type LeagueSummary,
  leagueTypeInfo,
  lowPointLosers,
  MAX_LEAGUE_MEMBERS,
  MAX_LEAGUES_PER_USER,
  MODERATION_MESSAGES,
  mayUseManagement,
  type PlayerSeasonStats,
  parseSeasonSettings,
  preferredSeasonYear,
  type Role,
  type Standings,
  scoreWeek,
  seasonStandings,
  seasonStats,
  seasonYear,
  updateLeagueSchema,
  updateMemberRoleSchema,
  weekPhase,
  weekPickAvailability,
  weekSummary,
} from "@picks/shared";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, type SQL, sql } from "drizzle-orm";
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
  param,
  query,
  recordedParticipants,
  requireAdmin,
  requireDisplayName,
  requireMember,
  type Tx,
  toMember,
  weekParticipants,
} from "./context";
import { deliverLeagueEventsSoon, queueLeagueEvent } from "./leagueEvents";
import { blockedBy, openReportCount, requireNotSuspended, screen } from "./moderation";
import type { AppServices } from "./services";
import { startSurvivorSeason } from "./survivor";
import { TYPE_HOOKS } from "./typeHooks";

const memberParam = param(z.object({ leagueId: z.uuid(), userId: z.uuid() }));

/** Every player in the standings has stats, since both are built from the same list. */
function omitUserId(stats: PlayerSeasonStats | undefined): Omit<PlayerSeasonStats, "userId"> {
  if (!stats) throw new Error("Missing season stats for a standings entry");
  const { userId: _, ...rest } = stats;
  return rest;
}

const newInviteCode = () => randomBytes(9).toString("base64url");

const defaultLimits = { membersPerLeague: MAX_LEAGUE_MEMBERS, leaguesPerUser: MAX_LEAGUES_PER_USER };

/** Leagues whose type keeps its settings on the season get their first season, with them, when created. */
const SEASON_SETTINGS_TYPES = new Set(["playoff", "survivor"]);

export function leagueRoutes(deps: AppDeps, services: AppServices) {
  const { db, verifyToken, screener, now = () => new Date(), limits = defaultLimits } = deps;
  const auth = requireAuth(verifyToken);

  /** Active members of a league, or active leagues of a user, depending on the filter. */
  async function countMemberships(tx: Tx | AppDeps["db"], filter: SQL) {
    const [row] = await tx
      .select({ n: count() })
      .from(leagueMembers)
      .where(and(filter, isNull(leagueMembers.removedAt)));
    return row?.n ?? 0;
  }

  /**
   * Serializes a user's league creates and joins so two at once can't both slip under the cap. Taken
   * after any league row lock, never before, so it can't deadlock with membership changes.
   */
  async function requireRoomForAnotherLeague(tx: Tx, userId: string) {
    if (!(await roomForAnotherLeague(tx, userId))) {
      fail(409, `You're already in ${limits.leaguesPerUser} leagues, the most one player can be in.`);
    }
  }
  /** Takes the player's league-count lock (see above) and says whether they can be in one more league. */
  async function roomForAnotherLeague(tx: Tx, userId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`leagues-of:${userId}`}, 0))`);
    return (await countMemberships(tx, eq(leagueMembers.userId, userId))) < limits.leaguesPerUser;
  }

  async function leagueByInvite(code: string) {
    const [league] = await db.select().from(leagues).where(eq(leagues.inviteCode, code));
    if (!league) fail(404, "This invite link is no longer valid. Ask the league admin for a new one.");
    return league;
  }

  /** Serialize membership changes per league, including the authorization check and last-admin guard. */
  async function changeMembership(leagueId: string, actorId: string, userId: string, role: Role | null) {
    await db.transaction(async (tx) => {
      await tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, leagueId)).for("update");
      const members = await tx
        .select({ userId: leagueMembers.userId, role: leagueMembers.role })
        .from(leagueMembers)
        .where(and(eq(leagueMembers.leagueId, leagueId), isNull(leagueMembers.removedAt)));
      const actor = members.find((member) => member.userId === actorId);
      if (!actor) fail(404, "League not found");
      // Anyone can leave; every other change needs an admin.
      const leaving = role === null && userId === actorId;
      if (!leaving) requireAdmin(actor.role);
      const target = members.find((member) => member.userId === userId);
      if (!target) fail(404, "Member not found");
      if (
        target.role === "admin" &&
        role !== "admin" &&
        members.filter((member) => member.role === "admin").length === 1
      ) {
        fail(
          409,
          leaving
            ? "You're the league's only admin. Make another member an admin before you leave."
            : "At least one admin must remain. Make another member an admin first.",
        );
      }
      const at = now();
      await tx
        .update(leagueMembers)
        .set(role === null ? { removedAt: at, role: "member" } : { role })
        .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId)));
      if (role === null) {
        const [league] = await tx
          .select({ type: leagues.type })
          .from(leagues)
          .where(eq(leagues.id, leagueId));
        if (league) await TYPE_HOOKS[league.type].memberRemoved?.(tx, { leagueId, userId, at });
      }
    });
  }

  return (
    new Hono<{ Variables: AuthVariables }>()
      .get("/leagues", auth, async (c) => {
        const rows: LeagueSummary[] = await db
          .select({
            id: leagues.id,
            name: leagues.name,
            role: leagueMembers.role,
            type: leagues.type,
            management: leagues.management,
          })
          .from(leagueMembers)
          .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
          .where(and(eq(leagueMembers.userId, c.var.user.id), isNull(leagueMembers.removedAt)))
          .orderBy(asc(leagues.createdAt));
        return c.json(rows);
      })
      /**
       * Creates a league of any type, its creator as admin. `copyMembersFrom` names a league the creator is an
       * admin of: its current members join as members in the same transaction, under the same caps and locks as
       * a join, and each gets a league event. A player already at the league limit is skipped and named.
       */
      .post("/leagues", auth, body(createLeagueSchema), async (c) => {
        const input = c.req.valid("json");
        const userId = c.var.user.id;
        const management = input.management ?? defaultManagement(input.type);
        if (!mayUseManagement(input.type, management)) {
          fail(400, `${leagueTypeInfo(input.type).name} leagues run themselves.`);
        }
        const settings = parseSeasonSettings(input.type, input.settings);
        await requireDisplayName(db, userId);
        await requireNotSuspended(db, userId);
        await screen(screener, { kind: "league_name", text: input.name }, MODERATION_MESSAGES.rejectedName);
        const source = input.copyMembersFrom ? await requireMember(db, input.copyMembersFrom, userId) : null;
        if (source) requireAdmin(source.role);
        const at = now();
        const result = await db.transaction(async (tx) => {
          const copied = source
            ? (await listMemberRecords(tx, source.league.id)).filter(
                (m) => isActive(m) && m.userId !== userId,
              )
            : [];
          // Every player's league-count lock, in one order (creator included), so two creates copying each
          // other's members can't deadlock. No league row lock is held while waiting, as joins require.
          for (const id of [userId, ...copied.map((m) => m.userId)].sort())
            await roomForAnotherLeague(tx, id);
          await requireRoomForAnotherLeague(tx, userId);
          const [league] = await tx
            .insert(leagues)
            .values({
              name: input.name,
              timeZone: input.timeZone,
              type: input.type,
              management,
              inviteCode: newInviteCode(),
            })
            .returning({ id: leagues.id });
          if (!league) throw new Error("League insert returned no row");
          await tx.insert(leagueMembers).values({ leagueId: league.id, userId, role: "admin", joinedAt: at });
          if (SEASON_SETTINGS_TYPES.has(input.type)) {
            await tx.insert(seasons).values({ leagueId: league.id, year: seasonYear(at), settings });
          }
          // A survivor pool also gets its start week, which automation imports on the first read.
          if (input.type === "survivor") {
            await startSurvivorSeason(
              tx,
              {
                leagueId: league.id,
                year: seasonYear(at),
                settings: parseSeasonSettings("survivor", settings),
                at,
              },
              { strict: false },
            );
          }
          const added: string[] = [];
          const skipped: CreateLeagueResult["skipped"] = [];
          for (const member of copied) {
            if (1 + added.length >= limits.membersPerLeague) {
              skipped.push({ userId: member.userId, displayName: member.displayName, reason: "league_full" });
            } else if (!(await roomForAnotherLeague(tx, member.userId))) {
              skipped.push({
                userId: member.userId,
                displayName: member.displayName,
                reason: "player_limit",
              });
            } else {
              await tx
                .insert(leagueMembers)
                .values({ leagueId: league.id, userId: member.userId, joinedAt: at });
              added.push(member.userId);
            }
          }
          const queued = added.length
            ? await queueLeagueEvent(
                tx,
                deps,
                {
                  leagueId: league.id,
                  event: "added",
                  userIds: added,
                  headline: `You've been added to ${input.name}`,
                  detail: `${input.name} started with the members of ${source?.league.name ?? "another league"}. If you'd rather not play, you can leave from its League tab.`,
                  path: `/leagues/${league.id}`,
                },
                at,
              )
            : { emails: 0, pushes: 0 };
          return { id: league.id, added: added.length, skipped, queued };
        });
        deliverLeagueEventsSoon(deps, result.queued, at);
        const created: CreateLeagueResult = { id: result.id, added: result.added, skipped: result.skipped };
        return c.json(created, 201);
      })
      .get("/leagues/:leagueId", auth, leagueParam, async (c) => {
        const { leagueId } = c.req.valid("param");
        const { league, role, joinedAt } = await requireMember(db, leagueId, c.var.user.id);
        // A league that runs itself takes its next step first (throttled), so the weeks below are current.
        await services.advanceLeagueOnRead(league, c.get("requestId"));
        const weekRows = await db
          .select({
            id: weeks.id,
            year: seasons.year,
            number: weeks.number,
            status: weeks.status,
            finalizedAt: weeks.finalizedAt,
          })
          .from(weeks)
          .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
          .where(eq(seasons.leagueId, leagueId))
          .orderBy(desc(seasons.year), desc(weeks.number));
        const weekIds = weekRows.map((w) => w.id);
        const [gameRows, pickRows] = weekIds.length
          ? await Promise.all([
              db
                .select({
                  id: games.id,
                  weekId: games.weekId,
                  kickoff: games.kickoff,
                  homeScore: games.homeScore,
                  awayScore: games.awayScore,
                })
                .from(games)
                .where(inArray(games.weekId, weekIds)),
              db
                .select({ weekId: picks.weekId, gameId: picks.gameId })
                .from(picks)
                .where(and(inArray(picks.weekId, weekIds), eq(picks.userId, c.var.user.id))),
            ])
          : [[], []];
        const clock = now();
        // The recap is for the latest week closed since this player joined, until they have been shown it.
        const [latestFinal] = weekRows
          .flatMap((w) =>
            w.status === "final" && w.finalizedAt && w.finalizedAt >= joinedAt
              ? [{ id: w.id, finalizedAt: w.finalizedAt }]
              : [],
          )
          .sort((a, b) => b.finalizedAt.getTime() - a.finalizedAt.getTime());
        const [recapView] = latestFinal
          ? await db
              .select({ seenAt: weekRecapViews.seenAt })
              .from(weekRecapViews)
              .where(and(eq(weekRecapViews.weekId, latestFinal.id), eq(weekRecapViews.userId, c.var.user.id)))
          : [];
        const recapSeen = !!latestFinal && !!recapView && recapView.seenAt >= latestFinal.finalizedAt;
        const detail: LeagueDetail = {
          id: league.id,
          name: league.name,
          timeZone: league.timeZone,
          type: league.type,
          management: league.management,
          role,
          inviteCode: role === "admin" ? league.inviteCode : null,
          members: await (async () => {
            const [records, blocked, mutes] = await Promise.all([
              listMemberRecords(db, leagueId),
              blockedBy(db, c.var.user.id),
              role === "admin"
                ? db
                    .select({ userId: leagueMembers.userId, mutedUntil: leagueMembers.mutedUntil })
                    .from(leagueMembers)
                    .where(and(eq(leagueMembers.leagueId, leagueId), isNotNull(leagueMembers.mutedUntil)))
                : [],
            ]);
            const muteOf = new Map(mutes.map((m) => [m.userId, activeMute(clock, m.mutedUntil)]));
            return records.filter(isActive).map((m) => ({
              ...toMember(m),
              ...(blocked.has(m.userId) && { blocked: true }),
              ...(role === "admin" && { mutedUntil: muteOf.get(m.userId)?.toISOString() ?? null }),
            }));
          })(),
          openReports: role === "admin" ? await openReportCount(db, leagueId) : null,
          weeks: weekRows
            .filter((w) => role === "admin" || w.status !== "draft")
            .map(({ finalizedAt: _, ...w }) => {
              const slate = gameRows.filter((game) => game.weekId === w.id);
              const picked = new Set(
                pickRows.filter((pick) => pick.weekId === w.id).map((pick) => pick.gameId),
              );
              return {
                ...w,
                gameCount: slate.length,
                myPickCount: picked.size,
                phase: weekPhase(w.status, slate, clock),
                ...weekPickAvailability(slate, picked, clock),
              };
            }),
          recapWeekId: latestFinal && !recapSeen ? latestFinal.id : null,
        };
        return c.json(detail);
      })
      .patch("/leagues/:leagueId", auth, leagueParam, body(updateLeagueSchema), async (c) => {
        const { leagueId } = c.req.valid("param");
        const { league, role } = await requireMember(db, leagueId, c.var.user.id);
        requireAdmin(role);
        const changes = c.req.valid("json");
        if (changes.management !== undefined && changes.management !== league.management) {
          // Only weekly pick'em has a choice.
          if (!mayUseManagement(league.type, changes.management))
            fail(409, `${leagueTypeInfo(league.type).name} leagues run themselves.`);
        }
        const renaming = changes.name !== undefined && changes.name !== league.name;
        if (renaming) await requireNotSuspended(db, c.var.user.id);
        if (renaming && changes.name)
          await screen(
            screener,
            { kind: "league_name", text: changes.name },
            MODERATION_MESSAGES.rejectedName,
          );
        await db.update(leagues).set(changes).where(eq(leagues.id, leagueId));
        return c.json({ ok: true });
      })
      .patch(
        "/leagues/:leagueId/members/:userId",
        auth,
        memberParam,
        body(updateMemberRoleSchema),
        async (c) => {
          const { leagueId, userId } = c.req.valid("param");
          await changeMembership(leagueId, c.var.user.id, userId, c.req.valid("json").role);
          return c.json({ ok: true });
        },
      )
      /**
       * Removes a player from the league, or lets a player leave by naming themselves. The membership row
       * is kept and marked, so weeks they already played keep their results; they lose access until they
       * rejoin through an invite link.
       */
      .delete("/leagues/:leagueId/members/:userId", auth, memberParam, async (c) => {
        const { leagueId, userId } = c.req.valid("param");
        await changeMembership(leagueId, c.var.user.id, userId, null);
        return c.json({ ok: true });
      })
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
          full:
            !member &&
            (await countMemberships(db, eq(leagueMembers.leagueId, league.id))) >= limits.membersPerLeague,
        };
        return c.json(preview);
      })
      .post("/invites/:code/join", auth, async (c) => {
        const league = await leagueByInvite(c.req.param("code"));
        const userId = c.var.user.id;
        await db.transaction(async (tx) => {
          // The league row lock serializes joins with each other and with removals, so the count holds.
          await tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, league.id)).for("update");
          const [existing] = await tx
            .select({ removedAt: leagueMembers.removedAt })
            .from(leagueMembers)
            .where(and(eq(leagueMembers.leagueId, league.id), eq(leagueMembers.userId, userId)));
          // Joining a league you're already in is harmless and doesn't count against either limit.
          if (existing && existing.removedAt === null) return;
          await requireDisplayName(tx, userId);
          if (
            (await countMemberships(tx, eq(leagueMembers.leagueId, league.id))) >= limits.membersPerLeague
          ) {
            fail(409, `This league is full: it already has ${limits.membersPerLeague} players.`);
          }
          await requireRoomForAnotherLeague(tx, userId);
          await tx
            .insert(leagueMembers)
            .values({ leagueId: league.id, userId, joinedAt: now() })
            // A removed player rejoining starts a fresh membership. Weeks finalized before keep the players
            // recorded when they closed (`week_participants`), so the new `joinedAt` can't take them out.
            .onConflictDoUpdate({
              target: [leagueMembers.leagueId, leagueMembers.userId],
              set: { removedAt: null, joinedAt: now() },
              setWhere: isNotNull(leagueMembers.removedAt),
            });
        });
        return c.json({ leagueId: league.id });
      })
      .get(
        "/leagues/:leagueId/standings",
        auth,
        leagueParam,
        query(
          z.object({
            year: z
              .string()
              .regex(/^\d{4}$/, "Choose a season year")
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
          const publishedWeeks = await db
            .select({ year: seasons.year, status: weeks.status })
            .from(weeks)
            .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
            .where(eq(seasons.leagueId, leagueId));
          const requestedYear = c.req.valid("query").year;
          const selectedYear = requestedYear
            ? Number(requestedYear)
            : preferredSeasonYear(publishedWeeks, now());
          const season = seasonRows.find((s) => s.year === selectedYear);
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
          const [gameRows, pickRows, guessRows, recorded] = weekIds.length
            ? await Promise.all([
                db.select().from(games).where(inArray(games.weekId, weekIds)),
                db.select().from(picks).where(inArray(picks.weekId, weekIds)),
                db.select().from(tiebreakerGuesses).where(inArray(tiebreakerGuesses.weekId, weekIds)),
                recordedParticipants(db, weekIds),
              ])
            : [[], [], [], new Map<string, Set<string>>()];
          const statsWeeks = finalWeeks.map((week) => {
            const weekGames = gameRows.filter((g) => g.weekId === week.id);
            const weekPicks = pickRows.filter((p) => p.weekId === week.id);
            const entries = scoreWeek({
              games: weekGames,
              picks: weekPicks,
              guesses: guessRows.filter((g) => g.weekId === week.id),
              // Each week is scored for the people who were in the league when it was played.
              userIds: weekParticipants(members, weekGames, weekPicks, recorded.get(week.id)).map(
                (m) => m.userId,
              ),
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
            year: season?.year ?? (requestedYear ? selectedYear : null),
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
              lowPointLosers: lowPointLosers(scored[i] ?? []).map(nameOf),
              ...weekSummary(scored[i] ?? []),
            })),
          };
          return c.json(standings);
        },
      )
  );
}
