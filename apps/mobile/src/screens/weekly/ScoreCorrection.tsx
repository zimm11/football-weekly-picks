// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render native Text.
import type { Game, WeekView } from "@picks/shared";
import { useState } from "react";
import { View } from "react-native";
import { request } from "../../lib/api";
import { notifyDone, notifyError } from "../../lib/notify";
import { Action, Card, Heading, Input, Label, s, useEditsGuard } from "../leagueUi";

/**
 * A final week's score corrections in a league that runs itself: the week stays final, the results and standings
 * follow, and the recap shows again. Only scores: spreads and points stood once the week kicked off.
 */
export function ScoreCorrection({
  view,
  onUpdated,
  disabled,
}: {
  view: WeekView;
  onUpdated: (view: WeekView) => void;
  disabled: boolean;
}) {
  return (
    <Card label="Correct a score">
      <Heading>Correct a score</Heading>
      <Label>Change a final score and save it. The week stays final.</Label>
      {view.games.map((game) => (
        <ScoreRow
          key={`${game.id}:${game.homeScore}:${game.awayScore}`}
          game={game}
          onUpdated={onUpdated}
          disabled={disabled}
        />
      ))}
    </Card>
  );
}

function ScoreRow({
  game,
  onUpdated,
  disabled,
}: {
  game: Game;
  onUpdated: (view: WeekView) => void;
  disabled: boolean;
}) {
  const [away, setAway] = useState(String(game.awayScore ?? ""));
  const [home, setHome] = useState(String(game.homeScore ?? ""));
  const [busy, setBusy] = useState(false);
  const name = `${game.awayTeam} at ${game.homeTeam}`;
  const changed = away !== String(game.awayScore ?? "") || home !== String(game.homeScore ?? "");
  useEditsGuard(changed && !busy, () => {
    setAway(String(game.awayScore ?? ""));
    setHome(String(game.homeScore ?? ""));
  });
  const valid = /^\d{1,3}$/.test(away) && /^\d{1,3}$/.test(home);
  async function save() {
    if (busy || !valid) return;
    setBusy(true);
    try {
      onUpdated(
        await request<WeekView>(`/games/${game.id}`, {
          method: "PATCH",
          body: { awayScore: Number(away), homeScore: Number(home) },
        }),
      );
      notifyDone(`Score corrected: ${name}.`);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Couldn't correct the score.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={[s.row, { alignItems: "flex-end" }]}>
      <View style={[s.grow, { minWidth: 96 }]}>
        <Input
          label={`${game.awayTeam} score`}
          accessibilityLabel={`${game.awayTeam} score in ${name}`}
          value={away}
          onChangeText={setAway}
          keyboardType="number-pad"
          editable={!disabled && !busy}
        />
      </View>
      <View style={[s.grow, { minWidth: 96 }]}>
        <Input
          label={`${game.homeTeam} score`}
          accessibilityLabel={`${game.homeTeam} score in ${name}`}
          value={home}
          onChangeText={setHome}
          keyboardType="number-pad"
          editable={!disabled && !busy}
        />
      </View>
      <Action
        compact
        secondary
        label={`Save the score for ${name}`}
        disabled={disabled || busy || !changed || !valid}
        onPress={() => void save()}
      >
        {busy ? "Saving…" : "Save"}
      </Action>
    </View>
  );
}
