import type { LeagueTypeScreens } from "../leagueTypeScreens";
import { WeeklyPicks } from "../weekly";
import { PlayoffAdminTools } from "./PlayoffAdmin";
import { PlayoffRecap, PlayoffResults, PlayoffStandings } from "./PlayoffTabs";

/*
 * Playoff pick'em's screens: weekly pick'em's five tabs over the four rounds. Picks is the weekly pick sheet,
 * which carries the Guillotine status line and goes read-only for a player who is out; Results lists the finished
 * rounds; Standings is the overall table; the recap is per round, with the champion after the Super Bowl.
 */
export const playoffScreens: LeagueTypeScreens = {
  tabs: { picks: WeeklyPicks, results: PlayoffResults, standings: PlayoffStandings },
  AdminTools: PlayoffAdminTools,
  Recap: PlayoffRecap,
  seasonSelector: true,
};
