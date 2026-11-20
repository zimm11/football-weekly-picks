// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render native Text.
import {
  LEAGUE_TABS,
  type LeagueDetail,
  type LeagueTabId,
  leagueTabFromPath,
  preferredSeasonYear,
  seasonYear,
  type ThreadPage,
} from "@picks/shared";
import { useIsFocused } from "expo-router";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FadeIn } from "../components/FadeIn";
import { NotFound } from "../components/NotFound";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { layout, radius } from "../components/theme";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now } from "../lib/clock";
import { tabOfRoute, tabRouteName } from "../lib/leagueTabRoutes";
import { readLoadCache } from "../lib/loadCache";
import { setUnreadThreads, subscribeMessagesChanged, useUnreadThreads } from "../lib/messageUnread";
import { usePageTitle } from "../lib/pageTitle";
import { seasonChoiceLabel } from "../lib/seasonLabel";
import { readSeason, rememberSeason } from "../lib/seasonSelection";
import { confirmDiscard } from "../lib/unsaved";
import { LeagueFrame, LeagueTabBar } from "./LeagueChrome";
import { LeagueTabScroll } from "./LeagueTabScroll";
import { LeagueTools } from "./LeagueTools";
import {
  LeagueShellContext,
  type LeagueShellValue,
  type LeagueTabsNav,
  LeagueTabsNavContext,
  useLeagueShell,
  useLeagueTabsNav,
} from "./leagueContext";
import { LEAGUE_TYPE_SCREENS } from "./leagueTypeScreens";
import { Action, Card, colors, Failure, Heading, Input, Label, s, useLeagueLoad } from "./leagueUi";
import { MessagesScreen } from "./MessagesScreen";

/*
 * One league is one screen of the app's stack holding a tab navigator (`app/leagues/[id]/_layout.tsx`):
 *
 * - `LeagueShell` (the layout) loads the league and its unread count once, for every tab, and holds the season
 *   chosen in the header and the one-time recap. While the league first loads it draws the league's frame; a
 *   league that answers 404 is "League not found".
 * - `LeagueTabsFrame` (the navigator's `layout`) knows which tab is showing: it gives the tab bar the active tab
 *   and, on iPhone, the switch between tabs, reloads the league each time another tab is shown, and shows the
 *   recap sheet on the type's own tabs.
 * - `LeagueTab` (each tab's route) draws the league's header (name, season selector, the tab row on wide
 *   screens) at the top of its own scroll, then the tab: the type's screen (`LEAGUE_TYPE_SCREENS`), Messages, or
 *   the League tab. A path the type has no tab for is the not-found screen.
 * - `LeagueBottomBar` (the navigator's `tabBar`) is the bar along the bottom on phones.
 *
 * On iPhone every visited tab stays mounted, scroll position and all, and the tab bar swaps between them without
 * a slide; the back gesture and "All leagues" leave the league. In a browser each tab is its own URL and history
 * entry, and only the tab showing is in the page (`FocusedOnly`).
 */

const web = Platform.OS === "web";

/** The league's layout: loads it once, then provides it to the tab navigator in `children`. */
export function LeagueShell({ leagueId, children }: { leagueId: string; children: ReactNode }) {
  // Keyed by the API path, so the screens above the league (a week, a board) share the copy.
  const league = useLeagueLoad(
    () => request<LeagueDetail>(`/leagues/${leagueId}`),
    `/leagues/${leagueId}`,
    30_000,
  );
  const unread = useLeagueLoad(
    () => request<ThreadPage>(`/leagues/${leagueId}/messages?limit=1`),
    `${leagueId}:unread`,
    30_000,
  );
  const registryUnread = useUnreadThreads(leagueId);
  // Whether this mount draws the placeholder first: then the league fades in over it. One drawn at once from
  // the load cache doesn't fade.
  const cold = useRef(league.data === undefined).current;
  const focused = useIsFocused();
  const { me } = useAuth();
  const { width } = useWindowDimensions();
  const [selectedYear, setYear] = useState<number | undefined>(() => readSeason(leagueId));
  const [newSeason, setNewSeason] = useState(false);
  const [newYear, setNewYear] = useState(String(seasonYear(now()) + 1));
  const [recap, setRecap] = useState<string | null>();
  // The league is gone, or the player isn't in it (removed, a bad link): nothing a retry would change.
  const gone = league.status === 404;
  // Each tab names the page once the league is here.
  usePageTitle(!league.data && gone ? "League not found" : undefined);
  useEffect(() => subscribeMessagesChanged(unread.reload), [unread.reload]);
  useEffect(() => {
    if (unread.data) setUnreadThreads(leagueId, unread.data.unreadCount);
  }, [unread.data, leagueId]);
  const fresh = league.fresh;
  useEffect(() => {
    // Only from the server's own answer: the remembered league may still name a recap the player has seen.
    if (league.data && fresh)
      setRecap((prev) => (prev === undefined ? (league.data?.recapWeekId ?? null) : prev));
  }, [league.data, fresh]);
  useEffect(() => {
    if (league.data && selectedYear === undefined) {
      setYear(preferredSeasonYear(league.data.weeks, now(), league.data.startedSeasons));
    }
  }, [league.data, selectedYear]);
  const { reload: reloadLeague, refresh } = league;
  const reloadUnread = unread.reload;
  const reloadAll = useCallback(() => {
    reloadUnread();
    const key = `/leagues/${leagueId}`;
    const before = readLoadCache<LeagueDetail>(key);
    void refresh().then(() => {
      // As each tab did when it opened: a week finalized (or corrected) since is recapped once more. Only from
      // this reload's own answer, which is in the cache by the time it settles.
      const answer = readLoadCache<LeagueDetail>(key);
      const weekId = answer !== before ? answer?.recapWeekId : null;
      if (weekId) setRecap((prev) => prev || weekId);
    });
  }, [leagueId, refresh, reloadUnread]);
  const chooseYear = useCallback(
    async (value: number | "new") => {
      if (value === "new") {
        setNewSeason(true);
        return;
      }
      if (!(await confirmDiscard())) return;
      setYear(value);
      rememberSeason(leagueId, value);
      setNewSeason(false);
    },
    [leagueId],
  );
  const closeRecap = useCallback(() => setRecap(null), []);
  const detail = league.data;
  const year = detail
    ? (selectedYear ?? preferredSeasonYear(detail.weeks, now(), detail.startedSeasons))
    : seasonYear(now());
  const unreadCount = registryUnread ?? unread.data?.unreadCount ?? 0;
  const value = useMemo<LeagueShellValue | null>(
    () =>
      detail
        ? {
            leagueId,
            detail,
            userId: me?.id ?? "",
            year,
            years: [...new Set([year, seasonYear(now()), ...detail.weeks.map((w) => w.year)])].sort(
              (a, b) => b - a,
            ),
            chooseYear,
            newSeason,
            setNewSeason,
            newYear,
            setNewYear,
            unreadCount,
            error: league.error,
            reload: reloadLeague,
            refresh,
            fresh,
            reloadAll,
            recap,
            closeRecap,
          }
        : null,
    [
      leagueId,
      detail,
      me?.id,
      year,
      chooseYear,
      newSeason,
      newYear,
      unreadCount,
      league.error,
      reloadLeague,
      refresh,
      fresh,
      reloadAll,
      recap,
      closeRecap,
    ],
  );
  // In a browser a league stays mounted under the screens above it (`app/_layout.tsx`): while covered it
  // shows nothing but its tab navigator, whose tabs empty themselves.
  if (!value && web && !focused) return <View />;
  if (!value && !league.error) return <LeagueSkeleton wide={width >= 768} />;
  if (!value && gone)
    return (
      <NotFound
        title="League not found"
        detail="It may have been deleted, or you’re no longer a member. An invite link from a commissioner gets you back in."
      />
    );
  if (!value)
    return (
      <View style={s.content}>
        <Failure message={league.error} retry={league.reload} />
      </View>
    );
  const shell = <LeagueShellContext value={value}>{children}</LeagueShellContext>;
  return cold ? <FadeIn style={s.page}>{shell}</FadeIn> : shell;
}

/** What the tab navigator's `layout` is given: its state and its own navigation (`app/leagues/[id]/_layout.tsx`). */
type TabsLayoutProps = {
  state: {
    index: number;
    routes: readonly {
      key: string;
      name: string;
      params?: object;
      state?: { key?: string; index?: number };
    }[];
  };
  navigation: {
    navigate: (name: string, params?: object) => void;
    dispatch: (action: { type: string; target?: string }) => void;
  };
  children: ReactNode;
};

/** The tab navigator's `layout`: the showing tab for the tab bar, the iPhone tab switch, the reloads and the recap. */
export function LeagueTabsFrame({ state, navigation, children }: TabsLayoutProps) {
  const shell = useLeagueShell();
  const { detail, leagueId, reloadAll } = shell;
  const showing = useIsFocused();
  const focused = state.routes[state.index];
  const active = focused ? tabOfRoute(detail.type, focused.name) : null;
  // Read when a tab is pressed, so `open` itself can stay the same between renders.
  const current = useRef({ state, navigation });
  current.current = { state, navigation };
  const nav = useMemo<LeagueTabsNav>(
    () => ({
      leagueId,
      active,
      // iPhone only: in a browser each tab is a link (`LeagueTabBar`). Switching keeps every visited tab as it
      // was (a thread open in Messages included); pressing the tab showing goes back to its first screen.
      open: (tab: LeagueTabId) => {
        const { state, navigation } = current.current;
        const name = tabRouteName(detail.type, tab);
        const showing = state.routes[state.index];
        void (async () => {
          if (showing?.name === name) {
            const inner = showing.state;
            if (inner?.key && (inner.index ?? 0) > 0 && (await confirmDiscard()))
              navigation.dispatch({ type: "POP_TO_TOP", target: inner.key });
            return;
          }
          if (!(await confirmDiscard())) return;
          // The route's own params (the same object), so the tab keeps its state: a new object would reset it.
          const visited = state.routes.find((route) => route.name === name);
          navigation.navigate(name, visited ? visited.params : { id: leagueId });
        })();
      },
    }),
    [leagueId, active, detail.type],
  );
  // Each tab used to load the league as it opened: keep the league (weeks, members, reports) as fresh when
  // another tab is shown. The first tab shown was just loaded.
  const focusedKey = focused?.key;
  const shown = useRef(focusedKey);
  useEffect(() => {
    if (shown.current === focusedKey) return;
    shown.current = focusedKey;
    reloadAll();
  }, [focusedKey, reloadAll]);
  const Recap = LEAGUE_TYPE_SCREENS[detail.type].Recap;
  return (
    <LeagueTabsNavContext value={nav}>
      <View style={s.page}>
        {children}
        {showing && !!shell.recap && Recap && active && active !== "messages" && active !== "league" && (
          <Recap weekId={shell.recap} userId={shell.userId} leagueId={leagueId} close={shell.closeRecap} />
        )}
      </View>
    </LeagueTabsNavContext>
  );
}

/** The tab navigator's `tabBar`: the league's tabs along the bottom on phones (wide screens put them in the header). */
export function LeagueBottomBar() {
  const shell = useLeagueShell();
  const nav = useLeagueTabsNav();
  const showing = useIsFocused();
  const { width } = useWindowDimensions();
  // A path the type has no tab for is the not-found screen, without the league around it. In a browser a
  // league covered by another screen stays mounted, without its bar (that screen draws its own).
  if (width >= 768 || !nav?.active || (web && !showing)) return null;
  return (
    <LeagueTabBar
      leagueId={shell.leagueId}
      type={shell.detail.type}
      active={nav.active}
      unreadCount={shell.unreadCount}
      reportsWaiting={shell.detail.openReports ?? 0}
    />
  );
}

/**
 * The league's header at the top of a tab: the name row with the way back and the season selector,
 * the tab row on wide screens, a failed reload, and the Start a new season card while it is open.
 */
export function LeagueTabHeader({ tab }: { tab: LeagueTabId }) {
  const shell = useLeagueShell();
  const { detail, leagueId, year, years } = shell;
  const screens = LEAGUE_TYPE_SCREENS[detail.type];
  const { newYear } = shell;
  return (
    <View style={{ gap: layout.pageGap }}>
      <LeagueFrame
        leagueId={leagueId}
        leagueName={detail.name}
        season={tab !== "messages" && screens.seasonSelector ? year : undefined}
        seasonChoices={[
          ...years.map((value) => ({ value, label: seasonChoiceLabel(detail, value) })),
          ...(detail.role === "admin" ? [{ value: "new" as const, label: "New season…" }] : []),
        ]}
        onSeason={shell.chooseYear}
        seasonWidth={detail.type === "playoff" ? 156 : undefined}
        type={detail.type}
        active={tab}
        unreadCount={shell.unreadCount}
        reportsWaiting={detail.openReports ?? 0}
      />
      <Failure message={shell.error} retry={shell.reload} />
      {shell.newSeason && tab !== "messages" && screens.seasonSelector && detail.role === "admin" && (
        <Card label="Start a new season">
          <Heading>Start a new season</Heading>
          <Label>
            Use the year the pro football season starts. Your league and members carry over.{" "}
            {detail.type === "weekly" && detail.management === "manual"
              ? "The season is created when you prepare its first week."
              : "Then start the season on the League tab."}
          </Label>
          <Input
            label="New season year"
            value={newYear}
            onChangeText={shell.setNewYear}
            keyboardType="number-pad"
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Action
              compact
              disabled={!/^\d{4}$/.test(newYear) || Number(newYear) < 2020 || Number(newYear) > 2100}
              onPress={() => void shell.chooseYear(Number(newYear))}
            >
              Use season
            </Action>
            <Action compact secondary onPress={() => shell.setNewSeason(false)}>
              Cancel
            </Action>
          </View>
        </Card>
      )}
    </View>
  );
}

/**
 * One tab of the league, by its URL segment under `/leagues/:id` ("" for the type's first tab, "results",
 * "standings", "messages", "league"); one the type doesn't have is not found.
 */
export function LeagueTab({ path }: { path: string }) {
  const shell = useLeagueShell();
  const { detail, leagueId, year, userId } = shell;
  const tab = leagueTabFromPath(detail.type, path);
  usePageTitle(tab ? `${LEAGUE_TABS[tab].title} · ${detail.name}` : "Page not found");
  if (!tab) return <NotFound />;
  const screens = LEAGUE_TYPE_SCREENS[detail.type];
  const seasonal = { ...detail, weeks: detail.weeks.filter((week) => week.year === year) };
  const header = <LeagueTabHeader tab={tab} />;
  const TypeTab = screens.tabs[tab];
  const AdminTools = screens.AdminTools;
  return (
    <View style={s.page}>
      {tab === "messages" ? (
        <MessagesScreen leagueId={leagueId} header={header} />
      ) : tab === "league" ? (
        <LeagueTabScroll header={header} reload={shell.refresh}>
          <LeagueTools
            key={year}
            league={seasonal}
            userId={userId}
            reload={shell.reload}
            adminTools={
              AdminTools && <AdminTools league={seasonal} year={year} userId={userId} reload={shell.reload} />
            }
          />
        </LeagueTabScroll>
      ) : TypeTab ? (
        <TypeTab
          key={`${leagueId}:${year}:${tab}`}
          league={seasonal}
          year={year}
          userId={userId}
          header={header}
          // Resolves when the reload has settled, so a tab's pull to refresh knows when to stop spinning.
          reload={shell.refresh}
          fresh={shell.fresh}
        />
      ) : (
        <NotFound />
      )}
    </View>
  );
}

/**
 * The league's frame while it loads for the first time (afterwards the load cache draws it at once): the header's
 * rows, the tab row or bottom bar, and blank cards, each where the real one will be, so nothing jumps when it
 * arrives. The blocks pulse gently (`SkeletonBlock`).
 */
function LeagueSkeleton({ wide }: { wide: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <View accessible accessibilityLabel="Loading league" accessibilityState={{ busy: true }} style={s.page}>
      <View style={[s.content, { flex: 1, gap: layout.pageGap }]}>
        {/* As `LeagueFrame` draws it: the back arrow beside the league's name, then the tab row. */}
        <View style={{ gap: layout.pageGap }}>
          <View style={{ height: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
            <SkeletonBlock width={20} height={20} />
            <SkeletonBlock width={220} height={24} style={{ maxWidth: "70%" }} />
          </View>
          {wide && (
            <View
              style={{ height: 44, flexDirection: "row", alignItems: "center", gap: 28, paddingLeft: 16 }}
            >
              {[72, 84, 96, 96, 80].map((width, n) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder shapes.
                <SkeletonBlock key={n} width={width} height={16} />
              ))}
            </View>
          )}
        </View>
        {[64, 120, 120].map((height, n) => (
          <SkeletonBlock
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder shapes.
            key={n}
            height={height}
            radius={radius.xl}
            style={{ backgroundColor: colors.card }}
          />
        ))}
      </View>
      {!wide && (
        <View
          style={{
            height: 64 + insets.bottom,
            backgroundColor: colors.chrome,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        />
      )}
    </View>
  );
}
