// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render native Text.
import {
  LEAGUE_TABS,
  LEAGUE_TYPE_INFO,
  type LeagueDetail,
  leagueTabFromPath,
  preferredSeasonYear,
  seasonYear,
  type ThreadPage,
} from "@picks/shared";
import { useEffect, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NotFound } from "../components/NotFound";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now } from "../lib/clock";
import { setUnreadThreads, subscribeMessagesChanged, useUnreadThreads } from "../lib/messageUnread";
import { useTabSwapDone } from "../lib/navigation";
import { usePageTitle } from "../lib/pageTitle";
import { readSeason, rememberSeason } from "../lib/seasonSelection";
import { confirmDiscard } from "../lib/unsaved";
import { LeagueHeader, LeagueTabBar } from "./LeagueChrome";
import { LeagueTabScroll } from "./LeagueTabScroll";
import { LeagueTools } from "./LeagueTools";
import { LEAGUE_TYPE_SCREENS } from "./leagueTypeScreens";
import { Action, Card, colors, Failure, Heading, Input, Label, s, useLeagueLoad } from "./leagueUi";
import { MessagesScreen } from "./MessagesScreen";

/**
 * One league: the shared shell (header, tabs, Messages, the League tab) around the type's own tabs. `path` is the
 * URL segment under `/leagues/:id` ("" for the type's first tab, "results", "standings", "messages", "league");
 * one the type doesn't have is not found.
 */
export function LeagueScreen({ leagueId, path = "" }: { leagueId: string; path?: string }) {
  // Keyed by the API path, so the thread screen (which loads the same league) and every tab share one copy:
  // a tab or thread opens with the league already on screen and only refreshes it.
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
  const { me } = useAuth();
  const { width } = useWindowDimensions();
  const [selectedYear, setYear] = useState<number | undefined>(() => readSeason(leagueId));
  const [newSeason, setNewSeason] = useState(false);
  const [newYear, setNewYear] = useState(String(seasonYear(now()) + 1));
  const [recap, setRecap] = useState<string | null>();
  const tab = league.data ? leagueTabFromPath(league.data.type, path) : undefined;
  // The league is gone, or the player isn't in it (removed, a bad link): nothing a retry would change.
  const gone = league.status === 404;
  usePageTitle(
    league.data
      ? tab
        ? `${LEAGUE_TABS[tab].title} · ${league.data.name}`
        : "Page not found"
      : gone
        ? "League not found"
        : undefined,
  );
  useTabSwapDone();
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
  if (!league.data && !league.error) return <LeagueSkeleton wide={width >= 768} />;
  if (!league.data && gone)
    return (
      <NotFound
        title="League not found"
        detail="It may have been deleted, or you’re no longer a member. An invite link from a commissioner gets you back in."
      />
    );
  if (!league.data)
    return (
      <View style={s.content}>
        <Failure message={league.error} retry={league.reload} />
      </View>
    );
  const detail = league.data;
  if (!tab) return <NotFound />;
  const screens = LEAGUE_TYPE_SCREENS[detail.type];
  const year = selectedYear ?? preferredSeasonYear(detail.weeks, now(), detail.startedSeasons);
  const years = [...new Set([year, seasonYear(now()), ...detail.weeks.map((w) => w.year)])].sort(
    (a, b) => b - a,
  );
  async function chooseYear(value: number | "new") {
    if (value === "new") {
      setNewSeason(true);
      return;
    }
    if (!(await confirmDiscard())) return;
    setYear(value);
    rememberSeason(leagueId, value);
    setNewSeason(false);
  }
  const seasonal = { ...detail, weeks: detail.weeks.filter((week) => week.year === year) };
  const unreadCount = registryUnread ?? unread.data?.unreadCount ?? 0;
  const header = (
    <View style={{ gap: 20 }}>
      <LeagueHeader
        leagueId={leagueId}
        leagueName={detail.name}
        season={tab !== "messages" && screens.seasonSelector ? year : undefined}
        seasonChoices={[
          ...years.map((value) => ({
            value,
            // A playoff league's season is its postseason: "2026 playoffs".
            // "Not started" only where a season starts with its first week (Hands-on weekly's way): a type
            // that gets its season when the league is created has started even while members see no week yet.
            label:
              detail.type === "playoff"
                ? `${value} playoffs`
                : `${value}${
                    LEAGUE_TYPE_INFO[detail.type].seasonOnCreate || detail.weeks.some((w) => w.year === value)
                      ? ""
                      : " · Not started"
                  }`,
          })),
          ...(detail.role === "admin" ? [{ value: "new" as const, label: "New season…" }] : []),
        ]}
        onSeason={chooseYear}
        seasonWidth={detail.type === "playoff" ? 156 : undefined}
      />
      {width >= 768 && (
        <LeagueTabBar
          wide
          leagueId={leagueId}
          type={detail.type}
          active={tab}
          unreadCount={unreadCount}
          reportsWaiting={detail.openReports ?? 0}
        />
      )}
      <Failure message={league.error} retry={league.reload} />
      {newSeason && tab !== "messages" && screens.seasonSelector && detail.role === "admin" && (
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
            onChangeText={setNewYear}
            keyboardType="number-pad"
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Action
              compact
              disabled={!/^\d{4}$/.test(newYear) || Number(newYear) < 2020 || Number(newYear) > 2100}
              onPress={() => void chooseYear(Number(newYear))}
            >
              Use season
            </Action>
            <Action compact secondary onPress={() => setNewSeason(false)}>
              Cancel
            </Action>
          </View>
        </Card>
      )}
    </View>
  );
  const userId = me?.id ?? "";
  const TypeTab = screens.tabs[tab];
  const AdminTools = screens.AdminTools;
  const Recap = screens.Recap;
  return (
    <View style={s.page}>
      <View style={{ flex: 1 }}>
        {tab === "messages" ? (
          <MessagesScreen leagueId={leagueId} header={header} />
        ) : tab === "league" ? (
          <LeagueTabScroll header={header} reload={league.refresh}>
            <LeagueTools
              key={year}
              league={seasonal}
              userId={userId}
              reload={league.reload}
              adminTools={
                AdminTools && (
                  <AdminTools league={seasonal} year={year} userId={userId} reload={league.reload} />
                )
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
            reload={league.refresh}
            fresh={league.fresh}
          />
        ) : (
          <NotFound />
        )}
      </View>
      {width < 768 && (
        <LeagueTabBar
          leagueId={leagueId}
          type={detail.type}
          active={tab}
          unreadCount={unreadCount}
          reportsWaiting={detail.openReports ?? 0}
        />
      )}
      {!!recap && Recap && tab !== "messages" && tab !== "league" && (
        <Recap weekId={recap} userId={userId} leagueId={leagueId} close={() => setRecap(null)} />
      )}
    </View>
  );
}

/**
 * The league's frame while it loads for the first time (afterwards the load cache draws it at once): the header's
 * rows, the tab row or bottom bar, and blank cards, each where the real one will be, so nothing jumps when it arrives.
 */
function LeagueSkeleton({ wide }: { wide: boolean }) {
  const insets = useSafeAreaInsets();
  const block = { borderRadius: 6, backgroundColor: colors.raised } as const;
  return (
    <View accessible accessibilityLabel="Loading league" accessibilityState={{ busy: true }} style={s.page}>
      <View style={[s.content, { flex: 1, gap: 20 }]}>
        <View>
          <View style={{ height: 44, justifyContent: "center" }}>
            <View style={[block, { width: 84, height: 14 }]} />
          </View>
          <View style={[block, { width: 220, maxWidth: "70%", height: 30, marginVertical: 1 }]} />
        </View>
        {wide && (
          <View style={{ height: 44, flexDirection: "row", alignItems: "center", gap: 28, paddingLeft: 16 }}>
            {[72, 84, 96, 96, 80].map((width, n) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder shapes.
              <View key={n} style={[block, { width, height: 16 }]} />
            ))}
          </View>
        )}
        {[64, 120, 120].map((height, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder shapes.
          <View key={n} style={[s.card, { height }]} />
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
