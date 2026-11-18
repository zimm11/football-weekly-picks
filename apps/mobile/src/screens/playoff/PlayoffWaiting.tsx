// biome-ignore-all lint/correctness/noReactNativeRawText: Action, CardTitle and Label render native Text.
import { type LeagueDetail, type PlayoffStandingsView, weekLabel } from "@picks/shared";
import { Text, useWindowDimensions, View } from "react-native";
import type { IconName } from "../../components/Icon";
import { type } from "../../components/theme";
import { Badge, type BadgeTone, colors, fonts } from "../../components/ui";
import { request } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { playoffRoundSteps, type RoundStep } from "../../lib/resultsPresentation";
import { Action, Card, CardTitle, Label, useLeagueLoad } from "../leagueUi";
import { GuillotineStatusCard } from "./PlayoffStatus";
import { guillotineBetweenRounds, playoffWaiting } from "./playoffLines";

/**
 * The Picks tab's card in a playoff league while no round is open (the weekly pick sheet's empty state hands
 * over to it): which round opens next and what opens it, where the guillotine has left the player, and once all
 * four rounds are final, that the playoffs are over, with the way to Standings. `league.weeks` are the selected
 * season's rounds.
 */
export function PlayoffWaiting({ league }: { league: LeagueDetail }) {
  const { me } = useAuth();
  const waiting = playoffWaiting(league.weeks);
  const year = league.weeks[0]?.year;
  const played = league.weeks.filter((w) => w.status === "final");
  // A player's guillotine status comes with the standings (final rounds only): asked for once a round is final.
  const standings = useLeagueLoad(
    () =>
      year && played.length > 0 && !waiting.over
        ? request<PlayoffStandingsView>(`/leagues/${league.id}/playoff/standings?year=${year}`)
        : Promise.resolve(null),
    `${league.id}:${year ?? ""}:playoff-waiting:${played.length}`,
  );
  const mine = standings.data?.entries.find((entry) => entry.userId === me?.id);
  const status = guillotineBetweenRounds(mine?.status, waiting.next, played.length);
  const latest = [...played].sort((a, b) => b.number - a.number)[0];
  return (
    <Card>
      <CardTitle>{waiting.title}</CardTitle>
      <RoundStrip weeks={league.weeks} />
      <Label>{waiting.detail}</Label>
      {status && <GuillotineStatusCard line={status} />}
      <View style={{ gap: 8 }}>
        {waiting.over && <Action href={`/leagues/${league.id}/standings`}>Final standings</Action>}
        {latest && (
          <Action secondary href={`/weeks/${latest.id}`}>
            {weekLabel(latest.number)} results
          </Action>
        )}
      </View>
    </Card>
  );
}

const STEP: Record<RoundStep["state"], { word: string; tone: BadgeTone; icon: IconName }> = {
  final: { word: "Final", tone: "win", icon: "check" },
  open: { word: "Open", tone: "primary", icon: "arrow-right" },
  next: { word: "Next", tone: "primary", icon: "clock" },
  later: { word: "Later", tone: "outline", icon: "circle" },
};

/**
 * The four rounds in a row (Wild Card · Divisional · Conference · Super Bowl), each with a pill saying where it
 * stands in a word and an icon, never by color alone: the Picks tab between rounds and the empty Results tab.
 */
export function RoundStrip({ weeks }: { weeks: LeagueDetail["weeks"] }) {
  // Under 360px of window the four names don't fit in a row: two rows of two, still in order.
  const narrow = useWindowDimensions().width < 360;
  return (
    <View
      role="list"
      aria-label="Playoff rounds"
      style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 8, rowGap: 12 }}
    >
      {playoffRoundSteps(weeks).map((step) => {
        const { word, tone, icon } = STEP[step.state];
        return (
          <View
            key={step.number}
            role="listitem"
            accessible
            accessibilityLabel={`${step.label}: ${word}`}
            style={[{ minWidth: 0, gap: 6 }, narrow ? { width: "47%" } : { flex: 1 }]}
          >
            <Text
              numberOfLines={1}
              style={[
                type.caption,
                {
                  fontFamily: fonts.medium,
                  color: step.state === "later" ? colors.mutedForeground : colors.foreground,
                },
              ]}
            >
              {step.label}
            </Text>
            <Badge tone={tone} icon={icon}>
              {word}
            </Badge>
          </View>
        );
      })}
    </View>
  );
}
