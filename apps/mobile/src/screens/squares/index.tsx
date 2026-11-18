// biome-ignore-all lint/correctness/noReactNativeRawText: Heading, Label and Action render native Text.
import { type RefObject, useEffect, useRef } from "react";
import { useAuth } from "../../lib/auth";
import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps, LeagueTypeScreens } from "../leagueTypeScreens";
import { Action, Card, Failure, Heading, Label } from "../leagueUi";
import { BoardPanel, useBoard } from "./BoardPanel";
import { BoardSelector } from "./BoardSelector";
import { forgetBoard, useBoardChoice } from "./boardChoice";
import { SquaresAdminTools } from "./NewBoard";
import { BoardSkeleton } from "./SquaresGrid";

/** One board in the Board tab, loaded by its id (keyed on it, so switching boards starts fresh). */
function TabBoard({
  leagueId,
  boardId,
  userId,
  refresher,
}: {
  leagueId: string;
  boardId: string;
  userId: string;
  /** Where the tab's pull to refresh finds this board's reload. */
  refresher: RefObject<(() => Promise<void>) | null>;
}) {
  const board = useBoard(boardId);
  const { me } = useAuth();
  const refresh = board.refresh;
  useEffect(() => {
    refresher.current = refresh;
    return () => {
      refresher.current = null;
    };
  }, [refresher, refresh]);
  // Deleted since the list of boards was loaded: drop it, and the tab shows the next board (or none).
  const gone = !board.data && board.status === 404;
  useEffect(() => {
    if (gone) forgetBoard(leagueId, boardId);
  }, [gone, leagueId, boardId]);
  return (
    <BoardPanel
      boardId={boardId}
      board={board}
      userId={userId}
      avatarId={me?.avatarId}
      displayName={me?.displayName ?? "You"}
    />
  );
}

/** Board: the board chosen in the header's selector (the next to finish by default), with the results under it. */
export function SquaresBoardTab({ league, userId, header, reload }: LeagueTabProps) {
  const { boards, boardId, error, retry } = useBoardChoice(league.id);
  const refreshBoard = useRef<(() => Promise<void>) | null>(null);
  return (
    <LeagueTabScroll
      header={header}
      // Pulling down reloads what the tab shows: the board first, then the list of boards and the league.
      reload={async () => {
        retry?.();
        await Promise.all([refreshBoard.current?.(), reload()]);
      }}
    >
      {boardId ? (
        <TabBoard
          key={boardId}
          leagueId={league.id}
          boardId={boardId}
          userId={userId}
          refresher={refreshBoard}
        />
      ) : boards ? (
        <Card label="No boards yet">
          <Heading>No boards yet</Heading>
          <Label>
            {league.role === "admin"
              ? "Set up the first board in the League tab: the Super Bowl, any game, or one you type in."
              : "A commissioner will set up a board. You'll claim squares here."}
          </Label>
          {league.role === "admin" && (
            <Action compact href={`/leagues/${league.id}/league`}>
              New board
            </Action>
          )}
        </Card>
      ) : error ? (
        <Failure message={error} retry={retry} />
      ) : (
        <BoardSkeleton />
      )}
    </LeagueTabScroll>
  );
}

export const squaresScreens: LeagueTypeScreens = {
  tabs: { board: SquaresBoardTab },
  AdminTools: SquaresAdminTools,
  // A squares league picks a board, not a season: the header shows the board selector instead.
  seasonSelector: false,
  HeaderSelector: BoardSelector,
};
