import { ComingSoon } from "../ComingSoon";
import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps, LeagueTypeScreens } from "../leagueTypeScreens";

/** Board: the board selector and the 10 by 10 grid, with the quarter results under it. Placeholder. */
export function SquaresBoardTab({ header, reload }: LeagueTabProps) {
  return (
    <LeagueTabScroll header={header} reload={reload}>
      <ComingSoon title="The board" />
    </LeagueTabScroll>
  );
}

export const squaresScreens: LeagueTypeScreens = {
  tabs: { board: SquaresBoardTab },
  AdminTools: () => <ComingSoon title="New board" detail="Setting up a board is still being built." />,
  // A squares league picks a board, not a season, in its Board tab.
  seasonSelector: false,
};
