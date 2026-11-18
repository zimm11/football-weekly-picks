import type { LeagueDetail, LeagueTabId } from "@picks/shared";
import { createContext, useContext } from "react";

/**
 * What the league's layout (`app/leagues/[id]/_layout.tsx`, `LeagueShell`) loaded once for all of its tabs and
 * the Messages tab's threads: the league, the season chosen in the header, the unread count and the reloads.
 */
export type LeagueShellValue = {
  leagueId: string;
  /** The whole league, every season's weeks. */
  detail: LeagueDetail;
  userId: string;
  /** The season chosen in the header (week-based types), and the years the selector offers. */
  year: number;
  years: number[];
  /** Chooses a season ("new" opens the Start a new season card), asking first about unsaved work. */
  chooseYear: (value: number | "new") => Promise<void>;
  newSeason: boolean;
  setNewSeason: (open: boolean) => void;
  newYear: string;
  setNewYear: (year: string) => void;
  unreadCount: number;
  /** The league's last load failed (the league itself is still on screen). */
  error?: string;
  reload: () => void;
  /** Resolves when the reload has settled: for pull to refresh. */
  refresh: () => Promise<void>;
  /** Whether `detail` is this visit's own answer from the server, not the remembered copy. */
  fresh: boolean;
  /** Reloads the league and its unread count: each time another tab is shown. */
  reloadAll: () => void;
  /** The finalized week to recap once (`recapWeekId`), null once closed, undefined until known. */
  recap: string | null | undefined;
  closeRecap: () => void;
};
export const LeagueShellContext = createContext<LeagueShellValue | null>(null);

/** The league a tab or thread is in. Only inside a league's layout. */
export function useLeagueShell(): LeagueShellValue {
  const value = useContext(LeagueShellContext);
  if (!value) throw new Error("useLeagueShell is only for screens inside a league's layout.");
  return value;
}

/**
 * The league's tab navigator, for the tab bar drawn inside it: which tab is showing, and (on iPhone) how to
 * switch to another without leaving the league screen. Absent on the screens above the league (a week, a board).
 */
export type LeagueTabsNav = {
  leagueId: string;
  /** The tab showing; null on a path the league's type doesn't have (the not-found screen). */
  active: LeagueTabId | null;
  open: (tab: LeagueTabId) => void;
};
export const LeagueTabsNavContext = createContext<LeagueTabsNav | null>(null);
export const useLeagueTabsNav = () => useContext(LeagueTabsNavContext);
