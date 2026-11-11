import { type Db, games, picks, seasons, tiebreakerGuesses, weeks } from "@picks/db";
import {
  checkPickSubmission,
  checkTiebreakerGuess,
  createGameSchema,
  createWeekSchema,
  defaultPoints,
  effectiveTiebreakerId,
  type Game,
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
  requireAdmin,
  requireMember,
  requireWeek,
  type WeekContext,
  weekParam,
  weekParticipants,
} from "./context";

type GameRow = typeof games.$inferSelect;

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

/** A game with a result is closed to picks, whatever the clock says. */
const isFinal = (g: GameRow) => g.homeScore !== null && g.awayScore !== null;

const gamesOf = (db: Db, weekId: string) =>
  db.select().from(games).where(eq(games.weekId, weekId)).orderBy(asc(games.kickoff), asc(games.id));

async function buildWeekView(db: Db, ctx: WeekContext, userId: string): Promise<WeekView> {
  // Re-read the week: the caller may have just changed it.
  const [week] = await db.select().from(weeks).where(eq(weeks.id, ctx.week.id));
  if (!week) fail(404, "Week not found");
  const [gameRows, pickRows, guessRows] = await Promise.all([
    gamesOf(db, week.id),
    db.select().from(picks).where(eq(picks.weekId, week.id)),
    db.select().from(tiebreakerGuesses).where(eq(tiebreakerGuesses.weekId, week.id)),
  ]);
  const members =
    week.status === "final" || ctx.role === "admin" ? await listMemberRecords(db, ctx.league.id) : [];
  const tiebreakerGameId = effectiveTiebreakerId(week.tiebreakerGameId, gameRows);

  let results: WeekView["results"] = null;
  if (week.status === "final") {
    // Scored for the people who were in the league when the week was played, not today's member list.
    const participants = new Map(weekParticipants(members, gameRows, pickRows).map((m) => [m.userId, m]));
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

export function weekRoutes({ db, verifyToken, nfl, now = () => new Date() }: AppDeps) {
  const auth = requireAuth(verifyToken);

  /** Adds the provider's games to a week and refreshes kickoffs and spreads of the ones already there. */
  async function importGames(weekId: string, year: number, number: number): Promise<string | null> {
    let provided: Awaited<ReturnType<typeof nfl.getWeek>>;
    try {
      provided = await nfl.getWeek(year, number);
    } catch (err) {
      console.error("Schedule import failed:", err instanceof Error ? err.message : err);
      return "Couldn't load the schedule. Add games by hand, or try the import again.";
    }
    if (provided.length === 0) return "No games are scheduled for that week yet.";
    const existing = new Map((await gamesOf(db, weekId)).map((g) => [g.externalId, g]));
    for (const g of provided) {
      const current = existing.get(g.externalId);
      if (current) {
        await db
          .update(games)
          .set({ kickoff: g.kickoff, spread: g.spread ?? current.spread })
          .where(eq(games.id, current.id));
      } else {
        await db.insert(games).values({
          weekId,
          externalId: g.externalId,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          kickoff: g.kickoff,
          spread: g.spread,
          points: defaultPoints(g.kickoff),
        });
      }
    }
    return null;
  }

  /** Loads the week for an admin action and checks it is in one of the allowed states. */
  async function adminWeek(weekId: string, userId: string, allowed: WeekContext["week"]["status"][]) {
    const ctx = await requireWeek(db, weekId, userId);
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
        requireAdmin((await requireMember(db, leagueId, c.var.user.id)).role);

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

        const importError = shouldImport ? await importGames(week.id, year, number) : null;
        return c.json({ id: week.id, importError }, 201);
      })
      .post("/weeks/:weekId/import", auth, weekParam, async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["draft"]);
        const error = await importGames(ctx.week.id, ctx.season.year, ctx.week.number);
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
        await db
          .update(games)
          .set({
            kickoff: input.kickoff ? new Date(input.kickoff) : undefined,
            spread: input.spread,
            points: input.points,
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
        const gameRows = await gamesOf(db, ctx.week.id);
        if (gameRows.length === 0) fail(409, "Add at least one game before opening the week.");
        if (gameRows.some((g) => g.spread === null))
          fail(409, "Every game needs a spread before the week opens.");
        await db.update(weeks).set({ status: "open" }).where(eq(weeks.id, ctx.week.id));
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      /** Pulls final scores from the provider for games that came from it. */
      .post("/weeks/:weekId/results", auth, weekParam, async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["open"]);
        let provided: Awaited<ReturnType<typeof nfl.getWeek>>;
        try {
          provided = await nfl.getWeek(ctx.season.year, ctx.week.number);
        } catch (err) {
          console.error("Results sync failed:", err instanceof Error ? err.message : err);
          fail(502, "Couldn't load results. Enter the scores by hand, or try again.");
        }
        const finals = new Map(provided.filter((g) => g.homeScore !== null).map((g) => [g.externalId, g]));
        for (const game of await gamesOf(db, ctx.week.id)) {
          const final = game.externalId ? finals.get(game.externalId) : undefined;
          if (!final) continue;
          await db
            .update(games)
            .set({ homeScore: final.homeScore, awayScore: final.awayScore })
            .where(eq(games.id, game.id));
        }
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      .post("/weeks/:weekId/finalize", auth, weekParam, async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["open"]);
        const gameRows = await gamesOf(db, ctx.week.id);
        if (gameRows.some((g) => g.homeScore === null || g.awayScore === null)) {
          fail(409, "Every game needs a final score before the week can close.");
        }
        await db.update(weeks).set({ status: "final" }).where(eq(weeks.id, ctx.week.id));
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      /** Lets the admin correct a score or spread after closing; picks are hidden again until it is re-closed. */
      .post("/weeks/:weekId/reopen", auth, weekParam, async (c) => {
        const ctx = await adminWeek(c.req.valid("param").weekId, c.var.user.id, ["final"]);
        await db.update(weeks).set({ status: "open" }).where(eq(weeks.id, ctx.week.id));
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })

      // ---------- Players ----------
      .get("/weeks/:weekId", auth, weekParam, async (c) => {
        const ctx = await requireWeek(db, c.req.valid("param").weekId, c.var.user.id);
        return c.json(await buildWeekView(db, ctx, c.var.user.id));
      })
      .put("/weeks/:weekId/picks", auth, weekParam, body(submitPicksSchema), async (c) => {
        const userId = c.var.user.id;
        const ctx = await requireWeek(db, c.req.valid("param").weekId, userId);
        const input = c.req.valid("json");
        const at = now();
        const weekId = ctx.week.id;

        // Read, validate and write in one transaction, so nothing can change between the check and the save.
        await db.transaction(async (tx) => {
          // Holding the week row stops the admin closing or reopening the week mid-save.
          const [week] = await tx.select().from(weeks).where(eq(weeks.id, weekId)).for("share");
          if (week?.status !== "open") fail(409, "This week is not open for picks.");
          // One submission at a time per player and week: two simultaneous saves can't both see "no pick yet".
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${weekId}:${userId}`}, 0))`);

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
                final: isFinal(g),
                label: `${g.awayTeam} at ${g.homeTeam}`,
              })),
              existing,
              picks: input.picks,
              powGameId: input.powGameId,
              tiebreakerGameId,
              timeZone: ctx.league.timeZone,
              now: at,
            }) ??
            checkTiebreakerGuess({
              tiebreakerGame: tiebreakerRow
                ? { kickoff: tiebreakerRow.kickoff, final: isFinal(tiebreakerRow) }
                : null,
              existing: guess?.total ?? null,
              total: input.tiebreakerTotal,
              timeZone: ctx.league.timeZone,
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
