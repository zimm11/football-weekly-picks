import { ComingSoon } from "../ComingSoon";
import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps, LeagueTypeScreens } from "../leagueTypeScreens";

/** Pick: the week's games as cards with a button per team, lives left and teams used. Placeholder. */
export function SurvivorPick({ header, reload }: LeagueTabProps) {
  return (
    <LeagueTabScroll header={header} reload={reload}>
      <ComingSoon title="Your pick" />
    </LeagueTabScroll>
  );
}

/** Standings: the survivor grid, players down the side and weeks across. Placeholder. */
export function SurvivorStandings({ header, reload }: LeagueTabProps) {
  return (
    <LeagueTabScroll header={header} reload={reload}>
      <ComingSoon title="Who's left" />
    </LeagueTabScroll>
  );
}

export const survivorScreens: LeagueTypeScreens = {
  tabs: { pick: SurvivorPick, standings: SurvivorStandings },
  AdminTools: () => (
    <ComingSoon title="Start the pool" detail="Starting a survivor season is still being built." />
  ),
  seasonSelector: true,
};
