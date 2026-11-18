// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render their children inside native Text.
import { type InvitePreview, LEAGUE_TYPE_INFO, type LeagueSummary } from "@picks/shared";
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
  Pill,
  RowLink,
  Skeleton,
  s,
  useLeagueLoad,
} from "./leagueUi";

export function LeaguesScreen() {
  const leagues = useLeagueLoad(() => request<LeagueSummary[]>("/leagues"), "leagues");
  if (!leagues.data && !leagues.error) return <Skeleton label="Loading your leagues" />;
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={leagues.reload} />}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text accessibilityRole="header" style={[s.title, { flexShrink: 1 }]}>
          Your leagues
        </Text>
        <Action link compact icon="plus" onPress={() => go("/leagues/new")}>
          New league
        </Action>
      </View>
      <Failure message={leagues.error} retry={leagues.reload} />
      {leagues.data?.length === 0 && (
        <Card>
          <Heading>Get ready for your first week</Heading>
          <Text style={s.text}>
            Open an invite from your league commissioner, or press New league to start your own.
          </Text>
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
            {league.role === "admin" && <Pill inline>Commissioner</Pill>}
          </RowLink>
        ))}
      </View>
      {/* Below the leagues, which are what the player came for. Gone once answered or put off. */}
      <NotificationsPrompt />
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
              This league is full. Ask its commissioner to make room, then open the invite again.
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
