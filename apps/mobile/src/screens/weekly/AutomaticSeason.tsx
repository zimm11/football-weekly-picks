// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render native Text.
import { type LeagueDetail, MAX_WEEK, nextRegularWeek, weekLabel } from "@picks/shared";
import { useState } from "react";
import { View } from "react-native";
import { request } from "../../lib/api";
import { now } from "../../lib/clock";
import { notifyDone, notifyError } from "../../lib/notify";
import { confirmDiscard } from "../../lib/unsaved";
import { Action, Card, Heading, Label, Select } from "../leagueUi";
import { automaticNextStep } from "./weeklyNextStep";

/**
 * Automatic weekly pick'em's admin tool on the League tab: Start season with its start week, then what the season
 * does next. It runs through Week 18 by itself; Set up a week below stays as the admin's override.
 */
export function AutomaticSeasonCard({
  league,
  year,
  reload,
}: {
  league: LeagueDetail;
  year: number;
  reload: () => void;
}) {
  const [startWeek, setStartWeek] = useState(() => nextRegularWeek(year, now()));
  const [busy, setBusy] = useState(false);
  if (league.weeks.length > 0)
    return (
      <Card label="Automatic season">
        <Heading>{year} season runs itself</Heading>
        <Label>{automaticNextStep(league.weeks)}</Label>
        <Label>
          You can still edit spreads and points until a week's first kickoff, choose the tiebreaker game, add
          or remove a game, and correct a score at any time.
        </Label>
      </Card>
    );
  async function start() {
    if (busy || !(await confirmDiscard())) return;
    setBusy(true);
    try {
      await request(`/leagues/${league.id}/seasons`, { method: "POST", body: { year, startWeek } });
      notifyDone(`Season started with ${weekLabel(startWeek)}.`);
      reload();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Couldn't start the season.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card label="Start season">
      <Heading>Start the {year} season</Heading>
      <Label>
        Pick the week to start with. Each week imports from ESPN, opens Tuesday at 9 AM Eastern once every
        game has a line, and finalizes after its last game, through Week 18.
      </Label>
      <View style={{ gap: 12 }}>
        <Select
          label="Start week"
          value={startWeek}
          onChange={setStartWeek}
          disabled={busy}
          choices={Array.from({ length: MAX_WEEK }, (_, i) => ({ value: i + 1, label: weekLabel(i + 1) }))}
        />
        <Action disabled={busy} onPress={() => void start()}>
          {busy ? "Starting…" : "Start season"}
        </Action>
      </View>
    </Card>
  );
}
