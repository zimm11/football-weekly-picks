// biome-ignore-all lint/correctness/noReactNativeRawText: Action renders its children inside native Text.
import {
  type CreateLeagueResult,
  createLeagueSchema,
  estimatedWeekStart,
  LEAGUE_NAME_MAX,
  LEAGUE_TYPE_INFO,
  type LeagueSummary,
  MAX_LEAGUES_PER_USER,
  MAX_SURVIVOR_LIVES,
  managementChoices,
  type PlayoffFormat,
  REGULAR_SEASON_WEEKS,
  seasonYear,
  weekLabel,
} from "@picks/shared";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { BackLink } from "../components/BackLink";
import { request } from "../lib/api";
import { now } from "../lib/clock";
import {
  chooseType,
  copyableLeagues,
  initialDraft,
  type NewLeagueDraft,
  newLeagueBody,
  skippedNotice,
  typeChoices,
} from "../lib/newLeague";
import { notifyDone } from "../lib/notify";
import { ChoiceList } from "./ChoiceList";
import {
  Action,
  Card,
  Failure,
  go,
  Input,
  Select,
  Skeleton,
  s,
  useEditsGuard,
  useLeagueLoad,
} from "./leagueUi";

const MANAGEMENT_CHOICES = {
  auto: {
    title: "Automatic",
    detail: "Weeks set themselves up from the schedule, open Tuesday morning and close after the last game.",
  },
  manual: {
    title: "Hands-on",
    detail: "Full control of each week: you set the slate and spreads, and open and close it.",
  },
} as const;
const PLAYOFF_FORMATS: { value: PlayoffFormat; label: string }[] = [
  { value: "traditional", label: "Traditional: a POW is optional and wins 3 extra" },
  { value: "guillotine", label: "Guillotine: a POW every round, or you're out" },
];

/** `/leagues/new`: the New league form, reached from the button on Your leagues. */
export function NewLeagueScreen() {
  // Only for "Start with members from": the leagues this player could copy members out of.
  const leagues = useLeagueLoad(() => request<LeagueSummary[]>("/leagues"), "leagues");
  const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [draft, setDraft] = useState<NewLeagueDraft>(() => initialDraft(deviceZone()));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Stays set once the league exists, so the guard doesn't ask about a form that was just sent.
  const [created, setCreated] = useState(false);
  const change = (patch: Partial<NewLeagueDraft>) => setDraft((old) => ({ ...old, ...patch }));
  useEditsGuard(draft.name.trim().length > 0 && !busy && !created, () =>
    setDraft(initialDraft(deviceZone())),
  );
  const types = typeChoices();
  const ways = managementChoices(draft.type);
  const sources = copyableLeagues(leagues.data ?? []);
  async function create() {
    const parsed = createLeagueSchema.safeParse(newLeagueBody({ ...draft, timeZone: deviceZone() }));
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setBusy(true);
    setError(undefined);
    try {
      const league = await request<CreateLeagueResult>("/leagues", { method: "POST", body: parsed.data });
      setCreated(true);
      // Anyone the copy left out is named where the creator is looking; the banner outlives the navigation.
      const notice = skippedNotice(league, MAX_LEAGUES_PER_USER);
      if (notice) notifyDone(notice);
      // Replaces the form, so Back from the new league goes to Your leagues.
      router.replace(`/leagues/${league.id}/league` as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the league.");
    } finally {
      setBusy(false);
    }
  }
  if (!leagues.data && !leagues.error) return <Skeleton label="Loading new league" />;
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={[s.content, { maxWidth: 560 }]}
      keyboardShouldPersistTaps="handled"
    >
      <BackLink />
      <Text accessibilityRole="header" style={s.title}>
        New league
      </Text>
      <Card>
        {types.length > 0 && (
          <ChoiceList
            label="Game"
            value={draft.type}
            disabled={busy}
            onChange={(type) => setDraft((old) => chooseType(old, type))}
            choices={types.map((type) => ({
              value: type,
              title: LEAGUE_TYPE_INFO[type].name,
              detail: LEAGUE_TYPE_INFO[type].description,
              icon: LEAGUE_TYPE_INFO[type].icon,
            }))}
          />
        )}
        {types.length > 0 && (
          <Action link ghost compact icon="info" onPress={() => go(`/how-to-play?section=${draft.type}`)}>
            {`How ${LEAGUE_TYPE_INFO[draft.type].name} works`}
          </Action>
        )}
        <Input
          label="League name"
          value={draft.name}
          onChangeText={(name) => change({ name })}
          maxLength={LEAGUE_NAME_MAX}
          editable={!busy}
        />
        {draft.type === "weekly" && ways.length > 1 && (
          <ChoiceList
            label="How do you want to run it?"
            value={draft.management}
            disabled={busy}
            onChange={(management) => change({ management })}
            choices={ways.map((way) => ({ value: way, ...MANAGEMENT_CHOICES[way] }))}
          />
        )}
        {draft.type === "playoff" && (
          <Select
            label="Format"
            value={draft.format}
            disabled={busy}
            onChange={(format) => change({ format })}
            choices={PLAYOFF_FORMATS}
          />
        )}
        {draft.type === "survivor" && (
          <>
            <Select
              label="Lives"
              value={draft.lives}
              disabled={busy}
              onChange={(lives) => change({ lives })}
              choices={Array.from({ length: MAX_SURVIVOR_LIVES }, (_, i) => ({
                value: i + 1,
                label: i === 0 ? "1: one loss and you're out" : `${i + 1}: out after ${i + 1} losses`,
              }))}
            />
            <Select
              label="Start week"
              value={draft.startWeek ?? 0}
              disabled={busy}
              onChange={(week) => change({ startWeek: week === 0 ? null : week })}
              choices={[
                { value: 0, label: "The next week" },
                // Only weeks with no kickoff yet can start a pool.
                ...Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => i + 1)
                  .filter((n) => estimatedWeekStart(seasonYear(now()), n) > now())
                  .map((n) => ({ value: n, label: weekLabel(n) })),
              ]}
            />
          </>
        )}
        {sources.length > 0 && (
          <Select
            label="Start with members from"
            value={draft.copyMembersFrom ?? ""}
            disabled={busy}
            onChange={(id) => change({ copyMembersFrom: id || null })}
            choices={[
              { value: "", label: "Nobody" },
              ...sources.map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        )}
        <Failure message={error} />
        <Action
          disabled={busy || created}
          onPress={() => {
            void create();
          }}
        >
          {busy || created ? "Creating…" : "Create league"}
        </Action>
      </Card>
    </ScrollView>
  );
}
