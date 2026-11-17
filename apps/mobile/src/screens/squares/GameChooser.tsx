import { type BoardFeedGame, LAST_WEEK, NFL_TEAMS, TEAM_ABBRS, weekLabel } from "@picks/shared";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { messageOf, request } from "../../lib/api";
import type { GameDraft } from "../../lib/squaresBoard";
import { kickoffDay, kickoffTime } from "../../lib/weekPresentation";
import { ChoiceList } from "../ChoiceList";
import { timeZones } from "../LeagueTools";
import { Failure, Input, Label, Select } from "../leagueUi";

/**
 * Choosing a board's game: the Super Bowl (the default, once the feed lists it), any game from the feed for a
 * season and week, or teams and a kickoff typed by hand in the league's time zone.
 */
export function GameChooser({
  leagueId,
  timeZone,
  draft,
  onChange,
  disabled,
}: {
  leagueId: string;
  timeZone: string;
  draft: GameDraft;
  onChange: (draft: GameDraft) => void;
  disabled?: boolean;
}) {
  const [games, setGames] = useState<BoardFeedGame[]>();
  const [error, setError] = useState<string>();
  const set = (patch: Partial<GameDraft>) => onChange({ ...draft, ...patch });
  const { source, year, week } = draft;
  useEffect(() => {
    if (source !== "feed") return;
    let active = true;
    setGames(undefined);
    setError(undefined);
    request<BoardFeedGame[]>(`/leagues/${leagueId}/boards/games?year=${year}&week=${week}`).then(
      (list) => active && setGames(list),
      (err: unknown) => active && setError(messageOf(err)),
    );
    return () => {
      active = false;
    };
  }, [leagueId, source, year, week]);
  const teams = [
    { value: "", label: "Choose a team" },
    ...TEAM_ABBRS.map((team) => ({ value: team, label: `${team} · ${NFL_TEAMS[team]}` })),
  ];
  return (
    <View style={{ gap: 12 }}>
      <ChoiceList
        label="Game"
        value={draft.source}
        onChange={(value) => set({ source: value })}
        disabled={disabled}
        choices={[
          {
            value: "superbowl",
            title: "The Super Bowl",
            detail: "Once the schedule lists both teams",
            icon: "trophy",
          },
          { value: "feed", title: "A game from the schedule", icon: "football" },
          { value: "manual", title: "Type it in", icon: "pencil" },
        ]}
      />
      {draft.source === "feed" && (
        <>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Select
                label="Season"
                value={draft.year}
                onChange={(value) => set({ year: value, externalId: "" })}
                disabled={disabled}
                choices={[draft.year - 1, draft.year, draft.year + 1].map((value) => ({
                  value,
                  label: String(value),
                }))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Select
                label="Week"
                value={draft.week}
                onChange={(value) => set({ week: value, externalId: "" })}
                disabled={disabled}
                choices={Array.from({ length: LAST_WEEK }, (_, i) => ({
                  value: i + 1,
                  label: weekLabel(i + 1),
                }))}
              />
            </View>
          </View>
          <Failure message={error} />
          {games && games.length === 0 && <Label>No games are listed for that week yet.</Label>}
          {games && games.length > 0 && (
            <Select
              label="Matchup"
              value={draft.externalId}
              onChange={(value) => set({ externalId: value })}
              disabled={disabled}
              choices={[
                { value: "", label: "Choose a game" },
                ...games.map((g) => ({
                  value: g.externalId,
                  label: `${g.awayTeam} at ${g.homeTeam} · ${kickoffDay(g.kickoff, timeZone)} ${kickoffTime(g.kickoff, timeZone)}`,
                })),
              ]}
            />
          )}
        </>
      )}
      {draft.source === "manual" && (
        <>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Select
                label="Away team (down the side)"
                value={draft.awayTeam}
                onChange={(value) => set({ awayTeam: value })}
                choices={teams}
                disabled={disabled}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Select
                label="Home team (across the top)"
                value={draft.homeTeam}
                onChange={(value) => set({ homeTeam: value })}
                choices={teams}
                disabled={disabled}
              />
            </View>
          </View>
          <Input
            label={`Kickoff (${timeZones.find((zone) => zone.value === timeZone)?.label ?? timeZone} time)`}
            placeholder="YYYY-MM-DD HH:mm"
            value={draft.kickoff}
            onChangeText={(value) => set({ kickoff: value })}
            autoCapitalize="none"
            editable={!disabled}
          />
        </>
      )}
    </View>
  );
}
