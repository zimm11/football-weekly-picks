import { ComingSoon } from "../ComingSoon";
import type { LeagueTypeScreens } from "../leagueTypeScreens";
import { WeeklyPicks, WeeklyResults, WeeklyStandings } from "../weekly";
import { WeekRecap } from "../weekly/WeeklyTabs";

/*
 * Playoff pick'em's screens. It has weekly pick'em's five tabs, so it starts from the weekly containers:
 * replace them here as the playoff ones are built (status line, overall standings, round recap).
 */
export const playoffScreens: LeagueTypeScreens = {
  tabs: { picks: WeeklyPicks, results: WeeklyResults, standings: WeeklyStandings },
  AdminTools: () => (
    <ComingSoon title="Start the playoffs" detail="Starting a playoff season is still being built." />
  ),
  Recap: WeekRecap,
  seasonSelector: true,
};
