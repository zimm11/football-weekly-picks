import { profiles, squareBoards, squareClaims, squareScores } from "@picks/db";
import {
  type BoardFeedGame,
  type BoardGame,
  type BoardSummary,
  type BoardView,
  boardFeedGamesQuerySchema,
  boardLocked,
  boardPhase,
  boardScoreBodySchema,
  checkClaim,
  checkLimitChange,
  checkRelease,
  claimSquareSchema,
  createBoardSchema,
  cryptoRandom,
  currentSquare,
  drawDigits,
  type RandomSource,
  SQUARE_PERIOD_LABEL,
  SQUARE_PERIODS,
  type SquarePeriod,
  seasonYear,
  squareWinners,
  updateBoardSchema,
} from "@picks/shared";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "./auth";
import {
  type AppDeps,
  type BoardContext,
  boardParam,
  body,
  fail,
  leagueParam,
  param,
  query,
  requireAdmin,
  requireBoard,
  requireLeagueType,
  requireMember,
  type Store,
  type Tx,
} from "./context";
import { deliverLeagueEventsSoon, type LeagueEventDeps, queueLeagueEvent } from "./leagueEvents";
import type { ProviderGame } from "./nfl";
import type { AppServices } from "./services";
import type { LeagueTypeHooks } from "./typeHooks";
import type { ProviderWeeks } from "./weekOps";

/*
 * Squares' own routes: boards, claims, the lock and draw, and score corrections. League routes check the league's
 * type first (`requireLeagueType`); board routes go through `requireBoard`, which also holds them to squares
 * leagues and current members. Every write takes the board's row lock first (`lockBoard`), so the limit, "already
 * taken" and the draw can't be raced, and the draw (`drawBoard`, also run by automation at kickoff) is guarded by
 * `drawn_at is null`, so it happens once. A board is public: everyone in the league sees every square.
 */

export type BoardRow = typeof squareBoards.$inferSelect;
type ClaimRow = typeof squareClaims.$inferSelect;
type ScoreRow = typeof squareScores.$inferSelect;
type Queued = { emails: number; pushes: number };

const NONE: Queued = { emails: 0, pushes: 0 };
const add = (a: Queued, b: Queued): Queued => ({ emails: a.emails + b.emails, pushes: a.pushes + b.pushes });

/** Takes the board's row lock for the rest of the transaction. Null when the board is gone. */
export async function lockBoard(tx: Tx, boardId: string): Promise<BoardRow | null> {
  const [board] = await tx.select().from(squareBoards).where(eq(squareBoards.id, boardId)).for("update");
  return board ?? null;
}

const boardPath = (boardId: string) => `/boards/${boardId}`;

/**
 * Locks a board and draws its numbers, inside the caller's transaction with the board row locked. Does nothing
 * when they are already drawn, so two requests (or the cron and an admin) can't draw twice. Queues "the numbers
 * are drawn" for the league, by email and push; the payload names no square and no team.
 */
export async function drawBoard(
  tx: Tx,
  board: BoardRow,
  input: { random?: RandomSource; now: Date; notify: LeagueEventDeps; actorId?: string },
): Promise<{ drawn: boolean } & Queued> {
  if (board.drawnAt) return { drawn: false, ...NONE };
  const random = input.random ?? cryptoRandom;
  const homeDigits = drawDigits(random);
  const awayDigits = drawDigits(random);
  const updated = await tx
    .update(squareBoards)
    .set({ homeDigits, awayDigits, drawnAt: input.now })
    .where(and(eq(squareBoards.id, board.id), isNull(squareBoards.drawnAt)))
    .returning({ id: squareBoards.id });
  if (!updated.length) return { drawn: false, ...NONE };
  const queued = await queueLeagueEvent(
    tx,
    input.notify,
    {
      leagueId: board.leagueId,
      event: `squares-drawn:${board.id}`,
      headline: "The numbers are drawn",
      detail: "The squares board is locked and its numbers are drawn.",
      path: boardPath(board.id),
      actionLabel: "See the board",
      boardId: board.id,
      exceptUserIds: input.actorId ? [input.actorId] : undefined,
    },
    input.now,
  );
  return { drawn: true, ...queued };
}

/**
 * Records one period's score, inside the caller's transaction with the board row locked. The feed (`byAdmin`
 * false) never replaces a score an admin typed; an admin's replaces anything. The first score for a period
 * queues its result, by push only (it would spend the email budget), naming no square and no team.
 */
export async function recordBoardScore(
  tx: Tx,
  board: BoardRow,
  input: {
    period: SquarePeriod;
    homeScore: number;
    awayScore: number;
    byAdmin: boolean;
    now: Date;
    notify: LeagueEventDeps;
  },
): Promise<{ changed: boolean } & Queued> {
  const { period, homeScore, awayScore, byAdmin } = input;
  const [existing] = await tx
    .select()
    .from(squareScores)
    .where(and(eq(squareScores.boardId, board.id), eq(squareScores.period, period)));
  if (existing) {
    if (existing.byAdmin && !byAdmin) return { changed: false, ...NONE };
    if (
      existing.homeScore === homeScore &&
      existing.awayScore === awayScore &&
      existing.byAdmin === byAdmin
    ) {
      return { changed: false, ...NONE };
    }
    await tx
      .update(squareScores)
      .set({ homeScore, awayScore, byAdmin })
      .where(and(eq(squareScores.boardId, board.id), eq(squareScores.period, period)));
    return { changed: true, ...NONE };
  }
  await tx.insert(squareScores).values({ boardId: board.id, period, homeScore, awayScore, byAdmin });
  const label = SQUARE_PERIOD_LABEL[period];
  const queued = await queueLeagueEvent(
    tx,
    input.notify,
    {
      leagueId: board.leagueId,
      event: `squares-result:${board.id}:${period}`,
      headline: period === "final" ? "The final square is in" : `The ${label} square is in`,
      path: boardPath(board.id),
      actionLabel: "See the board",
      boardId: board.id,
      pushOnly: true,
    },
    input.now,
  );
  return { changed: true, ...queued };
}

/** The feed's view of a board's game, through the shared once-a-minute results cache. */
export async function feedGameOf(
  results: ProviderWeeks,
  board: Pick<BoardRow, "externalId" | "year" | "week">,
  requestId?: string,
): Promise<ProviderGame | null | undefined> {
  if (!board.externalId || board.year === null || board.week === null) return undefined;
  const games = await results(board.year, board.week, requestId);
  if (!games) return null;
  return games.find((g) => g.externalId === board.externalId);
}

const boardRules = (board: BoardRow) => ({
  kickoff: board.kickoff,
  maxPerPlayer: board.maxPerPlayer,
  drawnAt: board.drawnAt,
});

type Named = ClaimRow & { name: string };

async function claimsOf(db: Store, boardIds: string[]): Promise<Named[]> {
  if (!boardIds.length) return [];
  const rows = await db
    .select({ claim: squareClaims, displayName: profiles.displayName })
    .from(squareClaims)
    .leftJoin(profiles, eq(profiles.userId, squareClaims.userId))
    .where(inArray(squareClaims.boardId, boardIds))
    .orderBy(asc(squareClaims.row), asc(squareClaims.col));
  return rows.map(({ claim, displayName }) => ({
    ...claim,
    name: claim.guestName ?? displayName ?? "Player",
  }));
}

async function scoresOf(db: Store, boardIds: string[]): Promise<ScoreRow[]> {
  if (!boardIds.length) return [];
  return db.select().from(squareScores).where(inArray(squareScores.boardId, boardIds));
}

function summaryOf(board: BoardRow, claims: ClaimRow[], scores: ScoreRow[], userId: string, now: Date) {
  return {
    id: board.id,
    homeTeam: board.homeTeam,
    awayTeam: board.awayTeam,
    kickoff: board.kickoff.toISOString(),
    phase: boardPhase(board, scores, now),
    claimed: claims.length,
    mine: claims.filter((c) => c.userId === userId).length,
    maxPerPlayer: board.maxPerPlayer,
  } satisfies BoardSummary;
}

const owner = (c: Named) => ({ userId: c.userId, name: c.name, guest: c.userId === null });

/** One board as every member sees it. Re-reads the board, since the caller may have just changed it. */
export async function buildBoardView(
  db: Store,
  ctx: Pick<BoardContext, "league" | "role">,
  boardId: string,
  userId: string,
  now: Date,
  live: { home: number; away: number } | null = null,
): Promise<BoardView> {
  const [board] = await db.select().from(squareBoards).where(eq(squareBoards.id, boardId));
  if (!board) fail(404, "Board not found");
  const claims = await claimsOf(db, [board.id]);
  const scores = await scoresOf(db, [board.id]);
  const ordered = SQUARE_PERIODS.flatMap((period) => scores.filter((s) => s.period === period));
  const summary = summaryOf(board, claims, scores, userId, now);
  const liveScore =
    live && summary.phase === "underway" ? { homeScore: live.home, awayScore: live.away } : null;
  const players = new Map<string, BoardView["players"][number]>();
  for (const claim of claims) {
    const key = claim.userId ?? `guest:${claim.name.toLowerCase()}`;
    const entry = players.get(key) ?? { ...owner(claim), count: 0 };
    entry.count++;
    players.set(key, entry);
  }
  return {
    ...summary,
    leagueId: ctx.league.id,
    leagueName: ctx.league.name,
    timeZone: ctx.league.timeZone,
    role: ctx.role,
    externalId: board.externalId,
    year: board.year,
    week: board.week,
    homeDigits: board.homeDigits,
    awayDigits: board.awayDigits,
    drawnAt: board.drawnAt?.toISOString() ?? null,
    squares: claims.map((c) => ({ row: c.row, col: c.col, ...owner(c) })),
    scores: ordered.map(({ period, homeScore, awayScore, byAdmin }) => ({
      period,
      homeScore,
      awayScore,
      byAdmin,
    })),
    quarters: squareWinners(board, ordered, claims).map(({ winner, ...result }) => ({
      ...result,
      winner: winner ? owner(winner) : null,
    })),
    live: liveScore,
    current: summary.phase === "underway" ? currentSquare(board, ordered, liveScore) : null,
    players: [...players.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** A board's game as stored: from the feed (looked up now), or typed by hand. */
async function resolveGame(
  results: ProviderWeeks,
  game: BoardGame | undefined,
  now: Date,
  requestId?: string,
): Promise<Pick<BoardRow, "externalId" | "year" | "week" | "homeTeam" | "awayTeam" | "kickoff">> {
  const pick = game?.source === "feed" ? game : undefined;
  if (game?.source === "manual") {
    return {
      externalId: null,
      year: null,
      week: null,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      kickoff: new Date(game.kickoff),
    };
  }
  const year = pick?.year ?? seasonYear(now);
  const week = pick?.week ?? 22;
  const provided = await results(year, week, requestId);
  if (!provided) fail(502, "Couldn't load the schedule. Type the game in, or try again.");
  const found = pick ? provided.find((g) => g.externalId === pick.externalId) : provided[0];
  if (!found) {
    fail(
      409,
      pick
        ? "That game isn't on the schedule anymore. Choose another."
        : "The Super Bowl isn't on the schedule yet. Choose another game, or type it in.",
    );
  }
  return {
    externalId: found.externalId,
    year,
    week,
    homeTeam: found.homeTeam,
    awayTeam: found.awayTeam,
    kickoff: found.kickoff,
  };
}

export const squaresHooks: LeagueTypeHooks = {
  /**
   * A member who leaves before the lock gives their squares back. After the lock (drawn, or kickoff passed)
   * their squares stay under their name.
   */
  async memberRemoved(tx, { leagueId, userId, at }) {
    const open = await tx
      .select({ id: squareBoards.id })
      .from(squareBoards)
      .where(
        and(eq(squareBoards.leagueId, leagueId), isNull(squareBoards.drawnAt), gt(squareBoards.kickoff, at)),
      )
      .orderBy(asc(squareBoards.id))
      .for("update");
    if (!open.length) return;
    await tx.delete(squareClaims).where(
      and(
        eq(squareClaims.userId, userId),
        inArray(
          squareClaims.boardId,
          open.map((b) => b.id),
        ),
      ),
    );
  },
};

const squareParam = param(
  z.object({
    boardId: z.uuid(),
    row: z.coerce.number().int().min(0).max(9),
    col: z.coerce.number().int().min(0).max(9),
  }),
);
const periodParam = param(z.object({ boardId: z.uuid(), period: z.enum(SQUARE_PERIODS) }));

export function squaresRoutes(deps: AppDeps, services: AppServices) {
  const { db, verifyToken } = deps;
  const auth = requireAuth(verifyToken);
  const clock = () => (deps.now ? deps.now() : new Date());
  const notify: LeagueEventDeps = { email: deps.email, push: deps.push, nativePush: deps.nativePush };

  /** The board, with the board row locked and the caller's access checked after the lock. */
  async function lockedBoard(tx: Tx, boardId: string, userId: string) {
    const board = await lockBoard(tx, boardId);
    if (!board) fail(404, "Board not found");
    const ctx = await requireBoard(tx, boardId, userId);
    return { ...ctx, board };
  }

  async function read(boardId: string, userId: string, requestId?: string) {
    const ctx = await requireBoard(db, boardId, userId);
    await services.advanceLeagueOnRead(ctx.league, requestId);
    const now = clock();
    const [board] = await db.select().from(squareBoards).where(eq(squareBoards.id, boardId));
    if (!board) fail(404, "Board not found");
    let live: { home: number; away: number } | null = null;
    if (board.drawnAt && now >= board.kickoff) {
      const game = await feedGameOf(services.results, board, requestId);
      if (game?.status === "in_progress") live = game.liveScore ?? null;
    }
    return buildBoardView(db, ctx, boardId, userId, now, live);
  }

  // Keep routes chained, or `ApiType` loses their types.
  return (
    new Hono<{ Variables: AuthVariables }>()
      /** The league's boards, soonest kickoff first. */
      .get("/leagues/:leagueId/boards", auth, leagueParam, async (c) => {
        const { league } = await requireMember(db, c.req.valid("param").leagueId, c.var.user.id);
        requireLeagueType(league, "squares");
        await services.advanceLeagueOnRead(league, c.get("requestId"));
        const boards = await db
          .select()
          .from(squareBoards)
          .where(eq(squareBoards.leagueId, league.id))
          .orderBy(asc(squareBoards.kickoff), asc(squareBoards.createdAt));
        const ids = boards.map((b) => b.id);
        const claims = await claimsOf(db, ids);
        const scores = await scoresOf(db, ids);
        const now = clock();
        return c.json(
          boards.map((b) =>
            summaryOf(
              b,
              claims.filter((x) => x.boardId === b.id),
              scores.filter((x) => x.boardId === b.id),
              c.var.user.id,
              now,
            ),
          ),
        );
      })
      /** The feed's games for one week, for an admin choosing a board's game. */
      .get(
        "/leagues/:leagueId/boards/games",
        auth,
        leagueParam,
        query(boardFeedGamesQuerySchema, "Choose a season and week"),
        async (c) => {
          const { league, role } = await requireMember(db, c.req.valid("param").leagueId, c.var.user.id);
          requireLeagueType(league, "squares");
          requireAdmin(role);
          const { year, week } = c.req.valid("query");
          const games = await services.results(year, week, c.get("requestId"));
          if (!games) fail(502, "Couldn't load the schedule. Try again.");
          return c.json(
            games.map(
              (g): BoardFeedGame => ({
                externalId: g.externalId,
                homeTeam: g.homeTeam,
                awayTeam: g.awayTeam,
                kickoff: g.kickoff.toISOString(),
              }),
            ),
          );
        },
      )
      /** A new board: the Super Bowl by default, a feed game, or teams and kickoff typed by hand. */
      .post("/leagues/:leagueId/boards", auth, leagueParam, body(createBoardSchema), async (c) => {
        const { league, role } = await requireMember(db, c.req.valid("param").leagueId, c.var.user.id);
        requireLeagueType(league, "squares");
        requireAdmin(role);
        const input = c.req.valid("json");
        const now = clock();
        const game = await resolveGame(services.results, input.game, now, c.get("requestId"));
        if (game.kickoff <= now) fail(409, "That game has already kicked off.");
        const [board] = await db
          .insert(squareBoards)
          .values({ leagueId: league.id, ...game, maxPerPlayer: input.maxPerPlayer })
          .returning({ id: squareBoards.id });
        if (!board) fail(409, "Couldn't create the board.");
        return c.json({ id: board.id }, 201);
      })
      .get("/boards/:boardId", auth, boardParam, async (c) =>
        c.json(await read(c.req.valid("param").boardId, c.var.user.id, c.get("requestId"))),
      )
      /** The admin's changes: the game (before the lock) and the limit (raised before the lock, never lowered). */
      .patch("/boards/:boardId", auth, boardParam, body(updateBoardSchema), async (c) => {
        const { boardId } = c.req.valid("param");
        const input = c.req.valid("json");
        const userId = c.var.user.id;
        const now = clock();
        // The feed is asked before the transaction, so the board row isn't held while it answers.
        const game = input.game
          ? await resolveGame(services.results, input.game, now, c.get("requestId"))
          : undefined;
        const view = await db.transaction(async (tx) => {
          const ctx = await lockedBoard(tx, boardId, userId);
          requireAdmin(ctx.role);
          if (input.maxPerPlayer !== undefined) {
            const problem = checkLimitChange(boardRules(ctx.board), input.maxPerPlayer, now);
            if (problem) fail(409, problem);
          }
          if (game) {
            if (boardLocked(ctx.board, now)) fail(409, "The board is locked.");
            if (game.kickoff <= now) fail(409, "That game has already kicked off.");
          }
          await tx
            .update(squareBoards)
            .set({
              ...game,
              ...(input.maxPerPlayer !== undefined ? { maxPerPlayer: input.maxPerPlayer } : {}),
            })
            .where(eq(squareBoards.id, boardId));
          return buildBoardView(tx, ctx, boardId, userId, now);
        });
        return c.json(view);
      })
      /** Claims a square: for yourself, or (an admin) under a guest's name. */
      .put("/boards/:boardId/squares/:row/:col", auth, squareParam, body(claimSquareSchema), async (c) => {
        const { boardId, row, col } = c.req.valid("param");
        const { guestName } = c.req.valid("json");
        const userId = c.var.user.id;
        const now = clock();
        const view = await db.transaction(async (tx) => {
          const ctx = await lockedBoard(tx, boardId, userId);
          if (guestName !== undefined) requireAdmin(ctx.role);
          const [taken] = await tx
            .select()
            .from(squareClaims)
            .where(
              and(eq(squareClaims.boardId, boardId), eq(squareClaims.row, row), eq(squareClaims.col, col)),
            );
          const [mine] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(squareClaims)
            .where(and(eq(squareClaims.boardId, boardId), eq(squareClaims.userId, userId)));
          const problem = checkClaim({
            board: boardRules(ctx.board),
            taken: taken ?? null,
            mine: mine?.count ?? 0,
            guest: guestName !== undefined,
            now,
          });
          if (problem) fail(409, problem);
          await tx.insert(squareClaims).values({
            boardId,
            row,
            col,
            userId: guestName === undefined ? userId : null,
            guestName: guestName ?? null,
          });
          return buildBoardView(tx, ctx, boardId, userId, now);
        });
        return c.json(view);
      })
      /** Releases a square: your own, or (an admin) any, until the lock. */
      .delete("/boards/:boardId/squares/:row/:col", auth, squareParam, async (c) => {
        const { boardId, row, col } = c.req.valid("param");
        const userId = c.var.user.id;
        const now = clock();
        const view = await db.transaction(async (tx) => {
          const ctx = await lockedBoard(tx, boardId, userId);
          const where = and(
            eq(squareClaims.boardId, boardId),
            eq(squareClaims.row, row),
            eq(squareClaims.col, col),
          );
          const [claim] = await tx.select().from(squareClaims).where(where);
          const problem = checkRelease({
            board: ctx.board,
            claim: claim ?? null,
            userId,
            admin: ctx.role === "admin",
            now,
          });
          if (problem) fail(409, problem);
          await tx.delete(squareClaims).where(where);
          return buildBoardView(tx, ctx, boardId, userId, now);
        });
        return c.json(view);
      })
      /**
       * Deletes a board (admin), at any time: its squares, numbers and scores go with it, and reminders or
       * notifications still queued for it are dropped at send time.
       */
      .delete("/boards/:boardId", auth, boardParam, async (c) => {
        const { boardId } = c.req.valid("param");
        const leagueId = await db.transaction(async (tx) => {
          const ctx = await lockedBoard(tx, boardId, c.var.user.id);
          requireAdmin(ctx.role);
          await tx.delete(squareBoards).where(eq(squareBoards.id, boardId));
          return ctx.league.id;
        });
        return c.json({ leagueId });
      })
      /** Lock and draw: the admin's, before kickoff. It happens once. */
      .post("/boards/:boardId/lock", auth, boardParam, async (c) => {
        const { boardId } = c.req.valid("param");
        const userId = c.var.user.id;
        const now = clock();
        const { view, queued } = await db.transaction(async (tx) => {
          const ctx = await lockedBoard(tx, boardId, userId);
          requireAdmin(ctx.role);
          if (ctx.board.drawnAt) fail(409, "The numbers have already been drawn.");
          const result = await drawBoard(tx, ctx.board, {
            random: deps.random,
            now,
            notify,
            actorId: userId,
          });
          return { view: await buildBoardView(tx, ctx, boardId, userId, now), queued: result };
        });
        deliverLeagueEventsSoon(deps, queued, now);
        return c.json(view);
      })
      /** The admin's score for one period, never overwritten by the feed. Both scores null clears it. */
      .put("/boards/:boardId/scores/:period", auth, periodParam, body(boardScoreBodySchema), async (c) => {
        const { boardId, period } = c.req.valid("param");
        const { homeScore, awayScore } = c.req.valid("json");
        const userId = c.var.user.id;
        const now = clock();
        const { view, queued } = await db.transaction(async (tx) => {
          const ctx = await lockedBoard(tx, boardId, userId);
          requireAdmin(ctx.role);
          if (!ctx.board.drawnAt) fail(409, "Lock and draw the board before entering scores.");
          let queued = NONE;
          if (homeScore === null || awayScore === null) {
            await tx
              .delete(squareScores)
              .where(and(eq(squareScores.boardId, boardId), eq(squareScores.period, period)));
          } else {
            queued = add(
              queued,
              await recordBoardScore(tx, ctx.board, {
                period,
                homeScore,
                awayScore,
                byAdmin: true,
                now,
                notify,
              }),
            );
          }
          return { view: await buildBoardView(tx, ctx, boardId, userId, now), queued };
        });
        deliverLeagueEventsSoon(deps, queued, now);
        return c.json(view);
      })
  );
}
