// biome-ignore-all lint/suspicious/noArrayIndexKey: A fixed last-five list can repeat opponents and scores.
import {
  formatLine,
  type Game,
  type GameInsights,
  type MarketInsights,
  type MatchupInsights,
  type TeamInsights,
  teamName,
} from "@picks/shared";
import { type ReactNode, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../components/Icon";
import { TeamLogo } from "../components/TeamLogo";
import { colors, fonts, Sheet } from "../components/ui";
import { request } from "../lib/api";
import { favoriteLine, kickoffDay, kickoffTime, percent } from "../lib/weekPresentation";
import { WeekAction, w } from "./weekUi";

export function MatchupSheet({
  game,
  timeZone = "America/New_York",
  onClose,
  winOnly = false,
}: {
  game: Game | null;
  timeZone?: string;
  onClose: () => void;
  /** Survivor picks straight up: show the market's win prices only, no spread lines. */
  winOnly?: boolean;
}) {
  const [state, setState] = useState<{ gameId: string; data?: GameInsights; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const [linkError, setLinkError] = useState<string>();
  const gameId = game?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the same matchup.
  useEffect(() => {
    if (!gameId) return;
    let active = true;
    setState({ gameId });
    setLinkError(undefined);
    request<GameInsights>(`/games/${gameId}/insights`).then(
      (data) => {
        if (active) setState({ gameId, data });
      },
      (error) => {
        if (active)
          setState({ gameId, error: error instanceof Error ? error.message : "Couldn't load this matchup." });
      },
    );
    return () => {
      active = false;
    };
  }, [gameId, attempt]);
  const shown = state?.gameId === gameId ? state : undefined;
  const data = shown?.data;
  async function openNews(url: string) {
    if (!/^https:\/\//i.test(url)) return;
    try {
      await Linking.openURL(url);
    } catch {
      setLinkError("Couldn't open that story. Try again.");
    }
  }
  return (
    <Sheet
      visible={!!game}
      onClose={onClose}
      title={game ? `${teamName(game.awayTeam)} at ${teamName(game.homeTeam)}` : "Matchup"}
    >
      {game && (
        <>
          <Text style={[w.muted, { marginTop: -8 }]}>
            {kickoffDay(game.kickoff, timeZone)} · {kickoffTime(game.kickoff, timeZone)}
            {game.spread !== null ? ` · ${favoriteLine(game, game.spread)}` : ""}
          </Text>
          {shown?.error && (
            <View style={w.stack}>
              <Text accessibilityRole="alert" style={s.error}>
                {shown.error}
              </Text>
              <WeekAction label="Try again" secondary onPress={() => setAttempt((value) => value + 1)} />
            </View>
          )}
          {!data && !shown?.error && (
            <View accessibilityLabel="Loading matchup" accessibilityState={{ busy: true }} style={w.stack}>
              {[48, 80, 128].map((height) => (
                <View key={height} style={[s.placeholder, { height }]} />
              ))}
            </View>
          )}
          {linkError && (
            <Text accessibilityRole="alert" style={s.error}>
              {linkError}
            </Text>
          )}
          {data && !data.market && !data.matchup && (
            <View style={s.empty}>
              <Icon name="chart" size={40} color={colors.mutedForeground} />
              <Text style={s.emptyTitle}>No stats are available for this game right now.</Text>
              <Text style={[w.muted, { textAlign: "center" }]}>
                Form, injuries and market prices usually show up closer to kickoff. Check back later in the
                week.
              </Text>
            </View>
          )}
          {data?.market && <Market game={game} market={data.market} winOnly={winOnly} />}
          {data?.matchup && (
            <Matchup game={game} data={data.matchup} timeZone={timeZone} openNews={openNews} />
          )}
        </>
      )}
    </Sheet>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10, marginBottom: 8 }}>
      <Text accessibilityRole="header" style={s.eyebrow}>
        {title}
      </Text>
      {children}
    </View>
  );
}
function TeamHeading({ team, reverse = false }: { team: string; reverse?: boolean }) {
  return (
    <View style={[w.row, { flex: 1, gap: 8 }, reverse && { flexDirection: "row-reverse" }]}>
      <TeamLogo team={team} size={24} />
      <Text numberOfLines={2} style={[s.teamHeading, { flexShrink: 1 }]}>
        {teamName(team)}
      </Text>
    </View>
  );
}
function Market({ game, market, winOnly }: { game: Game; market: MarketInsights; winOnly: boolean }) {
  const home = teamName(game.homeTeam);
  const away = teamName(game.awayTeam);
  const push = market.cover ? Math.max(0, 1 - market.cover.home - market.cover.away) : 0;
  const edge = market.spread !== null && game.spread !== null ? game.spread - market.spread : 0;
  const homePct = market.homeWin === null ? 0 : Math.round(market.homeWin * 100);
  const awayPct = 100 - homePct;
  const rows: { label: string; value: string }[] = [];
  if (market.cover && game.spread !== null) {
    rows.push(
      {
        label: `${formatLine(away, game.spread === 0 ? 0 : -game.spread)} covers`,
        value: percent(market.cover.away),
      },
      { label: `${formatLine(home, game.spread)} covers`, value: percent(market.cover.home) },
    );
    if (push >= 0.005) rows.push({ label: "Push", value: percent(push) });
  }
  if (market.spread !== null && !winOnly)
    rows.push({ label: "Market's line", value: favoriteLine(game, market.spread) });
  return (
    <Section title="Prediction market">
      {market.homeWin !== null && (
        <View style={{ gap: 6 }}>
          <View style={w.between}>
            <Text style={[s.marketTeam, { flex: 1 }]}>
              {away.toUpperCase()} {awayPct}%
            </Text>
            <Text style={w.small}>To win</Text>
            <Text style={[s.marketTeam, { flex: 1, textAlign: "right" }]}>
              {homePct}% {home.toUpperCase()}
            </Text>
          </View>
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`Chance to win: ${away} ${awayPct}%, ${home} ${homePct}%`}
            style={s.probability}
          >
            <View style={[s.segment, { flex: awayPct, backgroundColor: `${colors.mutedForeground}99` }]} />
            <View style={[s.segment, { flex: homePct, backgroundColor: colors.foreground }]} />
          </View>
        </View>
      )}
      <View>
        {rows.map((row) => (
          <View key={row.label} style={s.marketRow}>
            <Text style={[w.muted, { flex: 1 }]}>{row.label}</Text>
            <Text style={s.value}>{row.value}</Text>
          </View>
        ))}
      </View>
      {edge !== 0 && (
        <Text style={w.body}>
          {edge > 0 ? home : away} get {Math.abs(edge)} {Math.abs(edge) === 1 ? "point" : "points"} more here
          than at the market's line.
        </Text>
      )}
      <Text style={w.muted}>
        Prices from {market.source}, a national prediction market. They show what traders expect, not how this
        league picked.
      </Text>
    </Section>
  );
}
function PerTeam({
  game,
  data,
  children,
}: {
  game: Game;
  data: MatchupInsights;
  children: (team: TeamInsights) => ReactNode;
}) {
  return (
    <View style={{ gap: 16 }}>
      {(["away", "home"] as const).map((side) => (
        <View key={side} style={{ gap: 6 }}>
          <TeamHeading team={side === "home" ? game.homeTeam : game.awayTeam} />
          {children(data[side])}
        </View>
      ))}
    </View>
  );
}
function Matchup({
  game,
  data,
  timeZone,
  openNews,
}: {
  game: Game;
  data: MatchupInsights;
  timeZone: string;
  openNews: (url: string) => Promise<void>;
}) {
  const comparison = [
    { label: "Record", away: data.away.record, home: data.home.record },
    { label: "Road / home", away: data.away.venueRecord, home: data.home.venueRecord },
    ...data.stats,
  ].filter((row) => row.away !== null && row.home !== null);
  const has = (pick: (team: TeamInsights) => unknown[]) =>
    pick(data.home).length > 0 || pick(data.away).length > 0;
  const seen = new Set<string>();
  const news = [
    ...data.away.news.map((story) => ({ ...story, team: game.awayTeam })),
    ...data.home.news.map((story) => ({ ...story, team: game.homeTeam })),
  ]
    .filter((story) => !seen.has(story.url) && seen.add(story.url))
    .sort((a, b) => b.published.localeCompare(a.published));
  const date = (iso: string) => {
    const value = new Date(iso);
    return Number.isNaN(value.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(value);
  };
  return (
    <>
      {comparison.length > 0 && (
        <Section title="Team stats">
          <View>
            <View style={[w.row, { paddingBottom: 8 }]}>
              <TeamHeading team={game.awayTeam} />
              <View style={{ width: 32 }} />
              <TeamHeading team={game.homeTeam} reverse />
            </View>
            {comparison.map((row) => (
              <View key={row.label} style={s.comparison}>
                <Text style={[s.value, { flex: 1 }]}>{row.away}</Text>
                <Text style={[w.muted, { flex: 1.4, textAlign: "center" }]}>{row.label}</Text>
                <Text style={[s.value, { flex: 1, textAlign: "right" }]}>{row.home}</Text>
              </View>
            ))}
          </View>
          {data.overUnder !== null && (
            <Text style={w.muted}>
              Posted total for this game:{" "}
              <Text style={{ color: colors.foreground }}>{data.overUnder} points</Text>.
            </Text>
          )}
        </Section>
      )}
      {has((team) => team.lastFive) && (
        <Section title="Last five games">
          <PerTeam game={game} data={data}>
            {(team) => (
              <View style={{ gap: 4 }}>
                {team.lastFive.length === 0 && <Text style={w.muted}>No games yet.</Text>}
                {[...team.lastFive].reverse().map((result, index) => (
                  <View key={`${result.opponent}-${result.score}-${result.home}-${index}`} style={w.row}>
                    <Text
                      style={[
                        s.result,
                        {
                          color:
                            result.result === "W"
                              ? colors.win
                              : result.result === "L"
                                ? colors.mutedForeground
                                : colors.foreground,
                        },
                      ]}
                    >
                      {result.result}
                    </Text>
                    <Text style={[w.muted, { color: colors.foreground, fontVariant: ["tabular-nums"] }]}>
                      {result.score}
                    </Text>
                    <Text style={w.muted}>
                      {result.home ? "vs" : "at"} {result.opponent}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </PerTeam>
        </Section>
      )}
      {has((team) => team.injuries) && (
        <Section title="Injuries">
          <PerTeam game={game} data={data}>
            {(team) => (
              <View style={{ gap: 6 }}>
                {team.injuries.length === 0 && <Text style={w.muted}>None listed.</Text>}
                {team.injuries.map((injury) => (
                  <View key={`${injury.name}-${injury.status}`}>
                    <Text style={s.value}>
                      {injury.position && <Text style={w.muted}>{injury.position} </Text>}
                      {injury.name}
                    </Text>
                    <Text style={w.muted}>
                      {injury.status}
                      {injury.injury ? ` · ${injury.injury}` : ""}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </PerTeam>
        </Section>
      )}
      {has((team) => team.leaders) && (
        <Section title="Season leaders">
          <PerTeam game={game} data={data}>
            {(team) => (
              <View style={{ gap: 6 }}>
                {team.leaders.map((leader) => (
                  <View key={`${leader.label}-${leader.name}`}>
                    <Text style={s.value}>{leader.name}</Text>
                    <Text style={w.muted}>{leader.line}</Text>
                  </View>
                ))}
              </View>
            )}
          </PerTeam>
        </Section>
      )}
      {news.length > 0 && (
        <Section title="Latest news">
          <View>
            {news.map((story) => (
              <Pressable
                key={story.url}
                accessibilityRole="link"
                accessibilityLabel={`${story.headline}. Opens ESPN.`}
                onPress={() => void openNews(story.url)}
                style={({ pressed }) => [s.news, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.value}>{story.headline}</Text>
                  <Text style={w.muted}>
                    {story.team} · {date(story.published)}
                  </Text>
                </View>
                <Icon name="external" size={20} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        </Section>
      )}
      {data.url && (
        <WeekAction
          label="Full game page on ESPN ↗"
          secondary
          onPress={() => void openNews(data.url as string)}
        />
      )}
    </>
  );
}
const s = StyleSheet.create({
  eyebrow: { fontFamily: fonts.semibold, fontSize: 14, color: colors.mutedForeground },
  teamHeading: {
    textTransform: "uppercase",
    fontFamily: fonts.displayBold,
    fontSize: 18,
    lineHeight: 20,
    color: colors.foreground,
  },
  value: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  marketTeam: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 21, color: colors.foreground },
  probability: { height: 10, flexDirection: "row", gap: 2, borderRadius: 3, overflow: "hidden" },
  segment: { height: 10 },
  marketRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  comparison: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  result: { fontFamily: fonts.bold, width: 16, fontSize: 14, lineHeight: 20 },
  news: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.destructive },
  placeholder: { backgroundColor: colors.raised, borderRadius: 12 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 32, paddingHorizontal: 16 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.foreground, textAlign: "center" },
});
