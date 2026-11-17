// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render their children inside native Text.
import { createLeagueSchema, type InvitePreview, LEAGUE_NAME_MAX, type LeagueSummary } from "@picks/shared";
import { router } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { NotificationsPrompt } from "../components/NotificationsPrompt";
import { colors, fonts } from "../components/ui";
import { request } from "../lib/api";
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
  Skeleton,
  s,
  useEditsGuard,
  useLeagueLoad,
} from "./leagueUi";

export function LeaguesScreen() {
  const leagues = useLeagueLoad(() => request<LeagueSummary[]>("/leagues"), "leagues");
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEditsGuard(name.trim().length > 0 && !busy, () => setName(""));
  async function create() {
    const parsed = createLeagueSchema.safeParse({
      name,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setBusy(true);
    setError(undefined);
    try {
      const league = await request<{ id: string }>("/leagues", { method: "POST", body: parsed.data });
      setName("");
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
            {league.role === "admin" && <Pill inline>Admin</Pill>}
          </RowLink>
        ))}
      </View>
      {/* Below the leagues, which are what the player came for. Gone once answered or put off. */}
      <NotificationsPrompt />
      <Card>
        <Eyebrow>Start a league</Eyebrow>
        <Input
          label="League name"
          value={name}
          onChangeText={setName}
          maxLength={LEAGUE_NAME_MAX}
          editable={!busy}
        />
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
