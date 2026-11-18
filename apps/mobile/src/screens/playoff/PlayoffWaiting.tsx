// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render native Text.
import { type LeagueDetail, type PlayoffStandingsView, weekLabel } from "@picks/shared";
import { View } from "react-native";
import { request } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Action, Card, Heading, Label, useLeagueLoad } from "../leagueUi";
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
      <Heading>{waiting.title}</Heading>
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
