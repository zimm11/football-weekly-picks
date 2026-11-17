import { leagueMembers, leagues, squareBoards, squareClaims } from "@picks/db";
import { dueReminderDay } from "@picks/shared";
import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { logError } from "../logging";
import type { ReminderHandler, ReminderMessage } from "../reminderTargets";

/** A reminder is due from 7pm the evening before kickoff, so only boards kicking off this soon can have one. */
const LOOKAHEAD_MS = 2 * 24 * 60 * 60_000;

/*
 * Squares: members with no square on a board still open, the evening before its kickoff (7pm league time, the
 * shared `dueReminderDay` rule, until kickoff). Once the board locks (drawn, or kickoff) nobody is reminded, and
 * claiming a square before it is sent cancels it. The message names no square and no team.
 */

const message = (boardId: string): ReminderMessage => ({
  kind: "text",
  heading: "Claim your squares",
  intro: "The squares board locks at kickoff tomorrow, and you don't have a square yet.",
  pushBody: "Claim your squares before the board locks at kickoff.",
  path: `/boards/${boardId}`,
  actionLabel: "Claim squares",
});

/** The board's game day and expiry, if its reminder is due at `now`. */
const dueDay = (board: { kickoff: Date }, timeZone: string, now: Date) =>
  dueReminderDay([{ kickoff: board.kickoff, final: false }], timeZone, now);

export const squaresReminders: ReminderHandler = {
  async due(db, now) {
    const soon = new Date(now.getTime() + LOOKAHEAD_MS);
    const candidates = await db
      .select({ board: squareBoards, league: leagues })
      .from(squareBoards)
      .innerJoin(leagues, eq(leagues.id, squareBoards.leagueId))
      .where(
        and(
          eq(leagues.type, "squares"),
          isNull(squareBoards.drawnAt),
          gt(squareBoards.kickoff, now),
          lt(squareBoards.kickoff, soon),
        ),
      );
    const due = candidates.flatMap(({ board, league }) => {
      try {
        const day = dueDay(board, league.timeZone, now);
        return day ? [{ board, league, day }] : [];
      } catch (error) {
        logError("reminder_targets", error);
        return [];
      }
    });
    if (!due.length) return [];
    const members = await db
      .select({ leagueId: leagueMembers.leagueId, userId: leagueMembers.userId })
      .from(leagueMembers)
      .where(
        and(
          inArray(leagueMembers.leagueId, [...new Set(due.map((d) => d.league.id))]),
          isNull(leagueMembers.removedAt),
        ),
      );
    const holders = await db
      .selectDistinct({ boardId: squareClaims.boardId, userId: squareClaims.userId })
      .from(squareClaims)
      .where(
        inArray(
          squareClaims.boardId,
          due.map((d) => d.board.id),
        ),
      );
    const holding = new Set(holders.map((h) => `${h.boardId}:${h.userId}`));
    return due.flatMap(({ board, league, day }) => {
      const players = members
        .filter((m) => m.leagueId === league.id && !holding.has(`${board.id}:${m.userId}`))
        .map(({ userId }) => ({ userId, gameIds: [], message: message(board.id) }));
      return players.length
        ? [
            {
              league,
              subjectId: board.id,
              weekId: null,
              boardId: board.id,
              date: day.date,
              expiresAt: day.expiresAt,
              players,
            },
          ]
        : [];
    });
  },
  async stillDue(db, ref, now) {
    const [row] = await db
      .select({ board: squareBoards, league: leagues })
      .from(squareBoards)
      .innerJoin(leagues, eq(leagues.id, squareBoards.leagueId))
      .innerJoin(
        leagueMembers,
        and(
          eq(leagueMembers.leagueId, leagues.id),
          eq(leagueMembers.userId, ref.userId),
          isNull(leagueMembers.removedAt),
        ),
      )
      .where(eq(squareBoards.id, ref.subjectId));
    if (!row || row.board.drawnAt || now >= row.board.kickoff) return null;
    if (dueDay(row.board, row.league.timeZone, now)?.date !== ref.date) return null;
    const [held] = await db
      .select({ row: squareClaims.row })
      .from(squareClaims)
      .where(and(eq(squareClaims.boardId, row.board.id), eq(squareClaims.userId, ref.userId)))
      .limit(1);
    return held ? null : { league: row.league, message: message(row.board.id), gameIds: [] };
  },
};
