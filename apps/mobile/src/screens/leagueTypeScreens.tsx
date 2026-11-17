import type { LeagueDetail, LeagueTabId, LeagueType } from "@picks/shared";
import type { ComponentType, ReactNode } from "react";
import { playoffScreens } from "./playoff";
import { squaresScreens } from "./squares";
import { survivorScreens } from "./survivor";
import { weeklyScreens } from "./weekly";

/*
 * What each league type shows inside the shared league shell (LeagueScreen: the header, the tabs, Messages and
 * the League tab). The tab list itself is the registry's (`LEAGUE_TYPE_INFO[type].tabs` in packages/shared);
 * this says which screen each of the type's own tabs renders. Each type keeps its screens in its own folder
 * (screens/weekly/, screens/playoff/, screens/squares/, screens/survivor/) and exports its entry from index.tsx.
 */

/** What a type's tab screen is given. It renders the whole tab, scrolling included, with `header` at its top. */
export type LeagueTabProps = {
  /** The league, its weeks narrowed to the selected season. */
  league: LeagueDetail;
  /** The season selected in the header (week-based types). */
  year: number;
  userId: string;
  /** The league's header (name, season selector, the tab row on wide screens), to put first. */
  header: ReactNode;
  reload: () => void;
};

/** The League tab's admin tools, shown to admins above the shared invite, members and settings cards. */
export type AdminToolsProps = { league: LeagueDetail; year: number; userId: string; reload: () => void };

/** What a type's recap sheet is given: the week to recap, in the league on screen. */
export type RecapProps = { weekId: string; userId: string; leagueId: string; close: () => void };

export type LeagueTypeScreens = {
  /** A screen for each of the type's own tabs: every tab but Messages and League, which all types share. */
  tabs: Partial<Record<LeagueTabId, ComponentType<LeagueTabProps>>>;
  AdminTools: ComponentType<AdminToolsProps>;
  /** The bottom sheet shown once after a week (or round) is finalized (`recapWeekId`). None: no recap. */
  Recap?: ComponentType<RecapProps>;
  /** Whether the header's selector is the season (week-based types). Squares picks a board in its own tab. */
  seasonSelector: boolean;
};

export const LEAGUE_TYPE_SCREENS: Record<LeagueType, LeagueTypeScreens> = {
  weekly: weeklyScreens,
  playoff: playoffScreens,
  squares: squaresScreens,
  survivor: survivorScreens,
};
