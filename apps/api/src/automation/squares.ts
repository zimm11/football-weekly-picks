import { leagues, squareBoards, squareScores } from "@picks/db";
import { SQUARE_PERIODS } from "@picks/shared";
import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { logError } from "../logging";
import { type BoardRow, drawBoard, feedGameOf, lockBoard, recordBoardScore } from "../squares";
import type { AdvanceResult, AutomatedLeague, AutomationContext, LeagueTypeAutomation } from "./types";

/*
 * Squares: lock and draw a board at kickoff if no admin has, then fill in each quarter's score from the feed as
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
    const rows = await ctx.db
      .selectDistinct({ league: leagues })
      .from(leagues)
      .innerJoin(squareBoards, eq(squareBoards.leagueId, leagues.id))
      .where(and(eq(leagues.type, "squares"), dueBoard(ctx.now)))
      .orderBy(asc(leagues.id))
      .limit(limit);
    return rows.map((r) => r.league as AutomatedLeague);
  },
  async advance(ctx, league) {
    const boards = await ctx.db
      .select()
      .from(squareBoards)
      .where(and(eq(squareBoards.leagueId, league.id), dueBoard(ctx.now)))
      .orderBy(asc(squareBoards.kickoff), asc(squareBoards.id));
    const total: AdvanceResult = { steps: 0, emails: 0, pushes: 0 };
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
