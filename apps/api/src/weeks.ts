import { type Db, games, picks, seasons, tiebreakerGuesses, weeks } from "@picks/db";
import {
  checkPickSubmission,
  checkTiebreakerGuess,
  coversWeek,
  createGameSchema,
  createWeekSchema,
  defaultPoints,
  effectiveTiebreakerId,
  type Game,
  type GameInsights,
  hasResult,
  scoreWeek,
  submitPicksSchema,
  updateGameSchema,
  updateWeekSchema,
  type WeekView,
} from "@picks/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthVariables, requireAuth } from "./auth";
import {
  type AppDeps,
  body,
  fail,
  gameParam,
  isActive,
  leagueParam,
  listMemberRecords,
  recordedParticipants,
  requireAdmin,
  requireLeagueType,
  requireMember,
  requireWeek,
  type WeekContext,
  weekParam,
  weekParticipants,
} from "./context";
import { logError } from "./logging";
import type { ProviderGame } from "./nfl";
import type { AppServices } from "./services";
import {
  fillFinishedGames,
  finalizeProblem,
  finalizeWeek,
  type GameRow,
  gamesOf,
  importSlate,
  markRecapSeen,
  openProblem,
  openWeek,
  pointsAfterKickoffChange,
  reopenWeek,
  writeFinals,
} from "./weekOps";

export { RESULTS_REFRESH_MS } from "./weekOps";

/** The league types the shared pick'em week, game and pick routes serve. Any other type's week is a 404. */
const PICKEM = ["weekly", "playoff"] as const;

const toGame = (g: GameRow): Game => ({
  id: g.id,
  homeTeam: g.homeTeam,
  awayTeam: g.awayTeam,
  kickoff: g.kickoff.toISOString(),
  spread: g.spread,
  points: g.points,
  homeScore: g.homeScore,
  awayScore: g.awayScore,
});

export async function buildWeekView(db: Db, ctx: WeekContext, userId: string): Promise<WeekView> {
  // Re-read the week: the caller may have just changed it.
  const [week] = await db.select().from(weeks).where(eq(weeks.id, ctx.week.id));
  if (!week) fail(404, "Week not found");
  const final = week.status === "final";
  // Until the week is final, only the caller's own picks and guess are read. An admin also needs everyone's
  // picks to count submissions, but never sees the picks themselves.
  const pickScope =
    final || ctx.role === "admin"
      ? eq(picks.weekId, week.id)
      : and(eq(picks.weekId, week.id), eq(picks.userId, userId));
  const guessScope = final
    ? eq(tiebreakerGuesses.weekId, week.id)
    : and(eq(tiebreakerGuesses.weekId, week.id), eq(tiebreakerGuesses.userId, userId));
  const [gameRows, pickRows, guessRows] = await Promise.all([
    gamesOf(db, week.id),
    db.select().from(picks).where(pickScope),
    db.select().from(tiebreakerGuesses).where(guessScope),
  ]);
  const members = final || ctx.role === "admin" ? await listMemberRecords(db, ctx.league.id) : [];
  const tiebreakerGameId = effectiveTiebreakerId(week.tiebreakerGameId, gameRows);

  let results: WeekView["results"] = null;
  if (final) {
    // Scored for the people who were in the league when the week was played, not today's member list.
    const recorded = (await recordedParticipants(db, [week.id])).get(week.id);
    const participants = new Map(
      weekParticipants(members, gameRows, pickRows, recorded).map((m) => [m.userId, m]),
    );
    results = {
      entries: scoreWeek({
        games: gameRows,
        picks: pickRows,
        guesses: guessRows,
        userIds: [...participants.keys()],
        tiebreakerGameId,
      }).map((e) => ({
        ...e,
        displayName: participants.get(e.userId)?.displayName ?? "Player",
        removed: participants.get(e.userId)?.removedAt != null,
      })),
      picks: pickRows
        .filter((p) => participants.has(p.userId))
        .map((p) => ({ userId: p.userId, gameId: p.gameId, side: p.side })),
    };
  }

  return {
    id: week.id,
    leagueId: ctx.league.id,
    leagueName: ctx.league.name,
    timeZone: ctx.league.timeZone,
    role: ctx.role,
    year: ctx.season.year,
    number: week.number,
    status: week.status,
    tiebreakerGameId,
    games: gameRows.map(toGame),
    myPicks: pickRows
      .filter((p) => p.userId === userId)
      .map((p) => ({ gameId: p.gameId, side: p.side, isPow: p.isPow })),
    myTiebreakerTotal: guessRows.find((g) => g.userId === userId)?.total ?? null,
    submissions:
      ctx.role === "admin"
        ? members.filter(isActive).map((m) => {
            const mine = pickRows.filter((p) => p.userId === m.userId);
            return {
              userId: m.userId,
              displayName: m.displayName,
              pickCount: mine.length,
              hasPow: mine.some((p) => p.isPow),
            };
          })
        : null,
    results,
  };
}

export function weekRoutes(
  { db, verifyToken, nfl, insights, now = () => new Date() }: AppDeps,
  services: AppServices,
) {
  const auth = requireAuth(verifyToken);

  /** A week of a pick'em league (weekly or playoff) the caller can see. Another type's week is a 404. */
  async function pickemWeek(weekId: string, userId: string) {
    const ctx = await requireWeek(db, weekId, userId);
    requireLeagueType(ctx.league, ...PICKEM);
    return ctx;
  }

  /** Loads the week for an admin action and checks it is in one of the allowed states. */
  async function adminWeek(weekId: string, userId: string, allowed: WeekContext["week"]["status"][]) {
    const ctx = await pickemWeek(weekId, userId);
    requireAdmin(ctx.role);
    if (!allowed.includes(ctx.week.status)) {
      fail(
        409,
        ctx.week.status === "final" ? "This week is closed. Reopen it to make changes." : "Not allowed yet.",
      );
    }
    return ctx;
  }

  async function adminGame(gameId: string, userId: string) {
    const [game] = await db.select().from(games).where(eq(games.id, gameId));
    if (!game) fail(404, "Game not found");
    return { game, ctx: await adminWeek(game.weekId, userId, ["draft", "open"]) };
  }

  return (
    new Hono<{ Variables: AuthVariables }>()
      // ---------- Admin: week setup ----------
      .post("/leagues/:leagueId/weeks", auth, leagueParam, body(createWeekSchema), async (c) => {
        const { leagueId } = c.req.valid("param");
        const { year, number, importGames: shouldImport } = c.req.valid("json");
        const { league, role } = await requireMember(db, leagueId, c.var.user.id);
        requireLeagueType(league, ...PICKEM);
        requireAdmin(role);
        // Weekly pick'em plays weeks 1–18; a playoff league's rounds are created its own way.
        if (!coversWeek(league.type, number)) fail(409, "That week isn't part of this league's season.");

        await db.insert(seasons).values({ leagueId, year }).onConflictDoNothing();
        const [season] = await db
          .select()
          .from(seasons)
          .where(and(eq(seasons.leagueId, leagueId), eq(seasons.year, year)));
        if (!season) throw new Error("Season upsert returned no row");
        const [week] = await db
          .insert(weeks)
          .values({ seasonId: season.id, number })
          .onConflictDoNothing()
          .returning({ id: weeks.id });
        if (!week) fail(409, "That week already exists.");

        const importError = shouldImport
          ? await importSlate(db, nfl, { id: week.id, year, number }, { requestId: c.get("requestId") })
          : null;
        return c.json({ id: week.id, importError }, 201);
      })
      .post("/weeks/:weekId/import", auth, weekParam, async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["draft"]);
        const error = await importSlate(
          db,
          nfl,
          { id: ctx.week.id, year: ctx.season.year, number: ctx.week.number },
          { requestId: c.get("requestId") },
        );
        if (error) fail(502, error);
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      .patch("/weeks/:weekId", auth, weekParam, body(updateWeekSchema), async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["draft", "open"]);
        const { tiebreakerGameId } = c.req.valid("json");
        const [game] = await db
          .select({ id: games.id })
          .from(games)
          .where(and(eq(games.id, tiebreakerGameId), eq(games.weekId, ctx.week.id)));
        if (!game) fail(400, "That game is not part of this week.");
        await db.update(weeks).set({ tiebreakerGameId }).where(eq(weeks.id, ctx.week.id));
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      .post("/weeks/:weekId/games", auth, weekParam, body(createGameSchema), async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["draft", "open"]);
        const input = c.req.valid("json");
        const kickoff = new Date(input.kickoff);
        await db.insert(games).values({
          weekId: ctx.week.id,
          homeTeam: input.homeTeam,
          awayTeam: input.awayTeam,
          kickoff,
          spread: input.spread,
          spreadByAdmin: true,
          points: input.points ?? defaultPoints(kickoff),
        });
        return c.json(await buildWeekView(db, ctx, c.var.user.id), 201);
      })
      .patch("/games/:gameId", auth, gameParam, body(updateGameSchema), async (c) => {
        const { game, ctx } = await adminGame(c.req.valid("param").gameId, c.var.user.id);
        const input = c.req.valid("json");
        const homeScore = input.homeScore === undefined ? game.homeScore : input.homeScore;
        const awayScore = input.awayScore === undefined ? game.awayScore : input.awayScore;
        if ((homeScore === null) !== (awayScore === null)) fail(400, "Enter both scores, or neither.");
        const kickoff = input.kickoff ? new Date(input.kickoff) : undefined;
        await db
          .update(games)
          .set({
            kickoff,
            spread: input.spread,
            // A spread the admin typed stands: automation never replaces it with the feed's.
            spreadByAdmin: input.spread === undefined ? undefined : true,
            points: input.points ?? (kickoff ? pointsAfterKickoffChange(game, kickoff) : undefined),
            homeScore,
            awayScore,
          })
          .where(eq(games.id, game.id));
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      /** Removing a game also removes any picks already made on it. */
      .delete("/games/:gameId", auth, gameParam, async (c) => {
        const { game, ctx } = await adminGame(c.req.valid("param").gameId, c.var.user.id);
        await db.delete(games).where(eq(games.id, game.id));
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })

      // ---------- Admin: week lifecycle (draft → open → final) ----------
      .post("/weeks/:weekId/open", auth, weekParam, async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["draft"]);
        const problem = openProblem(await gamesOf(db, ctx.week.id));
        if (problem) fail(409, problem);
        await openWeek(db, ctx.week.id);
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      /** Pulls final scores from the provider for games that came from it. Spreads are never touched here. */
      .post("/weeks/:weekId/results", auth, weekParam, async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["open"]);
        let provided: ProviderGame[];
        try {
          provided = await nfl.getWeek(ctx.season.year, ctx.week.number);
        } catch (err) {
          logError("results_sync", err, c.get("requestId"));
          fail(502, "Couldn't load results. Enter the scores by hand, or try again.");
        }
        // The admin asked for the provider's scores, so they replace any typed in.
        await writeFinals(db, await gamesOf(db, ctx.week.id), provided, { overwrite: true });
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      .post("/weeks/:weekId/finalize", auth, weekParam, async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["open"]);
        const problem = finalizeProblem(await gamesOf(db, ctx.week.id));
        if (problem) fail(409, problem);
        // The admin closing the week is shown the results right here, so they don't get the recap as well.
        await db.transaction((tx) =>
          finalizeWeek(tx, {
            weekId: ctx.week.id,
            leagueId: ctx.league.id,
            at: now(),
            actorId: c.var.user.id,
          }),
        );
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      /** Lets the admin correct a score or spread after closing; picks are hidden again until it is re-closed. */
      .post("/weeks/:weekId/reopen", auth, weekParam, async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["final"]);
        await reopenWeek(db, ctx.week.id);
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })

      // ---------- Players ----------
      .get("/weeks/:weekId", auth, weekParam, async (c) => {
        const ctx = await pickemWeek(c.req.valid("param").weekId, c.var.user.id);
        const requestId = c.get("requestId");
        // A league that runs itself takes its next step first (throttled), so nobody waits for the cron.
        await services.advanceLeagueOnRead(ctx.league, requestId);
        await fillFinishedGames(
          db,
          services.results,
          { id: ctx.week.id, status: ctx.week.status, year: ctx.season.year, number: ctx.week.number },
          now(),
          requestId,
        );
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      /** The player has been shown this closed week's recap. See `recapWeekId` on the league. */
      .post("/weeks/:weekId/recap/seen", auth, weekParam, async (c) => {
        const ctx = await requireWeek(db, c.req.valid("param").weekId, c.var.user.id);
        if (ctx.week.status === "final") await markRecapSeen(db, ctx.week.id, c.var.user.id, now());
        return c.json({ ok: true });
      })
      // Public background on a game (team form, market prices). Nothing here is drawn from anyone's picks.
      .get("/games/:gameId/insights", auth, gameParam, async (c) => {
        const [game] = await db
          .select()
          .from(games)
          .where(eq(games.id, c.req.valid("param").gameId));
        if (!game) fail(404, "Game not found");
        // The matchup sheet opens from survivor game cards too. Nothing in it comes from this league's picks.
        requireLeagueType((await requireWeek(db, game.weekId, c.var.user.id)).league, ...PICKEM, "survivor");
        const requestId = c.get("requestId");
        // Each source fails on its own: the sheet shows whatever arrived.
        const [matchup, market] = await Promise.all([
          game.externalId && insights
            ? insights.getMatchup(game.externalId).catch((err) => {
                logError("matchup_insights", err, requestId);
                return null;
              })
            : null,
          insights
            ? insights.getMarket(game).catch((err) => {
                logError("market_insights", err, requestId);
                return null;
              })
            : null,
        ]);
        const result: GameInsights = { matchup, market };
        return c.json(result);
      })
      .put("/weeks/:weekId/picks", auth, weekParam, body(submitPicksSchema), async (c) => {
        const userId = c.var.user.id;
        const ctx = await pickemWeek(c.req.valid("param").weekId, userId);
        const input = c.req.valid("json");
        const weekId = ctx.week.id;

        // Read, validate and write in one transaction, so nothing can change between the check and the save.
        await db.transaction(async (tx) => {
          // Holding the week row stops the admin closing or reopening the week mid-save.
          const [week] = await tx.select().from(weeks).where(eq(weeks.id, weekId)).for("share");
          if (week?.status !== "open") fail(409, "This week is not open for picks.");
          // One submission at a time per player and week: two simultaneous saves can't both see "no pick yet".
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${weekId}:${userId}`}, 0))`);
          // Locks are judged against the time the locks were granted, not when the request arrived: a save that
          // waited past a kickoff must not slip a pick in on that game.
          const at = now();

          const gameRows = await tx
            .select()
            .from(games)
            .where(eq(games.weekId, weekId))
            .orderBy(asc(games.kickoff), asc(games.id));
          const existing = await tx
            .select()
            .from(picks)
            .where(and(eq(picks.weekId, weekId), eq(picks.userId, userId)));
          const [guess] = await tx
            .select()
            .from(tiebreakerGuesses)
            .where(and(eq(tiebreakerGuesses.weekId, weekId), eq(tiebreakerGuesses.userId, userId)));

          const tiebreakerGameId = effectiveTiebreakerId(week.tiebreakerGameId, gameRows);
          const tiebreakerRow = gameRows.find((g) => g.id === tiebreakerGameId);
          const error =
            checkPickSubmission({
              games: gameRows.map((g) => ({
                id: g.id,
                kickoff: g.kickoff,
                final: hasResult(g),
                label: `${g.awayTeam} at ${g.homeTeam}`,
              })),
              existing,
              picks: input.picks,
              powGameId: input.powGameId,
              now: at,
            }) ??
            checkTiebreakerGuess({
              tiebreakerGame: tiebreakerRow
                ? { kickoff: tiebreakerRow.kickoff, final: hasResult(tiebreakerRow) }
                : null,
              existing: guess?.total ?? null,
              total: input.tiebreakerTotal,
              now: at,
            });
          // Throwing rolls the transaction back, so a rejected submission saves nothing.
          if (error) fail(409, error);

          const savedSide = new Map(existing.map((p) => [p.gameId, p.side]));
          const currentPow = existing.find((p) => p.isPow)?.gameId ?? null;
          for (const pick of input.picks) {
            if (savedSide.get(pick.gameId) === pick.side) continue;
            await tx
              .insert(picks)
              .values({ weekId, gameId: pick.gameId, userId, side: pick.side })
              .onConflictDoUpdate({
                target: [picks.gameId, picks.userId],
                set: { side: pick.side, updatedAt: at },
              });
          }
          if (input.powGameId !== currentPow) {
            const mine = and(eq(picks.weekId, weekId), eq(picks.userId, userId));
            await tx
              .update(picks)
              .set({ isPow: false })
              .where(and(mine, eq(picks.isPow, true)));
            if (input.powGameId) {
              await tx
                .update(picks)
                .set({ isPow: true })
                .where(and(mine, eq(picks.gameId, input.powGameId)));
            }
          }
          if (input.tiebreakerTotal !== null && input.tiebreakerTotal !== guess?.total) {
            await tx
              .insert(tiebreakerGuesses)
              .values({ weekId, userId, total: input.tiebreakerTotal })
              .onConflictDoUpdate({
                target: [tiebreakerGuesses.weekId, tiebreakerGuesses.userId],
                set: { total: input.tiebreakerTotal, updatedAt: at },
              });
          }
        });
        return c.json(await buildWeekView(db, ctx, userId));
      })
  );
}
