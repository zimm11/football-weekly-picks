import { leagues, squareBoards, squareScores } from "@picks/db";
import { SQUARE_PERIODS } from "@picks/shared";
import { and, asc, eq, exists, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { logError } from "../logging";
import { type BoardRow, drawBoard, feedGameOf, lockBoard, recordBoardScore } from "../squares";
import type { AdvanceResult, AutomationContext, LeagueTypeAutomation } from "./types";

/*
 * Squares: a board not yet drawn follows its feed game's kickoff (a flexed or postponed game), so it locks when
 * the game really starts; then lock and draw at kickoff if no admin has, and fill in each quarter's score from the feed as
 * it settles (`ProviderGame.periodScores`, cumulative, the final with overtime), never over a score an admin
 * typed. Each step takes the board's row lock and is idempotent: the draw is guarded by `drawn_at is null`, a
 * score is written once per period (and only changed if the feed corrects it), and each event's dedupe key is
 * per board and period. "Numbers drawn" goes by email and push; each quarter's result by push only.
 */

/** How long after kickoff the feed is still asked for a board's scores. After that, the admin types them. */
export const BOARD_SCORES_WINDOW_MS = 24 * 60 * 60_000;

/** A board with something to do at `now`: undrawn past kickoff, or a feed game under way with no final yet. */
const dueBoard = (now: Date) =>
  and(
    lte(squareBoards.kickoff, now),
    or(
      isNull(squareBoards.drawnAt),
      and(
        isNotNull(squareBoards.externalId),
        gt(squareBoards.kickoff, new Date(now.getTime() - BOARD_SCORES_WINDOW_MS)),
        sql`not exists (select 1 from ${squareScores} where ${squareScores.boardId} = ${squareBoards.id} and ${squareScores.period} = 'final')`,
      ),
    ),
  );

/**
 * Moves an undrawn board to its feed game's kickoff when the feed has changed it. Returns whether it moved. A
 * board on a game typed by hand, or one the feed no longer lists, is left as it stands.
 */
async function followKickoff(ctx: AutomationContext, row: BoardRow): Promise<boolean> {
  const game = await feedGameOf(ctx.results, row, ctx.requestId);
  if (!game || game.kickoff.getTime() === row.kickoff.getTime()) return false;
  return ctx.db.transaction(async (tx) => {
    const board = await lockBoard(tx, row.id);
    if (!board || board.drawnAt || board.kickoff.getTime() === game.kickoff.getTime()) return false;
    await tx.update(squareBoards).set({ kickoff: game.kickoff }).where(eq(squareBoards.id, board.id));
    return true;
  });
}

/** One board's steps. Each runs in its own transaction holding the board row. */
async function advanceBoard(ctx: AutomationContext, row: BoardRow): Promise<AdvanceResult> {
  const result: AdvanceResult = { steps: 0, emails: 0, pushes: 0 };
  const tally = (queued: { emails: number; pushes: number }) => {
    result.emails += queued.emails;
    result.pushes += queued.pushes;
  };
  // Lock and draw at kickoff, if no admin did.
  if (!row.drawnAt && ctx.now >= row.kickoff) {
    const drawn = await ctx.db.transaction(async (tx) => {
      const board = await lockBoard(tx, row.id);
      if (!board || board.drawnAt || ctx.now < board.kickoff) return null;
      return drawBoard(tx, board, { random: ctx.random, now: ctx.now, notify: ctx.notify });
    });
    if (drawn?.drawn) {
      result.steps++;
      tally(drawn);
    }
  }
  // Quarter scores from the feed. The feed is asked before the transaction, through the shared cache.
  const game = await feedGameOf(ctx.results, row, ctx.requestId);
  const settled = game?.periodScores;
  if (!settled || !SQUARE_PERIODS.some((p) => settled[p])) return result;
  await ctx.db.transaction(async (tx) => {
    const board = await lockBoard(tx, row.id);
    if (!board?.drawnAt) return;
    for (const period of SQUARE_PERIODS) {
      const score = settled[period];
      if (!score) continue;
      const written = await recordBoardScore(tx, board, {
        period,
        homeScore: score.home,
        awayScore: score.away,
        byAdmin: false,
        now: ctx.now,
        notify: ctx.notify,
      });
      if (written.changed) {
        result.steps++;
        tally(written);
      }
    }
  });
  return result;
}

export const squaresAutomation: LeagueTypeAutomation = {
  async due(ctx, limit) {
    return (
      ctx.db
        .select()
        .from(leagues)
        .where(
          and(
            eq(leagues.type, "squares"),
            exists(
              ctx.db
                .select({ one: sql`1` })
                .from(squareBoards)
                .where(and(eq(squareBoards.leagueId, leagues.id), dueBoard(ctx.now))),
            ),
          ),
        )
        // A different order each run: on a day when more leagues are due than fit one batch (the Super Bowl),
        // every league gets its draw and its quarter results within a few runs.
        .orderBy(sql`random()`)
        .limit(limit)
    );
  },
  async advance(ctx, league) {
    const total: AdvanceResult = { steps: 0, emails: 0, pushes: 0 };
    // Kickoffs first, so a postponed game's board isn't drawn at its old time.
    const undrawn = await ctx.db
      .select()
      .from(squareBoards)
      .where(
        and(
          eq(squareBoards.leagueId, league.id),
          isNull(squareBoards.drawnAt),
          isNotNull(squareBoards.externalId),
        ),
      );
    for (const board of undrawn) {
      try {
        if (await followKickoff(ctx, board)) total.steps++;
      } catch (error) {
        logError("squares_board", error, ctx.requestId);
      }
    }
    const boards = await ctx.db
      .select()
      .from(squareBoards)
      .where(and(eq(squareBoards.leagueId, league.id), dueBoard(ctx.now)))
      .orderBy(asc(squareBoards.kickoff), asc(squareBoards.id));
    for (const board of boards) {
      // One board failing (a feed oddity, a lock timeout) mustn't hold up the league's other boards.
      try {
        const done = await advanceBoard(ctx, board);
        total.steps += done.steps;
        total.emails += done.emails;
        total.pushes += done.pushes;
      } catch (error) {
        logError("squares_board", error, ctx.requestId);
      }
    }
    return total;
  },
};
