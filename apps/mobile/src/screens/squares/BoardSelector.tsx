import type { BoardSummary, LeagueDetail } from "@picks/shared";
import { useEffect } from "react";
import { request } from "../../lib/api";
import { boardTitle } from "../../lib/squaresBoard";
import { confirmDiscard } from "../../lib/unsaved";
import { Select, useLeagueLoad } from "../leagueUi";
import { chooseBoard, setBoards, setBoardsError, useBoardChoice } from "./boardChoice";

/**
 * The header's selector in a squares league: which board the Board tab shows, in place of the season selector.
 * It loads the league's boards (shared with the tab through `boardChoice`) and hides while there is one or none.
 */
export function BoardSelector({ league }: { league: LeagueDetail }) {
  const loaded = useLeagueLoad(
    () => request<BoardSummary[]>(`/leagues/${league.id}/boards`),
    `${league.id}:board-choices`,
    30_000,
  );
  useEffect(() => {
    if (loaded.data) setBoards(league.id, loaded.data);
  }, [loaded.data, league.id]);
  useEffect(() => {
    setBoardsError(league.id, loaded.data ? undefined : loaded.error, loaded.reload);
  }, [loaded.data, loaded.error, loaded.reload, league.id]);
  const { boards, boardId } = useBoardChoice(league.id);
  if (!boards || boards.length < 2 || !boardId) return null;
  // The same pill as the other types' season selector, wide enough for "BUF at SEA · Feb 14".
  return (
    <Select
      compact
      compactWidth={208}
      label="Board"
      value={boardId}
      choices={boards.map((b) => ({ value: b.id, label: boardTitle(b, league.timeZone) }))}
      onChange={async (value) => {
        if (await confirmDiscard()) chooseBoard(league.id, value);
      }}
    />
  );
}
