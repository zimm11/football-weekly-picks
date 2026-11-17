import {
  games,
  type leagues,
  seasons,
  survivorPicks,
  weekParticipants as weekParticipantRows,
  weeks,
} from "@picks/db";
import {
  checkSurvivorPick,
  estimatedWeekStart,
  hasResult,
  nextStartWeek,
  pickedTeam,
  readSeasonSettings,
  type SurvivorGame,
  type SurvivorSettings,
  type SurvivorStatus,
  type SurvivorView,
  survivorOutcome,
  survivorPickSchema,
  survivorScoreSchema,
  survivorStatus,
  usedTeams,
  usedTeamsWaived,
  weekLabel,
} from "@picks/shared";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "./auth";
import {
  type AppDeps,
  body,
  fail,
  gameParam,
  isActive,
  leagueParam,
  listMemberRecords,
  type MemberRecord,
  query,
  recordedParticipants,
  requireAdmin,
  requireLeagueType,
  requireMember,
  requireWeek,
  type Store,
  type Tx,
  weekParam,
  weekParticipants,
} from "./context";
import type { AppServices } from "./services";
import type { LeagueTypeHooks } from "./typeHooks";

/*
 * Survivor's own routes: the season (statuses, the grid of revealed picks, the current week), saving a pick, and
 * the admin's corrections (removing a cancelled game, correcting a score). Every route checks the league's type
 * first (`requireLeagueType`), so another type's league answers 404. The weeks run themselves
 * (automation/survivor.ts); nobody's status is stored, it is worked out on every read (`survivorStatus`).
 *
 * The reveal point: another player's pick is shown once its team's game has kicked off. Before then no route says
 * anything about it, not even that it exists.
 */

type League = typeof leagues.$inferSelect;
type WeekRow = typeof weeks.$inferSelect;
type GameRow = typeof games.$inferSelect;
type PickRow = typeof survivorPicks.$inferSelect;

const toSurvivorGame = (g: GameRow): SurvivorGame => ({
  id: g.id,
  homeTeam: g.homeTeam,
  awayTeam: g.awayTeam,
  kickoff: g.kickoff,
  homeScore: g.homeScore,
  awayScore: g.awayScore,
});

/** Everything a survivor season is worked out from, read in a handful of queries. */
export type SurvivorSeason = {
  season: typeof seasons.$inferSelect;
  settings: SurvivorSettings;
  weeks: (WeekRow & { games: GameRow[] })[];
  picks: PickRow[];
  members: MemberRecord[];
  /** Null until the season has a start week. */
  status: SurvivorStatus | null;
};

/** A league's survivor season for `year`, or its latest when no year is given. Null when it has none. */
export async function loadSurvivorSeason(
  db: Store,
  leagueId: string,
  year?: number,
): Promise<SurvivorSeason | null> {
  const [season] = await db
    .select()
    .from(seasons)
    .where(
      year === undefined
        ? eq(seasons.leagueId, leagueId)
        : and(eq(seasons.leagueId, leagueId), eq(seasons.year, year)),
    )
    .orderBy(desc(seasons.year))
    .limit(1);
  if (!season) return null;
  const settings = readSeasonSettings("survivor", season.settings);
  const weekRows = await db
    .select()
    .from(weeks)
    .where(eq(weeks.seasonId, season.id))
    .orderBy(asc(weeks.number));
  const weekIds = weekRows.map((w) => w.id);
  const [gameRows, pickRows, members, recorded] = await Promise.all([
    weekIds.length
      ? db
          .select()
          .from(games)
          .where(inArray(games.weekId, weekIds))
          .orderBy(asc(games.kickoff), asc(games.id))
      : [],
    weekIds.length ? db.select().from(survivorPicks).where(inArray(survivorPicks.weekId, weekIds)) : [],
    listMemberRecords(db, leagueId),
    recordedParticipants(
      db,
      weekRows.filter((w) => w.status === "final").map((w) => w.id),
    ),
  ]);
  const withGames = weekRows.map((w) => ({ ...w, games: gameRows.filter((g) => g.weekId === w.id) }));
  const status = settings.startWeek
    ? survivorStatus({
        startWeek: settings.startWeek,
        lives: settings.lives,
        weeks: withGames.map((w) => ({
          id: w.id,
          number: w.number,
          status: w.status,
          games: w.games.map(toSurvivorGame),
        })),
        picks: pickRows,
        members,
        recorded,
      })
    : null;
  return { season, settings, weeks: withGames, picks: pickRows, members, status };
}

/** The start week's first game has kicked off (or a week is already final): the settings are fixed. */
function hasStarted(data: Pick<SurvivorSeason, "settings" | "weeks">, at: Date) {
  const start = data.weeks.find((w) => w.number === data.settings.startWeek);
  return (
    data.weeks.some((w) => w.status === "final") ||
    !!start?.games.some((g) => g.kickoff <= at || hasResult(g))
  );
}

/**
 * Starts (or re-sets, until it begins) a league's survivor season for `year`: stores the settings with the start
 * week resolved (the next week with no kickoff yet unless one was chosen) and creates the start week, empty. The
 * feed is never asked here: automation imports the week (and opens it) on the next read or cron run, so no
 * network call happens inside the caller's transaction. Lives and start week are fixed once the start week's
 * first game kicks off.
 *
 * `strict` (the admin's Start season) refuses a season with no week left to start; creating a league
 * (`strict: false`) then just stores the lives, and the pool waits for next season.
 */
export async function startSurvivorSeason(
  tx: Tx,
  input: { leagueId: string; year: number; settings: SurvivorSettings; at: Date },
  { strict }: { strict: boolean },
) {
  const { leagueId, year, at } = input;
  if (input.settings.startWeek !== undefined && estimatedWeekStart(year, input.settings.startWeek) <= at) {
    fail(409, `${weekLabel(input.settings.startWeek)} has already started. Choose a later week.`);
  }
  const startWeek = input.settings.startWeek ?? nextStartWeek(year, at);
  if (startWeek === null && strict) {
    fail(409, `The ${year} regular season is over. Start the pool for next season instead.`);
  }
  const settings: SurvivorSettings = {
    lives: input.settings.lives,
    ...(startWeek !== null && { startWeek }),
  };
  await tx.insert(seasons).values({ leagueId, year, settings }).onConflictDoNothing();
  // Two starts at once take turns, so each sees what the other did.
  const [season] = await tx
    .select()
    .from(seasons)
    .where(and(eq(seasons.leagueId, leagueId), eq(seasons.year, year)))
    .for("update");
  if (!season) throw new Error("Season upsert returned no row");
  const current = await loadSurvivorSeason(tx, leagueId, year);
  if (current && hasStarted(current, at))
    fail(409, "This pool has started: its lives and start week are fixed.");
  await tx.update(seasons).set({ settings }).where(eq(seasons.id, season.id));
  // Nothing has kicked off, so a start week that moved takes its weeks (and any early picks) with it.
  await tx
    .delete(weeks)
    .where(and(eq(weeks.seasonId, season.id), startWeek === null ? undefined : ne(weeks.number, startWeek)));
  if (startWeek !== null) {
    await tx.insert(weeks).values({ seasonId: season.id, number: startWeek }).onConflictDoNothing();
  }
}

export const survivorHooks: LeagueTypeHooks = {
  async startSeason(tx, { league, year, settings, at }) {
    await startSurvivorSeason(
      tx,
      { leagueId: league.id, year, settings: readSeasonSettings("survivor", settings), at },
      { strict: true },
    );
  },
};

/**
 * Records who was in the league at a survivor week's last kickoff as it is finalized (plus anyone who picked and
 * is a member now), the same rule as every other league type's weeks. A player missing from it is out from that
 * week on; the start week's record is also who plays the season (`survivorEntrants`). Nobody is ever dropped.
 */
export async function recordSurvivorParticipants(
  tx: Store,
  data: SurvivorSeason,
  week: SurvivorSeason["weeks"][number],
) {
  const weekPicks = data.picks.filter((p) => p.weekId === week.id);
  const userIds = weekParticipants(data.members, week.games, weekPicks).map((m) => m.userId);
  if (!userIds.length) return;
  await tx
    .insert(weekParticipantRows)
    .values(userIds.map((userId) => ({ weekId: week.id, userId })))
    .onConflictDoNothing();
}

/** The season as `userId` may see it: another player's pick only once its team's game has kicked off. */
export function survivorView(
  data: SurvivorSeason | null,
  ctx: {
    league: League;
    role: SurvivorView["role"];
    userId: string;
    years: number[];
    year: number;
    now: Date;
  },
): SurvivorView {
  const { league, role, userId, now } = ctx;
  const base: SurvivorView = {
    leagueId: league.id,
    year: data?.season.year ?? ctx.year,
    years: ctx.years,
    timeZone: league.timeZone,
    role,
    settings: null,
    started: false,
    over: false,
    winners: [],
    players: [],
    weeks: [],
    picks: [],
    current: null,
    watching: false,
  };
  if (!data) return base;
  const { status } = data;
  const memberOf = new Map(data.members.map((m) => [m.userId, m]));
  const results = new Map((status?.weeks ?? []).map((w) => [w.number, w]));
  const visibleWeeks = data.weeks.filter((w) => role === "admin" || w.status !== "draft");
  const gameOf = new Map(data.weeks.flatMap((w) => w.games.map((g) => [g.id, g] as const)));
  const current = status?.nextWeek
    ? data.weeks.find((w) => w.number === status.nextWeek && w.status === "open")
    : undefined;
  const mine = data.picks.filter((p) => p.userId === userId);
  const myPick = current && mine.find((p) => p.weekId === current.id);
  const used = current ? usedTeams(data.weeks, mine, userId, current.number) : new Map<string, number>();
  return {
    ...base,
    settings: { lives: data.settings.lives, startWeek: data.settings.startWeek ?? null },
    started: hasStarted(data, now),
    over: status?.over ?? false,
    winners: status?.winners ?? [],
    players: (status?.players ?? []).map((p) => ({
      userId: p.userId,
      displayName: memberOf.get(p.userId)?.displayName ?? "Player",
      removed: memberOf.get(p.userId)?.removedAt != null,
      alive: p.alive,
      livesLeft: p.livesLeft,
      strikes: p.strikes.length,
      outWeek: p.outWeek,
      outReason: p.outReason,
      winner: p.winner,
    })),
    weeks: visibleWeeks.map((w) => ({
      id: w.id,
      number: w.number,
      status: w.status,
      cancelled: results.get(w.number)?.cancelled ?? false,
      out: results.get(w.number)?.out ?? [],
      aliveAfter: results.get(w.number)?.aliveAfter ?? null,
      games: w.games.map((g) => ({
        id: g.id,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        kickoff: g.kickoff.toISOString(),
        homeScore: g.homeScore,
        awayScore: g.awayScore,
      })),
    })),
    // The reveal point: your own picks always; anyone else's once its game has kicked off (or has a result).
    picks: data.picks.flatMap((p) => {
      const game = gameOf.get(p.gameId);
      if (!game || (p.userId !== userId && game.kickoff > now && !hasResult(game))) return [];
      return [
        {
          userId: p.userId,
          weekId: p.weekId,
          gameId: p.gameId,
          side: p.side,
          team: pickedTeam(game, p.side),
          outcome: survivorOutcome(game, p.side),
        },
      ];
    }),
    current: current
      ? {
          weekId: current.id,
          number: current.number,
          myPick: myPick ? { gameId: myPick.gameId, side: myPick.side, byAdmin: myPick.byAdmin } : null,
          used: [...used].map(([team, weekNumber]) => ({ team, weekNumber })),
          usedWaived: usedTeamsWaived(current.number, current.games.map(toSurvivorGame), used, now),
        }
      : null,
    watching: !!status && !status.entrants.includes(userId),
  };
}

/** Holds a game for the admin's survivor corrections: the caller is an admin of its survivor league. */
async function survivorAdminGame(db: AppDeps["db"], gameId: string, userId: string) {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game) fail(404, "Game not found");
  const ctx = await requireWeek(db, game.weekId, userId);
  requireLeagueType(ctx.league, "survivor");
  requireAdmin(ctx.role);
  return { game, ctx };
}

export function survivorRoutes({ db, verifyToken, now = () => new Date() }: AppDeps, services: AppServices) {
  const auth = requireAuth(verifyToken);
  // Keep routes chained, or `ApiType` loses their types.
  return (
    new Hono<{ Variables: AuthVariables }>()
      /** The season: statuses, the grid of revealed picks, and the week being played with your own pick. */
      .get(
        "/leagues/:leagueId/survivor",
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
          const userId = c.var.user.id;
          const { league, role } = await requireMember(db, c.req.valid("param").leagueId, userId);
          requireLeagueType(league, "survivor");
          // The pool takes its next step first (throttled): a final score, the week finalized, the next imported.
          await services.advanceLeagueOnRead(league, c.get("requestId"));
          const requested = c.req.valid("query").year;
          const year = requested ? Number(requested) : undefined;
          const years = (
            await db
              .select({ year: seasons.year })
              .from(seasons)
              .where(eq(seasons.leagueId, league.id))
              .orderBy(desc(seasons.year))
          ).map((s) => s.year);
          const data = await loadSurvivorSeason(db, league.id, year);
          return c.json(
            survivorView(data, { league, role, userId, years, year: year ?? years[0] ?? 0, now: now() }),
          );
        },
      )
      /**
       * Saves a pick for the week being played. An admin can name another player (`userId`), under the same lock
       * rules; the pick then records that an admin entered it. One transaction holds the week row and the
       * player's advisory lock, as pick'em submissions do, so the lock and no-reuse rules can't be raced.
       */
      .put("/weeks/:weekId/survivor-pick", auth, weekParam, body(survivorPickSchema), async (c) => {
        const actor = c.var.user.id;
        const ctx = await requireWeek(db, c.req.valid("param").weekId, actor);
        requireLeagueType(ctx.league, "survivor");
        const input = c.req.valid("json");
        const target = input.userId ?? actor;
        const byAdmin = target !== actor;
        if (byAdmin) requireAdmin(ctx.role);
        const weekId = ctx.week.id;

        await db.transaction(async (tx) => {
          const [week] = await tx.select().from(weeks).where(eq(weeks.id, weekId)).for("share");
          if (week?.status !== "open") fail(409, "This week is not open for picks.");
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${weekId}:${target}`}, 0))`);
          // Judged at the time the locks were granted, so a save that waited past a kickoff can't slip in.
          const at = now();
          const data = await loadSurvivorSeason(tx, ctx.league.id, ctx.season.year);
          const player = data?.members.find((m) => m.userId === target && isActive(m));
          if (!data?.status || !player) fail(404, "Member not found");
          const name = byAdmin ? player.displayName : undefined;
          if (!data.status.entrants.includes(target)) {
            fail(
              409,
              name
                ? `${name} joined after this pool began.`
                : "You joined after this pool began. You can play next season.",
            );
          }
          if (!data.status.players.find((p) => p.userId === target)?.alive) {
            fail(409, name ? `${name} is out of the pool.` : "You're out of this pool.");
          }
          if (data.status.nextWeek !== week.number) fail(409, "This week isn't being played in the pool.");
          const thisWeek = data.weeks.find((w) => w.id === weekId);
          const existing = data.picks.find((p) => p.weekId === weekId && p.userId === target) ?? null;
          const error = checkSurvivorPick({
            weekNumber: week.number,
            games: (thisWeek?.games ?? []).map(toSurvivorGame),
            existing,
            pick: { gameId: input.gameId, side: input.side },
            used: usedTeams(data.weeks, data.picks, target, week.number),
            now: at,
            player: name,
          });
          if (error) fail(409, error);
          if (existing?.gameId === input.gameId && existing.side === input.side) return;
          await tx
            .insert(survivorPicks)
            .values({ weekId, userId: target, gameId: input.gameId, side: input.side, byAdmin })
            .onConflictDoUpdate({
              target: [survivorPicks.weekId, survivorPicks.userId],
              set: { gameId: input.gameId, side: input.side, byAdmin, updatedAt: at },
            });
        });
        // Nothing about the pick comes back: the screen reloads the season, which shows the player their own.
        return c.json({ ok: true });
      })
      /**
       * Removes a cancelled game from a week still being played. Picks on it are deleted, so those players can
       * pick again; automation never imports the game back (it fills only an empty week).
       */
      .delete("/survivor-games/:gameId", auth, gameParam, async (c) => {
        const { game } = await survivorAdminGame(db, c.req.valid("param").gameId, c.var.user.id);
        await db.transaction(async (tx) => {
          const [week] = await tx.select().from(weeks).where(eq(weeks.id, game.weekId)).for("update");
          if (week?.status === "final") fail(409, "This week is final. Correct a score instead.");
          const [{ n = 0 } = {}] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(games)
            .where(eq(games.weekId, game.weekId));
          if (n <= 1) fail(409, "A week needs at least one game.");
          await tx.delete(games).where(eq(games.id, game.id));
        });
        return c.json({ ok: true });
      })
      /**
       * Corrects a game's score at any time, final weeks included: everyone's status is worked out again from it.
       * A typed score is never overwritten by the feed. Both null clears the result of a game in an open week.
       */
      .patch("/survivor-games/:gameId", auth, gameParam, body(survivorScoreSchema), async (c) => {
        const { game } = await survivorAdminGame(db, c.req.valid("param").gameId, c.var.user.id);
        const { homeScore, awayScore } = c.req.valid("json");
        await db.transaction(async (tx) => {
          const [week] = await tx.select().from(weeks).where(eq(weeks.id, game.weekId)).for("update");
          if (week?.status === "final" && homeScore === null) fail(409, "A final week's games need scores.");
          await tx.update(games).set({ homeScore, awayScore }).where(eq(games.id, game.id));
        });
        return c.json({ ok: true });
      })
  );
}
