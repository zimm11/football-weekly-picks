// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render native Text.
import {
  coveringSide,
  currentWeek,
  type LeagueDetail,
  preferredSeasonYear,
  type Standings,
  seasonYear,
  type ThreadPage,
  WEEK_PHASE_LABEL,
  type WeekView,
  weekAwards,
  weekLabel,
} from "@picks/shared";
import { type ReactNode, useEffect, useState } from "react";
import { Platform, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { colors, fonts } from "../components/ui";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now } from "../lib/clock";
import { setUnreadThreads, subscribeMessagesChanged, useUnreadThreads } from "../lib/messageUnread";
import { readSeason, rememberSeason } from "../lib/seasonSelection";
import { confirmDiscard } from "../lib/unsaved";
import { LeagueHeader, LeagueTabBar } from "./LeagueChrome";
import { LeagueTools } from "./LeagueTools";
import {
  Action,
  Card,
  Failure,
  go,
  Heading,
  Input,
  Label,
  Sheet,
  Skeleton,
  StatTile,
  s,
  useLeagueLoad,
} from "./leagueUi";
import { MessagesScreen } from "./MessagesScreen";
import { ordinal, record, SeasonResults, StandingsDashboard } from "./SeasonDashboard";
import { WeekAwardCards } from "./WeekResults";
import { WeekScreen } from "./WeekScreen";

export function LeagueScreen({ leagueId, tab = "picks" }: { leagueId: string; tab?: string }) {
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
        season={tab !== "messages" ? year : undefined}
        seasonChoices={[
          ...years.map((value) => ({
            value,
            label: `${value}${detail.weeks.some((w) => w.year === value) ? "" : " · Not started"}`,
          })),
          ...(detail.role === "admin" ? [{ value: "new" as const, label: "New season…" }] : []),
        ]}
        onSeason={chooseYear}
      />
      {width >= 768 && (
        <LeagueTabBar wide leagueId={leagueId} active={tab} unreadCount={unreadCount} onLeave={leave} />
      )}
      <Failure message={league.error} retry={league.reload} />
      {newSeason && tab !== "messages" && detail.role === "admin" && (
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
  return (
    <View style={s.page}>
      <View style={{ flex: 1 }}>
        {tab === "picks" ? (
          <PicksPanel key={`${leagueId}:${year}`} league={seasonal} header={header} />
        ) : tab === "messages" ? (
          <MessagesScreen leagueId={leagueId} header={header} />
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={false} onRefresh={league.reload} tintColor={colors.foreground} />
            }
            contentContainerStyle={[s.content, { gap: 20 }]}
          >
            {header}
            {(tab === "results" || tab === "standings") && (
              <SeasonPanel
                key={`${year}:${tab}`}
                league={seasonal}
                year={year}
                userId={me?.id ?? ""}
                show={tab}
              />
            )}
            {tab === "league" && (
              <LeagueTools
                key={year}
                league={seasonal}
                year={year}
                userId={me?.id ?? ""}
                reload={league.reload}
              />
            )}
          </ScrollView>
        )}
      </View>
      {width < 768 && (
        <LeagueTabBar leagueId={leagueId} active={tab} unreadCount={unreadCount} onLeave={leave} />
      )}
      {!!recap && tab !== "messages" && tab !== "league" && (
        <Recap weekId={recap} userId={me?.id ?? ""} close={() => setRecap(null)} />
      )}
    </View>
  );
}
function PicksPanel({ league, header }: { league: LeagueDetail; header: ReactNode }) {
  const [focused] = useState(() => currentWeek(league.weeks)?.id);
  const week = league.weeks.find((w) => w.id === focused && w.status === "open") ?? currentWeek(league.weeks);
  const drafts = league.weeks.filter((w) => w.status === "draft");
  const open = league.weeks.filter((w) => w.status === "open");
  const prelude = (
    <View style={{ gap: 16 }}>
      {header}
      {league.weeks
        .filter((w) => w.phase === "awaiting")
        .map((waiting) => (
          <Card key={waiting.id}>
            <Heading>{weekLabel(waiting.number)} · Awaiting finalization</Heading>
            <Label>
              {league.role === "admin"
                ? "All final scores are entered. Finalize the week to reveal picks and update standings."
                : "All scores are in. Your admin will finalize the week to publish results."}
            </Label>
            {league.role === "admin" && (
              <Action link onPress={() => go(`/weeks/${waiting.id}/manage`)}>
                Review & finalize {weekLabel(waiting.number)}
              </Action>
            )}
          </Card>
        ))}
      {drafts.map((draft) => (
        <Card key={draft.id}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Text style={[s.text, { flex: 1 }]}>
              <Text style={{ fontFamily: fonts.semibold }}>{weekLabel(draft.number)}</Text> is a draft.
              Players can't see it yet.
            </Text>
            <Action link compact secondary onPress={() => go(`/weeks/${draft.id}/manage`)}>
              Set up
            </Action>
          </View>
        </Card>
      ))}
      {open.length > 1 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {open.map((w) => (
            <Action
              link
              compact
              key={w.id}
              secondary={w.id !== week?.id}
              onPress={() => go(`/weeks/${w.id}`)}
            >
              {weekLabel(w.number)} · {WEEK_PHASE_LABEL[w.phase]}
            </Action>
          ))}
        </View>
      )}
    </View>
  );
  if (week) return <WeekScreen key={week.id} weekId={week.id} embedded header={prelude} />;
  return (
    <ScrollView contentContainerStyle={[s.content, { gap: 20 }]}>
      {prelude}
      <Card>
        <Heading>No week is open</Heading>
        <Label>
          {league.role === "admin"
            ? "Set up a week and open it, and the pick sheet shows up here for everyone."
            : "The pick sheet shows up here as soon as the admin opens the next week."}
        </Label>
        <View style={{ gap: 8 }}>
          {league.role === "admin" && drafts.length === 0 && (
            <Action link onPress={() => go(`/leagues/${league.id}/league`)}>
              Set up a week
            </Action>
          )}
          {league.weeks
            .filter((w) => w.status === "final")
            .slice(0, 1)
            .map((w) => (
              <Action link key={w.id} secondary onPress={() => go(`/weeks/${w.id}`)}>
                {weekLabel(w.number)} results
              </Action>
            ))}
        </View>
      </Card>
    </ScrollView>
  );
}
function SeasonPanel({
  league,
  year,
  userId,
  show,
}: {
  league: LeagueDetail;
  year: number;
  userId: string;
  show: "results" | "standings";
}) {
  const standings = useLeagueLoad(
    () => request<Standings>(`/leagues/${league.id}/standings?year=${year}`),
    `${league.id}:${year}`,
  );
  if (!standings.data && !standings.error) return <Skeleton label="Loading standings" />;
  return (
    <View style={{ gap: 16 }}>
      <Text accessibilityRole="header" style={s.title}>
        {show === "results" ? "Results" : "Standings"}
      </Text>
      <Failure message={standings.error} retry={standings.reload} />
      {standings.data &&
        (show === "results" ? (
          standings.data.weeks.length ? (
            <SeasonResults standings={standings.data} userId={userId} onWeek={(id) => go(`/weeks/${id}`)} />
          ) : (
            <Card>
              <Label>
                No week has closed yet. Everyone's picks and the winner show up here once one does.
              </Label>
            </Card>
          )
        ) : (
          <StandingsDashboard standings={standings.data} userId={userId} />
        ))}
    </View>
  );
}
function Recap({ weekId, userId, close }: { weekId: string; userId: string; close: () => void }) {
  const week = useLeagueLoad(() => request<WeekView>(`/weeks/${weekId}`), weekId);
  const view = week.data;
  const shown = view?.status === "final" && !!view.results;
  useEffect(() => {
    if (shown) void request(`/weeks/${weekId}/recap/seen`, { method: "POST" }).catch(() => {});
  }, [shown, weekId]);
  if (!shown || !view?.results) return null;
  const me = view.results.entries.find((e) => e.userId === userId);
  const awards = weekAwards({
    games: view.games.map((g) => ({ ...g, kickoff: new Date(g.kickoff) })),
    entries: view.results.entries,
    picks: view.results.picks,
    tiebreakerGameId: view.tiebreakerGameId,
  });
  const myPow = view.games.find((g) => g.id === me?.powGameId);
  const powPush = myPow && coveringSide({ ...myPow, kickoff: new Date(myPow.kickoff) }) === "push";
  const headline = !me
    ? "The results are in."
    : me.isWinner
      ? awards.winners.length > 1
        ? "You shared the win. Half a trophy is still a trophy."
        : "You won the week. Take a bow."
      : awards.lowPointLosers.includes(userId)
        ? "You're this week's Low Point Loser. Somebody had to be."
        : `You finished ${ordinal(me.rank)} of ${view.results.entries.length}.`;
  return (
    <Sheet title={`${weekLabel(view.number)} is final`} close={close} closeButton={false}>
      <Label>{headline}</Label>
      {me && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <StatTile label="Finish" value={ordinal(me.rank)} detail={`of ${view.results.entries.length}`} />
          <StatTile label="Points" value={me.points} detail={record(me)} />
          <StatTile
            label="POW"
            value={me.powGameId ? (me.powWon ? "Won" : powPush ? "Push" : "Lost") : "None"}
            detail={myPow ? `${myPow.awayTeam} at ${myPow.homeTeam}` : undefined}
          />
        </View>
      )}
      <WeekAwardCards view={view} showWinner />
      <Action
        link
        onPress={() => {
          close();
          void go(`/weeks/${weekId}`);
        }}
      >
        See everyone's picks
      </Action>
      <Action secondary onPress={close}>
        Close
      </Action>
    </Sheet>
  );
}
