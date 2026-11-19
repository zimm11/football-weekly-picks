// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading, Label and Eyebrow render native Text.
import {
  guillotineLabel,
  PLAYOFF_FORMAT_INFO,
  type PlayoffStandingsView,
  SUPER_BOWL_ROUND,
  type WeekView,
  weekAwards,
  weekLabel,
} from "@picks/shared";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { colors, fonts } from "../../components/ui";
import { request } from "../../lib/api";
import { haptics } from "../../lib/haptics";
import { recapTitle } from "../../lib/resultsPresentation";
import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps } from "../leagueTypeScreens";
import {
  Card,
  Eyebrow,
  Failure,
  Heading,
  Label,
  Pill,
  RowLink,
  Sheet,
  Skeleton,
  StatTile,
  s,
  useLeagueLoad,
} from "../leagueUi";
import { ordinal, record, StickyTable } from "../SeasonDashboard";
import { WeekAwardCards } from "../WeekResults";
import { InProgressRows, RecapActions, RecapHeadline, useSelectedSeason } from "../weekly/WeeklyTabs";
import { RoundStrip } from "./PlayoffWaiting";

/*
 * Playoff pick'em's own tabs: Results (the finished rounds) and Standings (the overall table, with the
 * Guillotine status column and the champion after the Super Bowl), and the round recap. Picks is weekly
 * pick'em's pick sheet, which shows the Guillotine status line itself.
 */

const usePlayoffStandings = (leagueId: string, year: number) =>
  useLeagueLoad(
    () => request<PlayoffStandingsView>(`/leagues/${leagueId}/playoff/standings?year=${year}`),
    `${leagueId}:${year}:playoff`,
  );

/** In or out, as text with an icon: never color alone. */
function StatusCell({ entry }: { entry: PlayoffStandingsView["entries"][number] }) {
  if (!entry.status) return null;
  const out = entry.status.state === "out";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon name={out ? "close" : "check"} size={14} color={out ? colors.destructive : colors.win} />
      <Text style={[s.text, { fontSize: 14, color: out ? colors.destructive : colors.win }]}>
        {guillotineLabel(entry.status, weekLabel)}
      </Text>
    </View>
  );
}

export function PlayoffStandings({ league, year, userId, header, reload }: LeagueTabProps) {
  const standings = usePlayoffStandings(league.id, year);
  const view = standings.data;
  return (
    <LeagueTabScroll header={header} reload={() => Promise.all([standings.refresh(), reload()])}>
      <View style={{ gap: 16 }}>
        <Text accessibilityRole="header" style={s.title}>
          Standings
        </Text>
        {!view && !standings.error && <Skeleton label="Loading standings" />}
        <Failure message={standings.error} retry={standings.reload} />
        {view && (
          <>
            {view.champions.length > 0 && (
              <Card label="Champion">
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Icon name="trophy" size={32} color={colors.win} filled />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Eyebrow>{view.champions.length === 1 ? "Champion" : "Champions"}</Eyebrow>
                    <Heading>{view.champions.join(", ")}</Heading>
                    {view.superBowlTotal !== null && (
                      <Label>Super Bowl total: {view.superBowlTotal} points.</Label>
                    )}
                  </View>
                </View>
              </Card>
            )}
            <Label>
              {PLAYOFF_FORMAT_INFO[view.format].name}. {view.rounds.length} of 4 rounds final. Ties go to
              games won, then the closest guess at the Super Bowl's total without going over.
            </Label>
            <StickyTable
              label="Playoff standings"
              columns={[
                { title: "Pts", width: 54 },
                ...(view.format === "guillotine" ? [{ title: "Status", width: 136 }] : []),
                { title: "W–L", width: 80 },
                { title: "POW", width: 54 },
              ]}
              rows={view.entries.map((entry) => ({
                id: entry.userId,
                mine: entry.userId === userId,
                name: (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <Text
                      style={{ fontFamily: fonts.displayBold, fontSize: 18, color: colors.mutedForeground }}
                    >
                      {entry.rank}
                    </Text>
                    <Avatar avatarId={entry.avatarId} name={entry.displayName} size={28} />
                    {/* The champion's pill sits under the name, so the name keeps the column's width. */}
                    <View style={{ flex: 1, gap: 2, alignItems: "flex-start" }}>
                      <Text
                        numberOfLines={entry.champion ? 1 : 2}
                        style={[s.text, { fontSize: 14, lineHeight: 18, fontFamily: fonts.medium }]}
                      >
                        {entry.displayName}
                      </Text>
                      {entry.champion && <Pill tone="win">Champion</Pill>}
                    </View>
                  </View>
                ),
                values: [
                  <Text
                    key="points"
                    style={{ fontFamily: fonts.displayBold, fontSize: 22, color: colors.foreground }}
                  >
                    {entry.points}
                  </Text>,
                  ...(view.format === "guillotine" ? [<StatusCell key="status" entry={entry} />] : []),
                  record(entry),
                  entry.powWins,
                ],
              }))}
            />
            <Text style={[s.muted, { fontSize: 12, lineHeight: 18 }]}>
              Final rounds only. Who is out shows once their round is final.
            </Text>
          </>
        )}
      </View>
    </LeagueTabScroll>
  );
}

export function PlayoffResults({ league, header, reload }: LeagueTabProps) {
  const finished = league.weeks.filter((w) => w.status === "final").sort((a, b) => b.number - a.number);
  return (
    <LeagueTabScroll header={header} reload={reload}>
      <View style={{ gap: 16 }}>
        <Text accessibilityRole="header" style={s.title}>
          Results
        </Text>
        <InProgressRows league={league} />
        {finished.length === 0 ? (
          <Card>
            <RoundStrip weeks={league.weeks} />
            <Label>No round is final yet. Everyone's picks show up here once one is.</Label>
          </Card>
        ) : (
          <View style={{ gap: 8 }}>
            {finished.map((round) => (
              <RowLink
                key={round.id}
                label={`${weekLabel(round.number)} results`}
                href={`/weeks/${round.id}`}
              >
                <Text style={[s.subtitle, { fontSize: 24, flex: 1 }]}>{weekLabel(round.number)}</Text>
                <Text style={s.muted}>
                  {round.gameCount} {round.gameCount === 1 ? "game" : "games"}
                </Text>
              </RowLink>
            ))}
          </View>
        )}
      </View>
    </LeagueTabScroll>
  );
}

/** After each round: your round, your place overall, in or out; after the Super Bowl, the champion. */
export function PlayoffRecap({
  weekId,
  userId,
  close,
}: {
  weekId: string;
  userId: string;
  close: () => void;
}) {
  const week = useLeagueLoad(() => request<WeekView>(`/weeks/${weekId}`), `/weeks/${weekId}`);
  const view = week.data;
  const selectedYear = useSelectedSeason();
  const standings = useLeagueLoad(
    () =>
      view
        ? request<PlayoffStandingsView>(`/leagues/${view.leagueId}/playoff/standings?year=${view.year}`)
        : Promise.resolve(null),
    `${weekId}:${view?.leagueId ?? ""}`,
  );
  // Only from the server's own answer: a remembered copy (the pick sheet's, Manage's) may be from before a reopen.
  const shown = week.fresh && view?.status === "final" && !!view.results && !!standings.data;
  const champion = !!standings.data?.entries.find((e) => e.userId === userId)?.champion;
  useEffect(() => {
    if (shown) void request(`/weeks/${weekId}/recap/seen`, { method: "POST" }).catch(() => {});
  }, [shown, weekId]);
  // Felt once, as the sheet comes up on the player's title.
  useEffect(() => {
    if (shown && champion) haptics.success();
  }, [shown, champion]);
  if (!shown || !view?.results || !standings.data) return null;
  const mine = view.results.entries.find((e) => e.userId === userId);
  const overall = standings.data.entries.find((e) => e.userId === userId);
  const superBowl = view.number === SUPER_BOWL_ROUND;
  const awards = weekAwards({
    games: view.games.map((g) => ({ ...g, kickoff: new Date(g.kickoff) })),
    entries: view.results.entries,
    picks: view.results.picks,
    tiebreakerGameId: view.tiebreakerGameId,
  });
  const champions = standings.data.champions;
  const headline =
    superBowl && champions.length
      ? overall?.champion
        ? champions.length > 1
          ? "You share the title. Champions, all of you."
          : "You're the champion. Take a bow."
        : `${champions.join(", ")} ${champions.length > 1 ? "share the title" : "is the champion"}.`
      : overall
        ? `You're ${ordinal(overall.rank)} of ${standings.data.entries.length} overall.`
        : "The round is final.";
  return (
    <Sheet title={recapTitle(view.number, view.year, selectedYear)} close={close} closeButton={false}>
      <RecapHeadline text={headline} mood={superBowl && overall?.champion ? "won" : null} />
      {mine && overall && (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <StatTile raised label="This round" value={mine.points} detail={record(mine)} />
          <StatTile
            raised
            label="Overall"
            value={ordinal(overall.rank)}
            detail={`${overall.points} points`}
          />
          {overall.status && (
            <StatTile
              raised
              label="Guillotine"
              value={overall.status.state === "out" ? "Out" : "In"}
              detail={
                overall.status.state === "out" ? guillotineLabel(overall.status, weekLabel) : "Still picking"
              }
            />
          )}
        </View>
      )}
      {awards.perfectWeeks.length + awards.bullseyes.length + awards.loneWolves.length > 0 && (
        <WeekAwardCards view={view} raised />
      )}
      <RecapActions weekId={weekId} close={close} />
    </Sheet>
  );
}
