// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render their children inside native Text.
import { type InvitePreview, LEAGUE_TYPE_INFO, type LeagueSummary } from "@picks/shared";
import { router } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { NotFound } from "../components/NotFound";
import { NotificationsPrompt } from "../components/NotificationsPrompt";
import { colors, fonts } from "../components/ui";
import { request } from "../lib/api";
import { usePageTitle } from "../lib/pageTitle";
import { usePullRefresh } from "../lib/pullRefresh";
import {
  Action,
  Card,
  Eyebrow,
  Failure,
  Heading,
  Pill,
  RowLink,
  Skeleton,
  s,
  useLeagueLoad,
} from "./leagueUi";

export function LeaguesScreen() {
  const leagues = useLeagueLoad(() => request<LeagueSummary[]>("/leagues"), "leagues");
  const pull = usePullRefresh(leagues.refresh);
  // On a phone the type and role pills go under the name, so a long name keeps the row's width.
  const stacked = useWindowDimensions().width < 480;
  if (!leagues.data && !leagues.error) return <Skeleton label="Loading your leagues" />;
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.content}
      refreshControl={<RefreshControl {...pull} tintColor={colors.foreground} />}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <Text accessibilityRole="header" style={[s.title, { flexShrink: 1 }]}>
          Your leagues
        </Text>
        <Action compact icon="plus" href="/leagues/new">
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
        {leagues.data?.map((league) => {
          const pills = (
            <>
              <Pill inline>{LEAGUE_TYPE_INFO[league.type]?.name ?? LEAGUE_TYPE_INFO.weekly.name}</Pill>
              {league.role === "admin" && <Pill inline>Commissioner</Pill>}
            </>
          );
          const name = (
            <Text
              style={{
                flex: stacked ? undefined : 1,
                fontFamily: fonts.displayBold,
                fontSize: 24,
                lineHeight: 32,
                color: colors.foreground,
                textTransform: "uppercase",
              }}
            >
              {league.name}
            </Text>
          );
          return (
            <RowLink key={league.id} href={`/leagues/${league.id}`}>
              {stacked ? (
                <View style={{ flex: 1, gap: 4 }}>
                  {name}
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{pills}</View>
                </View>
              ) : (
                <>
                  {name}
                  {pills}
                </>
              )}
            </RowLink>
          );
        })}
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
    if (busy) return;
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
  usePageTitle(
    invite.status === 404
      ? "Invite link not valid"
      : invite.data
        ? `Join ${invite.data.leagueName}`
        : "Join a league",
  );
  // A replaced or deleted invite can't work on a second try: say so, with the way home.
  if (invite.status === 404)
    return (
      <NotFound
        title="This invite link is no longer valid"
        detail="Ask the league commissioner for a new one."
      />
    );
  if (!invite.data && !invite.error) return <Skeleton label="Loading invite" />;
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Eyebrow>You're invited</Eyebrow>
      <Failure message={invite.error} retry={invite.reload} />
      {invite.data && (
        <Card>
          <Heading level={1}>{invite.data.leagueName}</Heading>
          {invite.data.alreadyMember ? (
            <Action href={`/leagues/${invite.data.leagueId}`} how="replace">
              Go to the league
            </Action>
          ) : invite.data.full ? (
            <Text style={s.text}>
              This league is full. Ask its commissioner to make room, then open the invite again.
            </Text>
          ) : (
            <Action
              busy={busy}
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
    <Action ghost compact href="/how-to-play" icon="chevron-right">
      New here? Read the rules & app guide
    </Action>
  );
}
