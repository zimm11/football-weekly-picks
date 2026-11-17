// biome-ignore-all lint/correctness/noReactNativeRawText: Label, Pill, Action and Heading render native Text.
import { type LeagueDetail, MAX_WEEK, nextWeekNumber, WEEK_PHASE_LABEL, weekLabel } from "@picks/shared";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { PreferenceToggle } from "../../components/PreferenceToggle";
import { request } from "../../lib/api";
import { notifyDone, notifyError } from "../../lib/notify";
import { confirmDiscard } from "../../lib/unsaved";
import { Action, Card, colors, go, Heading, Label, Pill, Select, s } from "../leagueUi";

/** Hands-on weekly pick'em's admin tool on the League tab: create a week (importing its slate) or manage one. */
export function WeekSetupCard({
  league,
  year,
  reload,
}: {
  league: LeagueDetail;
  year: number;
  reload: () => void;
}) {
  const [number, setNumber] = useState(
    nextWeekNumber(league.weeks, MAX_WEEK) ??
      league.weeks.find((w) => w.status !== "final")?.number ??
      MAX_WEEK,
  );
  const [importGames, setImportGames] = useState(true),
    [busy, setBusy] = useState<string>();
  const base = `/leagues/${league.id}`,
    existing = league.weeks.find((w) => w.number === number),
    next = nextWeekNumber(league.weeks, MAX_WEEK),
    finalCount = league.weeks.filter((w) => w.status === "final").length;
  async function run(action: string, task: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(action);
    try {
      const result = await task();
      if (result === false) return;
      notifyDone(success);
      reload();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Card label="Weeks">
      <View style={{ gap: 4 }}>
        <Heading>{year} season weeks</Heading>
        <Label>
          {league.weeks.length} of {MAX_WEEK} weeks prepared · {finalCount} final. Regular season only.
        </Label>
      </View>
      {next === null && (
        <View style={{ backgroundColor: colors.primaryTint, borderRadius: 12, padding: 12 }}>
          <Label>
            {finalCount === MAX_WEEK
              ? "Season complete. All 18 weeks are final. Choose New season in the season selector when you're ready."
              : "All 18 weeks are prepared. Manage an existing week below; finalize the remaining weeks to finish the season."}
          </Label>
        </View>
      )}
      <Select
        label="Week"
        value={number}
        onChange={setNumber}
        disabled={!!busy}
        choices={Array.from({ length: MAX_WEEK }, (_, i) => {
          const n = i + 1,
            w = league.weeks.find((item) => item.number === n);
          return {
            value: n,
            label: `${weekLabel(n)} · ${w ? WEEK_PHASE_LABEL[w.phase] : "Not created"}`,
          };
        })}
      />
      {existing ? (
        <Action link disabled={!!busy} onPress={() => go(`/weeks/${existing.id}/manage`)}>
          Manage week
        </Action>
      ) : (
        <>
          <Action
            disabled={!!busy}
            onPress={() =>
              void run(
                "create",
                async () => {
                  if (!(await confirmDiscard())) return false;
                  const created = await request<{ id: string; importError: string | null }>(`${base}/weeks`, {
                    method: "POST",
                    body: { year, number, importGames },
                  });
                  if (created.importError) notifyError(created.importError);
                  void go(`/weeks/${created.id}/manage`);
                },
                "Week created.",
              )
            }
          >
            {busy === "create" ? "Creating…" : "Create week"}
          </Action>
          <PreferenceToggle
            small
            label="Import games and spreads from ESPN"
            checked={importGames}
            onChange={setImportGames}
            disabled={!!busy}
          />
        </>
      )}
      <View>
        {[...league.weeks]
          .sort((a, b) => b.number - a.number)
          .map((week) => (
            <Pressable
              key={week.id}
              accessibilityRole="link"
              accessibilityLabel={`Manage ${weekLabel(week.number)}`}
              disabled={!!busy}
              onPress={() => void go(`/weeks/${week.id}/manage`)}
              style={({ pressed }) => ({
                minHeight: 56,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderTopWidth: 1,
                borderTopColor: colors.border,
                backgroundColor: pressed ? colors.raised : "transparent",
              })}
            >
              <Text style={[s.subtitle, { fontSize: 20 }]}>{weekLabel(week.number)}</Text>
              <Pill inline tone={week.status === "open" ? "primary" : "muted"}>
                {WEEK_PHASE_LABEL[week.phase]}
              </Pill>
            </Pressable>
          ))}
      </View>
    </Card>
  );
}
