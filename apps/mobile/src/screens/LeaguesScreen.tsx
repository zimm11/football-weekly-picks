// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render their children inside native Text.
import { type InvitePreview, LEAGUE_TYPE_INFO, type LeagueSummary } from "@picks/shared";
import { router } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Icon } from "../components/Icon";
import { NotFound } from "../components/NotFound";
import { NotificationsPrompt } from "../components/NotificationsPrompt";
import { layout, radius, space, type, widths } from "../components/theme";
import { colors, fonts, Title } from "../components/ui";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { now } from "../lib/clock";
import { keepLastWords, leagueTodoLine, leagueTodoParts } from "../lib/leagueTodo";
import { usePageTitle } from "../lib/pageTitle";
import { usePullRefresh } from "../lib/pullRefresh";
import { Action, Card, EmptyState, Eyebrow, Failure, RowLink, Skeleton, s, useLeagueLoad } from "./leagueUi";

/** From this many leagues, a wide screen lists them two to a row. */
const TWO_COLUMNS_FROM = 7;

export function LeaguesScreen() {
  const leagues = useLeagueLoad(() => request<LeagueSummary[]>("/leagues"), "leagues");
  const pull = usePullRefresh(leagues.refresh);
  const wide = useWindowDimensions().width >= 768;
  if (!leagues.data && !leagues.error) return <Skeleton label="Loading your leagues" />;
  const list = leagues.data ?? [];
  const columns = wide && list.length >= TWO_COLUMNS_FROM ? 2 : 1;
  const rows: LeagueSummary[][] = [];
  for (let i = 0; i < list.length; i += columns) rows.push(list.slice(i, i + columns));
  const at = now();
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
        <EmptyState
          icon="football"
          title="Get ready for your first week"
          detail="Got an invite? Open your commissioner's link and you're in."
          action={
            <View style={{ alignItems: "center", gap: space.xs }}>
              <Action href="/leagues/new">Start a league</Action>
              <Action ghost compact href="/how-to-play">
                Rules and app guide
              </Action>
            </View>
          }
        />
      )}
      <View style={{ gap: space.md }}>
        {rows.map((row) => (
          <View key={row[0]?.id} style={columns > 1 ? { flexDirection: "row", gap: space.md } : undefined}>
            {row.map((league) =>
              // Each league sits in a plain cell, so its padding can't make it wider than an empty one.
              columns > 1 ? (
                <View key={league.id} style={{ flex: 1 }}>
                  <LeagueRow league={league} at={at} grow />
                </View>
              ) : (
                <LeagueRow key={league.id} league={league} at={at} grow={false} />
              ),
            )}
            {/* An odd last league keeps half the width, in line with the column above it. */}
            {row.length < columns && <View style={{ flex: 1 }} />}
          </View>
        ))}
      </View>
      {/* Below the leagues, which are what the player came for. Gone once answered or put off. */}
      <NotificationsPrompt />
    </ScrollView>
  );
}

function LeagueRow({ league, at, grow }: { league: LeagueSummary; at: Date; grow: boolean }) {
  const info = LEAGUE_TYPE_INFO[league.type] ?? LEAGUE_TYPE_INFO.weekly;
  const commissioner = league.role === "admin";
  const todo = leagueTodoLine(league.todo, at);
  const waiting = leagueTodoParts(league.todo, at);
  const label = [
    league.name,
    info.name,
    commissioner && "Commissioner",
    todo,
    league.unread && "unread messages",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <RowLink href={`/leagues/${league.id}`} label={label} style={grow ? { flex: 1 } : undefined}>
      <View style={rowStyles.disc}>
        <Icon name={info.icon} size={22} color={colors.primaryText} />
      </View>
      <View style={rowStyles.text}>
        <Text numberOfLines={2} style={rowStyles.name}>
          {league.name}
        </Text>
        {/* Two runs, like the line under it: "Commissioner" moves down whole rather than alone. */}
        <View style={rowStyles.todoRow}>
          <Text style={[s.muted, { flexShrink: 1 }]}>
            {info.name}
            {commissioner ? " ·" : ""}
          </Text>
          {commissioner && <Text style={[s.muted, { color: colors.foreground }]}>Commissioner</Text>}
        </View>
        {/* Two runs that wrap as wholes: on a narrow row the lock time moves down together, not word by word. */}
        {waiting && (
          <View style={rowStyles.todoRow}>
            <Text style={rowStyles.todo}>
              {keepLastWords(waiting.what)}
              {waiting.when ? " ·" : ""}
            </Text>
            {waiting.when && <Text style={rowStyles.todo}>{keepLastWords(waiting.when)}</Text>}
          </View>
        )}
      </View>
      {league.unread && <View style={rowStyles.dot} />}
    </RowLink>
  );
}

const rowStyles = StyleSheet.create({
  disc: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: space.xxs },
  name: { ...type.heading, color: colors.foreground },
  todoRow: { flexDirection: "row", flexWrap: "wrap", columnGap: space.xs },
  todo: { ...type.small, fontFamily: fonts.semibold, color: colors.primaryText, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.primary },
});

export function JoinScreen({ code }: { code: string }) {
  const invite = useLeagueLoad(() => request<InvitePreview>(`/invites/${encodeURIComponent(code)}`), code);
  const { me } = useAuth();
  const wide = useWindowDimensions().width >= 768;
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
  const data = invite.data;
  // "Weekly pick'em · 12 players", from what a newer server adds to the preview; nothing from an older one.
  const facts = [
    data?.type && LEAGUE_TYPE_INFO[data.type]?.name,
    data?.memberCount !== undefined && `${data.memberCount} ${data.memberCount === 1 ? "player" : "players"}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <ScrollView style={s.page} contentContainerStyle={[s.content, narrowPage(wide)]}>
      <Failure message={invite.error} retry={invite.reload} />
      {data && (
        <Card style={joinStyles.card}>
          <View style={joinStyles.disc}>
            <Icon name="users" size={28} color={colors.primaryText} />
          </View>
          <View style={{ gap: space.xs, alignItems: "center", alignSelf: "stretch" }}>
            <Eyebrow>You're invited to join</Eyebrow>
            <Title level={1} size="heading" style={{ textAlign: "center" }}>
              {data.leagueName}
            </Title>
            {facts ? <Text style={[s.muted, { textAlign: "center" }]}>{facts}</Text> : null}
          </View>
          {data.alreadyMember ? (
            <Action href={`/leagues/${data.leagueId}`} how="replace" style={joinStyles.button}>
              Go to the league
            </Action>
          ) : data.full ? (
            <Text style={[s.text, { textAlign: "center" }]}>
              This league is full. Ask its commissioner to make room, then open the invite again.
            </Text>
          ) : (
            <>
              <Action
                busy={busy}
                style={joinStyles.button}
                onPress={() => {
                  void join();
                }}
              >
                {busy ? "Joining…" : "Join league"}
              </Action>
              {me?.displayName ? (
                <Text style={[s.muted, { textAlign: "center" }]}>You'll play as {me.displayName}.</Text>
              ) : null}
            </>
          )}
          <Failure message={error} />
        </Card>
      )}
    </ScrollView>
  );
}

/** A one-card page (an invite, unsubscribe): a form-wide column, set lower on a wide screen. */
export function narrowPage(wide: boolean) {
  return { maxWidth: widths.form, paddingTop: wide ? space["5xl"] : layout.pageTop };
}

const joinStyles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: space.xl,
    paddingVertical: space["4xl"],
    paddingHorizontal: space["3xl"],
  },
  disc: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
  },
  button: { alignSelf: "stretch" },
});
