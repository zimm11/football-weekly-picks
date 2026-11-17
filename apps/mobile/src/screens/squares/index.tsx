// biome-ignore-all lint/correctness/noReactNativeRawText: Heading, Label and Action render native Text.
import { useAuth } from "../../lib/auth";
import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps, LeagueTypeScreens } from "../leagueTypeScreens";
import { Action, Card, Failure, go, Heading, Label } from "../leagueUi";
import { BoardPanel, useBoard } from "./BoardPanel";
import { BoardSelector } from "./BoardSelector";
import { useBoardChoice } from "./boardChoice";
import { SquaresAdminTools } from "./NewBoard";
import { BoardSkeleton } from "./SquaresGrid";

/** One board in the Board tab, loaded by its id (keyed on it, so switching boards starts fresh). */
function TabBoard({ boardId, userId }: { boardId: string; userId: string }) {
  const board = useBoard(boardId);
  const { me } = useAuth();
  return (
    <BoardPanel boardId={boardId} board={board} userId={userId} displayName={me?.displayName ?? "You"} />
  );
}

/** Board: the board chosen in the header's selector (the next to finish by default), with the results under it. */
export function SquaresBoardTab({ league, userId, header, reload }: LeagueTabProps) {
  const { boards, boardId, error, retry } = useBoardChoice(league.id);
  return (
    <LeagueTabScroll header={header} reload={reload}>
      {boardId ? (
        <TabBoard key={boardId} boardId={boardId} userId={userId} />
      ) : boards ? (
        <Card label="No boards yet">
          <Heading>No boards yet</Heading>
          <Label>
            {league.role === "admin"
              ? "Set up the first board in the League tab: the Super Bowl, any game, or one you type in."
              : "An admin will set up a board. You'll claim squares here."}
          </Label>
          {league.role === "admin" && (
            <Action link compact onPress={() => void go(`/leagues/${league.id}/league`)}>
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
