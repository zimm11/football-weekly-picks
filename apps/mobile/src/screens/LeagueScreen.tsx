// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render native Text.
import {
  type LeagueDetail,
  leagueTabFromPath,
  preferredSeasonYear,
  seasonYear,
  type ThreadPage,
} from "@picks/shared";
import { useEffect, useState } from "react";
import { Platform, useWindowDimensions, View } from "react-native";
import { NotFound } from "../components/NotFound";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now } from "../lib/clock";
import { setUnreadThreads, subscribeMessagesChanged, useUnreadThreads } from "../lib/messageUnread";
import { readSeason, rememberSeason } from "../lib/seasonSelection";
import { confirmDiscard } from "../lib/unsaved";
import { LeagueHeader, LeagueTabBar } from "./LeagueChrome";
import { LeagueTabScroll } from "./LeagueTabScroll";
import { LeagueTools } from "./LeagueTools";
import { LEAGUE_TYPE_SCREENS } from "./leagueTypeScreens";
import { Action, Card, Failure, Heading, Input, Label, Skeleton, s, useLeagueLoad } from "./leagueUi";
import { MessagesScreen } from "./MessagesScreen";

/**
 * One league: the shared shell (header, tabs, Messages, the League tab) around the type's own tabs. `path` is the
 * URL segment under `/leagues/:id` ("" for the type's first tab, "results", "standings", "messages", "league");
 * one the type doesn't have is not found.
 */
export function LeagueScreen({ leagueId, path = "" }: { leagueId: string; path?: string }) {
  const league = useLeagueLoad(() => request<LeagueDetail>(`/leagues/${leagueId}`), leagueId, 30_000);
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
  // Set as another tab opens: the router swaps screens a moment later, and until then this one shows as loading
  // rather than staying usable (a browser user expects the swap at once). Cleared if the swap never comes.
  const [leaving, setLeaving] = useState(false);
  // A phone keeps this screen under the next one for the back gesture, so only the web build blanks it.
  const leave = Platform.OS === "web" ? () => setLeaving(true) : undefined;
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(false), 2000);
    return () => clearTimeout(timer);
  }, [leaving]);
  useEffect(() => subscribeMessagesChanged(unread.reload), [unread.reload]);
  useEffect(() => {
    if (unread.data) setUnreadThreads(leagueId, unread.data.unreadCount);
  }, [unread.data, leagueId]);
  useEffect(() => {
    if (league.data) setRecap((prev) => (prev === undefined ? (league.data?.recapWeekId ?? null) : prev));
  }, [league.data]);
  useEffect(() => {
    if (league.data && selectedYear === undefined) {
      setYear(preferredSeasonYear(league.data.weeks, now()));
    }
  }, [league.data, selectedYear]);
  if (leaving || (!league.data && !league.error)) return <Skeleton />;
  if (!league.data)
    return (
      <View style={s.content}>
        <Failure message={league.error} retry={league.reload} />
      </View>
    );
  const detail = league.data;
  const tab = leagueTabFromPath(detail.type, path);
  if (!tab) return <NotFound />;
  const screens = LEAGUE_TYPE_SCREENS[detail.type];
  const year = selectedYear ?? preferredSeasonYear(detail.weeks, now());
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
            label:
              detail.type === "playoff"
                ? `${value} playoffs`
                : `${value}${detail.weeks.some((w) => w.year === value) ? "" : " · Not started"}`,
          })),
          ...(detail.role === "admin" ? [{ value: "new" as const, label: "New season…" }] : []),
        ]}
        onSeason={chooseYear}
      />
      {width >= 768 && (
        <LeagueTabBar
          wide
          leagueId={leagueId}
          type={detail.type}
          active={tab}
          unreadCount={unreadCount}
          onLeave={leave}
        />
      )}
      <Failure message={league.error} retry={league.reload} />
      {newSeason && tab !== "messages" && screens.seasonSelector && detail.role === "admin" && (
        <Card label="Start a new season">
          <Heading>Start a new season</Heading>
          <Label>
            Use the year the NFL season starts. Your league and members carry over. The season is created when
            you prepare its first week.
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
          <LeagueTabScroll header={header} reload={league.reload}>
            <LeagueTools
              key={year}
              league={seasonal}
              userId={userId}
              reload={league.reload}
              adminTools={<AdminTools league={seasonal} year={year} userId={userId} reload={league.reload} />}
            />
          </LeagueTabScroll>
        ) : TypeTab ? (
          <TypeTab
            key={`${leagueId}:${year}:${tab}`}
            league={seasonal}
            year={year}
            userId={userId}
            header={header}
            reload={league.reload}
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
          onLeave={leave}
        />
      )}
      {!!recap && Recap && tab !== "messages" && tab !== "league" && (
        <Recap weekId={recap} userId={userId} close={() => setRecap(null)} />
      )}
    </View>
  );
}
