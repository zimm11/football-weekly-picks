import type { LeagueTypeScreens } from "../leagueTypeScreens";
import { SurvivorAdminTools } from "./SurvivorAdmin";
import { SurvivorPick } from "./SurvivorPick";
import { SurvivorRecap } from "./SurvivorRecap";
import { SurvivorStandings } from "./SurvivorStandings";

/*
 * Survivor's screens: Pick (the week's games, a button per team, lives left and teams used), Standings (the
 * survivor grid), the League tab's admin tools, and the recap after each week. Messages and League are shared.
 */
export { SurvivorPick, SurvivorStandings };

export const survivorScreens: LeagueTypeScreens = {
  tabs: { pick: SurvivorPick, standings: SurvivorStandings },
  AdminTools: SurvivorAdminTools,
  Recap: SurvivorRecap,
  seasonSelector: true,
};
