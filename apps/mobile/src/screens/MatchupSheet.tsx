// biome-ignore-all lint/suspicious/noArrayIndexKey: A fixed last-five list can repeat opponents and scores.
import {
  type Game,
  type GameInsights,
  type MatchupInsights,
  type TeamInsights,
  teamName,
} from "@picks/shared";
import { type ReactNode, useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { FadeIn } from "../components/FadeIn";
import { Icon } from "../components/Icon";
import { hoverFill, pressState } from "../components/pressState";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { TeamLogo } from "../components/TeamLogo";
import { radius, tabular } from "../components/theme";
import { colors, fonts, Sheet } from "../components/ui";
import { request } from "../lib/api";
import { sentenceCase } from "../lib/resultsPresentation";
import { favoriteLine, kickoffDay, kickoffTime } from "../lib/weekPresentation";
import { WeekAction, w } from "./weekUi";

export function MatchupSheet({
  game,
  timeZone = "America/New_York",
  onClose,
}: {
  game: Game | null;
  timeZone?: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ gameId: string; data?: GameInsights; error?: string }>();
  const [attempt, setAttempt] = useState(0);
  const [linkError, setLinkError] = useState<string>();
  // The sheet's width (never its height): two columns of season leaders need room.
  const [width, setWidth] = useState(0);
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
        <View
          style={{ gap: 16 }}
          onLayout={(event) => {
            const next = event.nativeEvent.layout.width;
            setWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
          }}
        >
          <Text style={w.muted}>
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
          {!data && !shown?.error && <MatchupSkeleton />}
          {linkError && (
            <Text accessibilityRole="alert" style={s.error}>
              {linkError}
            </Text>
          )}
          {data && !data.matchup && (
            <View style={s.empty}>
              <Icon name="chart" size={40} color={colors.mutedForeground} />
              <Text style={s.emptyTitle}>No stats are available for this game right now.</Text>
              <Text style={[w.muted, { textAlign: "center" }]}>
                Form, injuries and win chances usually show up closer to kickoff. Check back later in the
                week.
              </Text>
            </View>
          )}
          {data?.matchup && (
            <FadeIn style={{ gap: 16 }}>
              {data.matchup.prediction && <Prediction game={game} prediction={data.matchup.prediction} />}
              <Matchup
                game={game}
                data={data.matchup}
                timeZone={timeZone}
                openNews={openNews}
                wide={width >= 480}
              />
            </FadeIn>
          )}
        </View>
      )}
    </Sheet>
  );
}
/**
 * The loading placeholder, shaped and sized like what loads (the win probability, the team stats' ten rows, the
 * last five games), so the sheet opens at its final size instead of growing when the stats land: taller than a
 * phone's or a dialog's cap, as the loaded sheet nearly always is.
 */
function MatchupSkeleton() {
  return (
    <View
      accessible
      accessibilityLabel="Loading matchup"
      accessibilityState={{ busy: true }}
      style={{ gap: 16 }}
    >
      <View style={{ gap: 10 }}>
        <SkeletonBlock width={120} height={14} />
        <View style={w.between}>
          <SkeletonBlock width="30%" height={20} />
          <SkeletonBlock width="30%" height={20} />
        </View>
        <SkeletonBlock width="100%" height={10} radius={3} />
        <SkeletonBlock width="85%" height={14} />
      </View>
      <View style={{ gap: 10 }}>
        <SkeletonBlock width={90} height={14} />
        <View style={[w.between, { paddingBottom: 8 }]}>
          <SkeletonBlock width="35%" height={24} />
          <SkeletonBlock width="35%" height={24} />
        </View>
        {Array.from({ length: 10 }, (_, row) => (
          <View key={`row-${row}`} style={[s.comparison, { justifyContent: "space-between" }]}>
            <SkeletonBlock width={44} height={14} />
            <SkeletonBlock width="30%" height={14} />
            <SkeletonBlock width={44} height={14} />
          </View>
        ))}
      </View>
      <View style={{ gap: 10 }}>
        <SkeletonBlock width={110} height={14} />
        <View style={{ flexDirection: "row", gap: 16 }}>
          {["away", "home"].map((side) => (
            <View key={side} style={{ flex: 1, gap: 8 }}>
              <SkeletonBlock width="70%" height={24} />
              {Array.from({ length: 5 }, (_, row) => (
                <SkeletonBlock key={`${side}-${row}`} width="90%" height={14} />
              ))}
            </View>
          ))}
        </View>
      </View>
    </View>
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
function TeamHeading({
  team,
  reverse = false,
  grow = true,
}: {
  team: string;
  reverse?: boolean;
  /** False beside a form strip, where the heading keeps its own width. */
  grow?: boolean;
}) {
  return (
    <View
      style={[
        w.row,
        { gap: 8, minWidth: 0 },
        grow ? { flex: 1 } : { flexShrink: 1 },
        reverse && { flexDirection: "row-reverse" },
      ]}
    >
      <TeamLogo team={team} size={24} />
      <Text numberOfLines={2} style={[s.teamHeading, { flexShrink: 1 }]}>
        {teamName(team)}
      </Text>
    </View>
  );
}
function Prediction({ game, prediction }: { game: Game; prediction: { home: number; away: number } }) {
  const home = teamName(game.homeTeam);
  const away = teamName(game.awayTeam);
  const homePct = Math.round(prediction.home * 100);
  const awayPct = Math.round(prediction.away * 100);
  return (
    <Section title="Win probability">
      <View style={{ gap: 6 }}>
        <View style={w.between}>
          <Text style={[s.predictionTeam, tabular, { flex: 1 }]}>
            {away.toUpperCase()} {awayPct}%
          </Text>
          <Text style={w.small}>To win</Text>
          <Text style={[s.predictionTeam, tabular, { flex: 1, textAlign: "right" }]}>
            {homePct}% {home.toUpperCase()}
          </Text>
        </View>
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Chance to win: ${away} ${awayPct}%, ${home} ${homePct}%`}
          style={s.probability}
        >
          <View
            style={[s.segment, { flex: prediction.away, backgroundColor: `${colors.mutedForeground}99` }]}
          />
          <View style={[s.segment, { flex: prediction.home, backgroundColor: colors.foreground }]} />
        </View>
      </View>
      <Text style={w.muted}>
        A projection from simulations of the game. It picks winners outright and isn't how this league picked.
      </Text>
    </Section>
  );
}
/**
 * Something for each team: in two columns under the teams' names, away on the left and home on the right, as
 * the team stats are; stacked, away first, when `columns` is false. `aside` sits beside a team's name.
 */
function PerTeam({
  game,
  data,
  columns = true,
  aside,
  children,
}: {
  game: Game;
  data: MatchupInsights;
  columns?: boolean;
  aside?: (team: TeamInsights) => ReactNode;
  children: (team: TeamInsights) => ReactNode;
}) {
  return (
    <View style={columns ? { flexDirection: "row", gap: 16 } : { gap: 16 }}>
      {(["away", "home"] as const).map((side) => (
        <View key={side} style={[{ gap: 8, minWidth: 0 }, columns && { flex: 1 }]}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <TeamHeading team={side === "home" ? game.homeTeam : game.awayTeam} grow={!aside} />
            {aside?.(data[side])}
          </View>
          {children(data[side])}
        </View>
      ))}
    </View>
  );
}
/** A team's last five results as five squares, latest first: the letter and its fill, never color alone. */
function FormStrip({ results }: { results: TeamInsights["lastFive"] }) {
  if (!results.length) return null;
  const latestFirst = [...results].reverse();
  return (
    <View
      accessible
      accessibilityLabel={`Form, latest first: ${latestFirst.map((r) => r.result).join(", ")}`}
      style={{ flexDirection: "row", gap: 3 }}
    >
      {latestFirst.map((result, index) => (
        <View
          key={`${result.opponent}-${index}`}
          style={[s.form, { backgroundColor: result.result === "W" ? colors.winTint : colors.raised }]}
        >
          <Text style={[s.formText, { color: result.result === "W" ? colors.win : colors.mutedForeground }]}>
            {result.result}
          </Text>
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
  wide,
}: {
  game: Game;
  data: MatchupInsights;
  timeZone: string;
  openNews: (url: string) => Promise<void>;
  /** The sheet has room (480px) for the season leaders in two columns. */
  wide: boolean;
}) {
  const comparison = [
    { label: "Record", away: data.away.record, home: data.home.record },
    { label: "Road / home", away: data.away.venueRecord, home: data.home.venueRecord },
    // The feed names its stats in Title Case: drawn in sentence case, as the app writes.
    ...data.stats.map((row) => ({ ...row, label: sentenceCase(row.label) })),
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
          {/* In a wide sheet the two columns stay close enough to read across. */}
          <View style={{ width: "100%", maxWidth: 440, alignSelf: "center" }}>
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
          <PerTeam game={game} data={data} aside={(team) => <FormStrip results={team.lastFive} />}>
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
          <PerTeam game={game} data={data} columns={wide}>
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
                accessibilityLabel={`${story.headline}. Opens the full story.`}
                onPress={() => void openNews(story.url)}
                style={(state) => [
                  s.news,
                  { backgroundColor: hoverFill(state) },
                  pressState(state).pressed && { opacity: 0.7 },
                ]}
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
        <WeekAction label="Full game page ↗" secondary onPress={() => void openNews(data.url as string)} />
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
  predictionTeam: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 21, color: colors.foreground },
  probability: { height: 10, flexDirection: "row", gap: 2, borderRadius: 3, overflow: "hidden" },
  segment: { height: 10 },
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
    // The hover fill reaches a little past the text without moving it.
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.destructive },
  form: { width: 20, height: 20, borderRadius: radius.xs, alignItems: "center", justifyContent: "center" },
  formText: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14 },
  empty: { alignItems: "center", gap: 8, paddingVertical: 32, paddingHorizontal: 16 },
  emptyTitle: { fontFamily: fonts.semibold, fontSize: 16, color: colors.foreground, textAlign: "center" },
});
