import type { ThreadPage } from "@picks/shared";
import { type ReactNode, useEffect } from "react";
import { useWindowDimensions, View } from "react-native";
import { request } from "../../lib/api";
import { setUnreadThreads, subscribeMessagesChanged, useUnreadThreads } from "../../lib/messageUnread";
import { LeagueFrame, LeagueTabBar } from "../LeagueChrome";
import { LeagueTabScroll } from "../LeagueTabScroll";
import { s, useLeagueLoad } from "../leagueUi";

/**
 * The Messages tab's unread count on a squares screen outside the league's own, as the league's screens show
 * it: the count the league screen last loaded when there is one, and this screen's own load otherwise (a
 * board opened straight from a link).
 */
function useBoardUnread(leagueId: string) {
  const known = useUnreadThreads(leagueId);
  const unread = useLeagueLoad(
    () => request<ThreadPage>(`/leagues/${leagueId}/messages?limit=1`),
    `${leagueId}:unread`,
    30_000,
  );
  useEffect(() => subscribeMessagesChanged(unread.reload), [unread.reload]);
  useEffect(() => {
    if (unread.data) setUnreadThreads(leagueId, unread.data.unreadCount);
  }, [unread.data, leagueId]);
  return known ?? unread.data?.unreadCount ?? 0;
}

/** The league's header (with **All boards** as its way up) and, from 768px, its row of tabs. */
function BoardHeader({ league }: { league: { id: string; name: string } }) {
  const unreadCount = useBoardUnread(league.id);
  return (
    <LeagueFrame
      leagueId={league.id}
      leagueName={league.name}
      back={{ label: "All boards", href: `/leagues/${league.id}` }}
      type="squares"
      active="board"
      unreadCount={unreadCount}
    />
  );
}

/** The phone's tab bar along the bottom. */
function BoardTabBar({ leagueId }: { leagueId: string }) {
  const unreadCount = useBoardUnread(leagueId);
  return <LeagueTabBar leagueId={leagueId} type="squares" active="board" unreadCount={unreadCount} />;
}

/**
 * The frame of a squares screen under the Boards tab (a board, its manage screen, New board): the league's
 * header and tabs around the content, as the week screens have. The header's way up is **All boards**, the
 * league's list, rather than Your leagues.
 */
export function BoardFrame({
  league,
  reload,
  children,
}: {
  /** The league the screen is in, once known. */
  league: { id: string; name: string } | undefined;
  /** Pull to refresh: the screen's `refresh`, so the spinner stays until it has reloaded. */
  reload: () => unknown;
  children: ReactNode;
}) {
  const wide = useWindowDimensions().width >= 768;
  return (
    <View style={s.page}>
      <LeagueTabScroll reload={reload} header={league && <BoardHeader league={league} />}>
        {children}
      </LeagueTabScroll>
      {league && !wide && <BoardTabBar leagueId={league.id} />}
    </View>
  );
}
