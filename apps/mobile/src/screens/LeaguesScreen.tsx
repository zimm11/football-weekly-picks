// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render their children inside native Text.
import {
  type CreateLeagueResult,
  createLeagueSchema,
  type InvitePreview,
  LEAGUE_NAME_MAX,
  LEAGUE_TYPE_INFO,
  type LeagueSummary,
  MAX_LEAGUES_PER_USER,
  MAX_SURVIVOR_LIVES,
  managementChoices,
  type PlayoffFormat,
  REGULAR_SEASON_WEEKS,
  weekLabel,
} from "@picks/shared";
import { router } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { NotificationsPrompt } from "../components/NotificationsPrompt";
import { colors, fonts } from "../components/ui";
import { request } from "../lib/api";
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
  Eyebrow,
  Failure,
  go,
  Heading,
  Input,
  Pill,
  RowLink,
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

export function LeaguesScreen() {
  const leagues = useLeagueLoad(() => request<LeagueSummary[]>("/leagues"), "leagues");
  const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [draft, setDraft] = useState<NewLeagueDraft>(() => initialDraft(deviceZone()));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<NewLeagueDraft>) => setDraft((old) => ({ ...old, ...patch }));
  useEditsGuard(draft.name.trim().length > 0 && !busy, () => setDraft(initialDraft(deviceZone())));
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
      setDraft(initialDraft(deviceZone()));
      // Anyone the copy left out is named where the creator is looking; the banner outlives the navigation.
      const notice = skippedNotice(league, MAX_LEAGUES_PER_USER);
      if (notice) notifyDone(notice);
      router.push(`/leagues/${league.id}/league` as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the league.");
    } finally {
      setBusy(false);
    }
  }
  if (!leagues.data && !leagues.error) return <Skeleton label="Loading your leagues" />;
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={leagues.reload} />}
    >
      <Text accessibilityRole="header" style={s.title}>
        Your leagues
      </Text>
      <Failure message={leagues.error} retry={leagues.reload} />
      {leagues.data?.length === 0 && (
        <Card>
          <Heading>Get ready for your first week</Heading>
          <Text style={s.text}>Open an invite from your league admin, or start a league below.</Text>
          <PressableGuide />
        </Card>
      )}
      <View style={{ gap: 8 }}>
        {leagues.data?.map((league) => (
          <RowLink key={league.id} onPress={() => go(`/leagues/${league.id}`)}>
            <Text
              style={{
                flex: 1,
                fontFamily: fonts.displayBold,
                fontSize: 24,
                lineHeight: 32,
                color: colors.foreground,
                textTransform: "uppercase",
              }}
            >
              {league.name}
            </Text>
            <Pill inline>{LEAGUE_TYPE_INFO[league.type]?.name ?? LEAGUE_TYPE_INFO.weekly.name}</Pill>
            {league.role === "admin" && <Pill inline>Admin</Pill>}
          </RowLink>
        ))}
      </View>
      {/* Below the leagues, which are what the player came for. Gone once answered or put off. */}
      <NotificationsPrompt />
      <Card label="Start a league">
        <Eyebrow>Start a league</Eyebrow>
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
                ...Array.from({ length: REGULAR_SEASON_WEEKS }, (_, i) => ({
                  value: i + 1,
                  label: weekLabel(i + 1),
                })),
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
          disabled={busy}
          onPress={() => {
            void create();
          }}
        >
          {busy ? "Creating…" : "Create league"}
        </Action>
      </Card>
    </ScrollView>
  );
}

export function JoinScreen({ code }: { code: string }) {
  const invite = useLeagueLoad(() => request<InvitePreview>(`/invites/${encodeURIComponent(code)}`), code);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function join() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await request<{ leagueId: string }>(`/invites/${encodeURIComponent(code)}/join`, {
        method: "POST",
      });
      router.replace(`/leagues/${result.leagueId}` as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join the league.");
    } finally {
      setBusy(false);
    }
  }
  if (!invite.data && !invite.error) return <Skeleton label="Loading invite" />;
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Eyebrow>You're invited</Eyebrow>
      <Failure message={invite.error} retry={invite.reload} />
      {invite.data && (
        <Card>
          <Heading>{invite.data.leagueName}</Heading>
          {invite.data.alreadyMember ? (
            <Action link onPress={() => router.replace(`/leagues/${invite.data?.leagueId}` as never)}>
              Go to the league
            </Action>
          ) : invite.data.full ? (
            <Text style={s.text}>
              This league is full. Ask its admin to make room, then open the invite again.
            </Text>
          ) : (
            <Action
              disabled={busy}
              onPress={() => {
                void join();
              }}
            >
              {busy ? "Joining…" : "Join league"}
            </Action>
          )}
          <Failure message={error} />
        </Card>
      )}
    </ScrollView>
  );
}

function PressableGuide() {
  return (
    <Action link ghost compact onPress={() => go("/how-to-play")} icon="chevron-right">
      New here? Read the rules & app guide
    </Action>
  );
}
