// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading, Label and Pill render native Text.
import {
  PLAYOFF_FORMAT_INFO,
  PLAYOFF_FORMATS,
  PLAYOFF_ROUNDS,
  type PlayoffFormat,
  type PlayoffStandingsView,
  WEEK_PHASE_LABEL,
  weekLabel,
} from "@picks/shared";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { AppLink } from "../../components/AppLink";
import { PreferenceToggle } from "../../components/PreferenceToggle";
import { hoverFill, ringInside } from "../../components/pressState";
import { request } from "../../lib/api";
import { notifyDone, notifyError } from "../../lib/notify";
import { confirmDiscard } from "../../lib/unsaved";
import { ChoiceList } from "../ChoiceList";
import type { AdminToolsProps } from "../leagueTypeScreens";
import {
  Action,
  Card,
  colors,
  go,
  Heading,
  Label,
  Pill,
  Select,
  s,
  useEditsGuard,
  useLeagueLoad,
} from "../leagueUi";
import { playoffFormatLocked } from "./playoffFormat";

/**
 * Playoff pick'em's admin tools on the League tab: the season's format (Start season), the rounds as they stand,
 * and the fallback for a feed outage: creating a round by hand, then Import, Open and Finalize on its manage
 * screen. Rounds normally create, open and finalize themselves.
 */
export function PlayoffAdminTools({ league, year, reload }: AdminToolsProps) {
  const standings = useLeagueLoad(
    () => request<PlayoffStandingsView>(`/leagues/${league.id}/playoff/standings?year=${year}`),
    `${league.id}:${year}:admin`,
  );
  const saved = standings.data?.year === year ? standings.data.format : null;
  const [format, setFormat] = useState<PlayoffFormat>("traditional");
  useEffect(() => {
    if (saved) setFormat(saved);
  }, [saved]);
  const [busy, setBusy] = useState<string>();
  // The admin's choice holds while the rounds stay the same; when a refresh brings other rounds (a remembered
  // league shown before its refresh), the suggestion follows them.
  const suggestedRound =
    PLAYOFF_ROUNDS.find((n) => !league.weeks.some((w) => w.number === n)) ?? PLAYOFF_ROUNDS[0];
  const roundsKey = league.weeks.map((w) => w.number).join(",");
  const [roundChoice, setRoundChoice] = useState<{ round: number; rounds: string }>();
  const round = roundChoice?.rounds === roundsKey ? roundChoice.round : suggestedRound;
  const setRound = (value: number) => setRoundChoice({ round: value, rounds: roundsKey });
  const [importGames, setImportGames] = useState(true);
  // The format is fixed once the Wild Card round is under way.
  const locked = playoffFormatLocked(league.weeks);
  const changed = saved !== format;
  // Only a change from the saved format is unsaved work: until the standings answer there is nothing to compare
  // with, and a tab change then must not ask "Leave without saving?".
  useEditsGuard(changed && !!saved && !locked && !busy, () => saved && setFormat(saved));
  async function run(action: string, task: () => Promise<void>) {
    if (busy || !(await confirmDiscard())) return;
    setBusy(action);
    try {
      await task();
      reload();
      standings.reload();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(undefined);
    }
  }
  const existing = league.weeks.find((w) => w.number === round);
  return (
    <>
      <Card label="Playoff season">
        <Heading>{year} playoffs</Heading>
        <Label>
          Rounds set themselves up from the pro football schedule: the Wild Card round once the regular season
          ends, each round open as soon as every game has a line, final once every game has a result.
        </Label>
        <ChoiceList
          label="Format"
          value={format}
          disabled={locked || !!busy}
          onChange={setFormat}
          choices={PLAYOFF_FORMATS.map((value) => ({
            value,
            title: PLAYOFF_FORMAT_INFO[value].name,
            detail: PLAYOFF_FORMAT_INFO[value].description,
          }))}
        />
        {locked ? (
          <Label>The format is fixed now that the Wild Card round has kicked off.</Label>
        ) : (
          <Action
            disabled={(!!busy && busy !== "start") || (!changed && !!saved)}
            busy={busy === "start"}
            onPress={() =>
              void run("start", async () => {
                await request(`/leagues/${league.id}/seasons`, {
                  method: "POST",
                  body: { year, settings: { format } },
                });
                notifyDone(`${PLAYOFF_FORMAT_INFO[format].name} it is.`);
              })
            }
          >
            {busy === "start" ? "Saving…" : saved ? "Save format" : "Start season"}
          </Action>
        )}
      </Card>
      <Card label="Rounds">
        <Heading>Rounds</Heading>
        {league.weeks.length === 0 && (
          <Label>No round yet. The Wild Card round shows up once its games are scheduled.</Label>
        )}
        <View>
          {[...league.weeks]
            .sort((a, b) => a.number - b.number)
            .map((week) => (
              <AppLink
                key={week.id}
                href={`/weeks/${week.id}/manage`}
                accessibilityLabel={`Manage ${weekLabel(week.number)}`}
                style={(state) => [
                  {
                    minHeight: 56,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    backgroundColor: hoverFill(state),
                  },
                  ringInside,
                ]}
              >
                <Text style={[s.subtitle, { fontSize: 20 }]}>{weekLabel(week.number)}</Text>
                <Pill inline tone={week.status === "open" ? "primary" : "muted"}>
                  {WEEK_PHASE_LABEL[week.phase]}
                </Pill>
              </AppLink>
            ))}
        </View>
        <Label>
          If the schedule doesn't come through, create a round by hand and run it from its manage screen.
        </Label>
        <Select
          label="Round"
          value={round}
          onChange={setRound}
          disabled={!!busy}
          choices={PLAYOFF_ROUNDS.map((n) => ({
            value: n,
            label: `${weekLabel(n)}${league.weeks.some((w) => w.number === n) ? " · Created" : ""}`,
          }))}
        />
        {existing ? (
          <Action secondary disabled={!!busy} href={`/weeks/${existing.id}/manage`}>
            Manage round
          </Action>
        ) : (
          <>
            {/* The choice sits above the button it changes. */}
            <PreferenceToggle
              small
              label="Auto-fill games and spreads"
              checked={importGames}
              onChange={setImportGames}
              disabled={!!busy}
            />
            <Action
              secondary
              disabled={!!busy && busy !== "round"}
              busy={busy === "round"}
              onPress={() =>
                void run("round", async () => {
                  const created = await request<{ id: string; importError: string | null }>(
                    `/leagues/${league.id}/playoff/rounds`,
                    { method: "POST", body: { year, number: round, importGames } },
                  );
                  if (created.importError) notifyError(created.importError);
                  else notifyDone(`${weekLabel(round)} created.`);
                  void go(`/weeks/${created.id}/manage`);
                })
              }
            >
              {busy === "round" ? "Creating…" : "Create round"}
            </Action>
          </>
        )}
      </Card>
    </>
  );
}
