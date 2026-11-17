// biome-ignore-all lint/correctness/noReactNativeRawText: Heading, Label and Action render native Text.
import {
  FEEDBACK_KIND_LABELS,
  type FeedbackItem,
  type FeedbackPage,
  type FeedbackStatus,
  type GrowthCount,
  type OperatorOverview,
} from "@picks/shared";
import { useState } from "react";
import { Linking, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { BackLink } from "../components/BackLink";
import { colors, fonts } from "../components/ui";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { notifyDone, notifyError } from "../lib/notify";
import {
  Action,
  Card,
  Disclosure,
  Failure,
  Heading,
  Label,
  Pill,
  Skeleton,
  StatTile,
  s,
  useLeagueLoad,
} from "./leagueUi";

const date = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "—";
const growth = (value: GrowthCount) => `+${value.last7Days} in 7 days · +${value.last30Days} in 30`;
/** All counts and feedback come from operator-only API endpoints. */
export function OperatorScreen() {
  const { me } = useAuth();
  return me?.isOperator ? (
    <OperatorDashboard />
  ) : (
    <Text style={[s.text, { padding: 20 }]}>Page not found.</Text>
  );
}
function OperatorDashboard() {
  const overview = useLeagueLoad(() => request<OperatorOverview>("/operator/overview"), "overview"),
    feedback = useLeagueLoad(() => request<FeedbackPage>("/operator/feedback"), "feedback");
  const [busy, setBusy] = useState<string>();
  const { width } = useWindowDimensions();
  async function change(id: string, status: FeedbackStatus) {
    if (busy) return;
    setBusy(id);
    try {
      await request(`/operator/feedback/${id}`, { method: "PUT", body: { status } });
      if (feedback.data)
        feedback.setData({
          ...feedback.data,
          items: feedback.data.items.map((item) => (item.id === id ? { ...item, status } : item)),
        });
      overview.reload();
      notifyDone(status === "done" ? "Marked done." : "Reopened.");
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Couldn't update feedback.");
    } finally {
      setBusy(undefined);
    }
  }
  async function more() {
    if (busy || !feedback.data?.nextCursor) return;
    const current = feedback.data;
    setBusy("more");
    try {
      const next = await request<FeedbackPage>(
        `/operator/feedback?before=${encodeURIComponent(current.nextCursor ?? "")}`,
      );
      const ids = new Set(current.items.map((item) => item.id));
      feedback.setData({
        items: [...current.items, ...next.items.filter((item) => !ids.has(item.id))],
        nextCursor: next.nextCursor,
      });
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Couldn't load older feedback.");
    } finally {
      setBusy(undefined);
    }
  }
  async function refresh() {
    if (busy) return;
    setBusy("refresh");
    try {
      const [nextOverview, nextFeedback] = await Promise.all([
        request<OperatorOverview>("/operator/overview"),
        request<FeedbackPage>("/operator/feedback"),
      ]);
      overview.setData(nextOverview);
      feedback.setData(nextFeedback);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Couldn't refresh the dashboard.");
    } finally {
      setBusy(undefined);
    }
  }
  const data = overview.data;
  const open = feedback.data?.items.filter((item) => item.status === "open") ?? [],
    done = feedback.data?.items.filter((item) => item.status === "done") ?? [];
  if ((!data || !feedback.data) && !overview.error && !feedback.error)
    return <Skeleton label="Loading app numbers" />;
  const tiles = data
    ? [
        { label: "Accounts", value: data.accounts.total, detail: growth(data.accounts) },
        { label: "Leagues", value: data.leagues.total, detail: growth(data.leagues) },
        {
          label: "Active players",
          value: data.activePlayers.last7Days,
          detail: `Picked or posted in 7 days · ${data.activePlayers.last30Days} in 30`,
        },
        { label: "Active leagues", value: data.activeLeagues, detail: "A pick saved in 7 days" },
        { label: "Picks", value: data.picks.total, detail: growth(data.picks) },
        { label: "Messages", value: data.messages.total, detail: growth(data.messages) },
      ]
    : [];
  const cols = width >= 1024 ? 6 : width >= 640 ? 3 : 2;
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.content}
      refreshControl={
        <RefreshControl
          refreshing={busy === "refresh"}
          onRefresh={() => void refresh()}
          tintColor={colors.foreground}
        />
      }
    >
      <BackLink />
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <Text accessibilityRole="header" style={s.title}>
          Operator
        </Text>
        <Action compact secondary icon="refresh" disabled={!!busy} onPress={() => void refresh()}>
          {busy === "refresh" ? "Refreshing…" : "Refresh"}
        </Action>
      </View>
      <Failure
        message={!data || !feedback.data ? (overview.error ?? feedback.error) : undefined}
        retry={() => void refresh()}
      />
      {data && feedback.data && (
        <>
          <Label>
            Everything in the app, across every league. As of {new Date(data.generatedAt).toLocaleString()}.
          </Label>
          <View role="region" aria-label="App totals" style={{ gap: 8 }}>
            {Array.from({ length: Math.ceil(tiles.length / cols) }, (_, index) =>
              tiles.slice(index * cols, (index + 1) * cols),
            ).map((row) => (
              <View key={row[0]?.label} style={{ flexDirection: "row", gap: 8 }}>
                {row.map((tile) => (
                  <StatTile key={tile.label} {...tile} />
                ))}
              </View>
            ))}
          </View>
          <View style={{ gap: 12 }}>
            <Heading>Feedback</Heading>
            <Label>{data.openFeedback} open reports · newest first</Label>
            {open.length ? (
              <View role="list" aria-label="Open feedback" style={{ gap: 12 }}>
                {open.map((item) => (
                  <FeedbackCard
                    key={item.id}
                    item={item}
                    busy={!!busy}
                    saving={busy === item.id}
                    change={change}
                  />
                ))}
              </View>
            ) : (
              <Card>
                <Text style={s.text}>
                  {feedback.data.nextCursor
                    ? "No open feedback in the reports loaded so far."
                    : "No open feedback."}
                </Text>
              </Card>
            )}
            {done.length > 0 && (
              <Disclosure title={`Done (${done.length})`}>
                <View role="list" aria-label="Finished feedback" style={{ gap: 8 }}>
                  {done.map((item) => (
                    <FeedbackCard
                      key={item.id}
                      item={item}
                      busy={!!busy}
                      saving={busy === item.id}
                      change={change}
                    />
                  ))}
                </View>
              </Disclosure>
            )}
            {feedback.data.nextCursor && (
              <Action secondary disabled={!!busy} onPress={() => void more()}>
                {busy === "more" ? "Loading…" : "Load older feedback"}
              </Action>
            )}
          </View>
          <View style={{ gap: 12 }}>
            <Heading>Week by week</Heading>
            <Label>Weeks run Monday to Sunday (UTC), newest first.</Label>
            <View role="table" aria-label="Activity by week" style={{ gap: 12 }}>
              {data.weeks.map((week) => (
                <View role="row" key={week.weekStart} style={s.card}>
                  <Text role="cell" style={[s.subtitle, { fontSize: 18 }]}>
                    {new Date(`${week.weekStart}T00:00:00Z`).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      timeZone: "UTC",
                    })}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {[
                      { label: "Signups", value: week.signups },
                      { label: "Leagues", value: week.leaguesCreated },
                      { label: "Players", value: week.players },
                      { label: "Picks", value: week.picks },
                    ].map((item) => (
                      <View role="cell" key={item.label} style={{ flex: 1, gap: 3 }}>
                        <Label>{item.label}</Label>
                        <Text style={[s.text, { textAlign: "right", fontVariant: ["tabular-nums"] }]}>
                          {item.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </View>
          <View style={{ gap: 12 }}>
            <Heading>Newest leagues</Heading>
            {!data.recentLeagues.length && (
              <Card>
                <Text style={s.text}>No leagues yet.</Text>
              </Card>
            )}
            {data.recentLeagues.map((league) => (
              <Card key={league.id}>
                <Text style={[s.text, { fontFamily: fonts.medium }]}>{league.name}</Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Metadata label="Created" value={date(league.createdAt)} />
                  <Metadata label="Players" value={String(league.members)} />
                  <Metadata label="Last pick" value={date(league.lastPickAt)} />
                </View>
              </Card>
            ))}
          </View>
          <View style={{ gap: 12 }}>
            <Heading>Newest accounts</Heading>
            {data.recentSignups.map((account) => (
              <Card key={`${account.email}-${account.createdAt}`}>
                <Text style={[s.text, { fontFamily: fonts.medium }]}>
                  {account.displayName ?? "No name yet"}
                  {account.email && <Text style={{ color: colors.mutedForeground }}> · {account.email}</Text>}
                </Text>
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <Metadata label="Signed up" value={date(account.createdAt)} />
                  <Metadata label="Last sign-in" value={date(account.lastSignInAt)} />
                  <Metadata label="Leagues" value={String(account.leagues)} />
                </View>
              </Card>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}
function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Label>{label}</Label>
      <Text style={[s.text, { fontSize: 14, lineHeight: 20 }]}>{value}</Text>
    </View>
  );
}
function FeedbackCard({
  item,
  busy,
  saving,
  change,
}: {
  item: FeedbackItem;
  busy: boolean;
  saving: boolean;
  change: (id: string, status: FeedbackStatus) => Promise<void>;
}) {
  const name = item.author ? (item.author.displayName ?? "No name yet") : "Deleted account";
  return (
    <View role="listitem" style={s.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pill tone={item.kind === "bug" ? "warning" : item.kind === "feature" ? "primary" : "muted"}>
          {FEEDBACK_KIND_LABELS[item.kind]}
        </Pill>
        <Label>{date(item.createdAt)}</Label>
      </View>
      <Text selectable style={s.text}>
        {item.message}
      </Text>
      <Text style={s.muted}>
        {name}
        {item.author?.email && (
          <Text
            accessibilityRole="link"
            onPress={() =>
              void Linking.openURL(`mailto:${item.author?.email}`).catch(() =>
                notifyError("Couldn't open your email app."),
              )
            }
            style={{ color: colors.primary }}
          >
            {" "}
            · {item.author.email}
          </Text>
        )}
        {item.page && ` · sent from ${item.page}`}
      </Text>
      {item.kind === "bug" && item.userAgent && (
        <Text style={[s.muted, { fontSize: 12, lineHeight: 18 }]}>{item.userAgent}</Text>
      )}
      <Action
        compact
        secondary
        disabled={busy || saving}
        onPress={() => void change(item.id, item.status === "open" ? "done" : "open")}
      >
        {saving ? "Saving…" : item.status === "open" ? "Mark done" : "Reopen"}
      </Action>
    </View>
  );
}
