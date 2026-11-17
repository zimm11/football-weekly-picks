// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render native Text.
import {
  coveringSide,
  currentWeek,
  type LeagueDetail,
  type Standings,
  WEEK_PHASE_LABEL,
  type WeekView,
  weekAwards,
  weekLabel,
} from "@picks/shared";
import { type ReactNode, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { fonts } from "../../components/ui";
import { request } from "../../lib/api";
import {
  Action,
  Card,
  Failure,
  go,
  Heading,
  Label,
  Sheet,
  Skeleton,
  StatTile,
  s,
  useLeagueLoad,
} from "../leagueUi";
import { ordinal, record, SeasonResults, StandingsDashboard } from "../SeasonDashboard";
import { WeekAwardCards } from "../WeekResults";
import { WeekScreen } from "../WeekScreen";

/*
 * Weekly pick'em's tabs: Picks (the current week's pick sheet), Results and Standings, and the results recap.
 * Playoff pick'em reuses them until it has its own (screens/playoff/).
 */

export function PicksPanel({ league, header }: { league: LeagueDetail; header: ReactNode }) {
  const [focused] = useState(() => currentWeek(league.weeks)?.id);
  const week = league.weeks.find((w) => w.id === focused && w.status === "open") ?? currentWeek(league.weeks);
  const drafts = league.weeks.filter((w) => w.status === "draft");
  const open = league.weeks.filter((w) => w.status === "open");
  // A league that runs itself opens and finalizes on its own; a playoff league's unit is the round.
  const automatic = league.management === "auto";
  const unit = league.type === "playoff" ? "round" : "week";
  const prelude = (
    <View style={{ gap: 16 }}>
      {header}
      {league.weeks
        .filter((w) => w.phase === "awaiting")
        .map((waiting) => (
          <Card key={waiting.id}>
            <Heading>{weekLabel(waiting.number)} · Awaiting finalization</Heading>
            <Label>
              {automatic
                ? `All scores are in. The ${unit} finalizes by itself in a few minutes.`
                : league.role === "admin"
                  ? "All final scores are entered. Finalize the week to reveal picks and update standings."
                  : "All scores are in. Your admin will finalize the week to publish results."}
            </Label>
            {league.role === "admin" && !automatic && (
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
              {automatic &&
                (league.type === "playoff"
                  ? " It opens by itself once every game has a line."
                  : " It opens by itself on Tuesday at 9 AM Eastern once every game has a line.")}
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
        <Heading>No {unit} is open</Heading>
        <Label>
          {league.type === "playoff"
            ? "Each round opens by itself once ESPN lists its games and lines, starting with the Wild Card round after the regular season ends."
            : automatic
              ? league.weeks.length
                ? "The next week opens by itself on Tuesday at 9 AM Eastern once every game has a line."
                : league.role === "admin"
                  ? "Start the season on the League tab, and each week opens by itself."
                  : "The pick sheet shows up here once the admin starts the season."
              : league.role === "admin"
                ? "Set up a week and open it, and the pick sheet shows up here for everyone."
                : "The pick sheet shows up here as soon as the admin opens the next week."}
        </Label>
        <View style={{ gap: 8 }}>
          {league.role === "admin" && drafts.length === 0 && league.type === "weekly" && (
            <Action link onPress={() => go(`/leagues/${league.id}/league`)}>
              {automatic && league.weeks.length === 0 ? "Start season" : "Set up a week"}
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
export function SeasonPanel({
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
export function WeekRecap({ weekId, userId, close }: { weekId: string; userId: string; close: () => void }) {
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
