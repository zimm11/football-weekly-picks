// biome-ignore-all lint/correctness/noReactNativeRawText: Eyebrow, Label and Heading render native Text.
import { type Record3, type Standings, weekLabel, winRate } from "@picks/shared";
import { type ReactNode, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import { colors, fonts } from "../components/ui";
import { Card, Eyebrow, Label, RowLink, StatTile, s } from "./leagueUi";

type Entry = Standings["entries"][number];
export const record = (r: Record3) => `${r.wins}–${r.losses}${r.pushes ? `–${r.pushes}` : ""}`;
export const percent = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);
export const average = (value: number | null) =>
  value === null ? "—" : value.toFixed(1).replace(/\.0$/, "");
export const ordinal = (n: number) =>
  `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th"}`;
const avg = (entry: Entry) => {
  const weeks = entry.weekly.filter((w) => w !== null);
  return weeks.length ? weeks.reduce((total, w) => total + w.points, 0) / weeks.length : null;
};

function RankChange({ change }: { change: number | null }) {
  return change ? (
    <Text
      accessibilityLabel={`${Math.abs(change)} places ${change > 0 ? "up" : "down"} since last week`}
      style={{
        fontFamily: fonts.semibold,
        fontSize: 12,
        color: change > 0 ? colors.win : colors.mutedForeground,
      }}
    >
      {" "}
      {change > 0 ? "▲" : "▼"}
      {Math.abs(change)}
    </Text>
  ) : null;
}
function Name({ entry }: { entry: Entry }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flex: 1 }}>
      <Avatar name={entry.displayName} size={28} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={2} style={[s.text, { fontSize: 14, lineHeight: 18, fontFamily: fonts.medium }]}>
          {entry.displayName}
          <RankChange change={entry.rankChange} />
        </Text>
        {entry.removed && (
          <Text style={[s.muted, { fontSize: 10, lineHeight: 12 }]}>No longer in the league</Text>
        )}
      </View>
    </View>
  );
}
type TableRow = { id: string; name: ReactNode; values: ReactNode[]; mine?: boolean };
/** A stat column: its natural width, plus an even share of any room left over on wide screens. */
const column = (width = 66) => ({ flexBasis: width, flexGrow: 1, flexShrink: 0 });
/** The web build's first column stays put while the rest scroll sideways. */
const stickyFirst = { position: "sticky", left: 0, zIndex: 1 } as unknown as ViewStyle;
/** Read by screen readers (and in the page's text) but not drawn. */
export const srOnly = { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 } as const;
function StickyTable({
  label,
  columns,
  rows,
  footer,
}: {
  label: string;
  columns: { title: string; width?: number }[];
  rows: TableRow[];
  footer?: TableRow;
}) {
  const all = footer ? [...rows, footer] : rows;
  const { width } = useWindowDimensions();
  const nameWidth = width < 440 ? 145 : 185;
  const headerStyle = {
    height: 40,
    justifyContent: "center" as const,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  };
  const cellStyle = {
    height: 66,
    justifyContent: "center" as const,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  };
  if (Platform.OS === "web")
    // A real table in the browser, one row per player, so each row reads (and is found) as a whole.
    return (
      <View
        role="table"
        aria-label={label}
        style={{ borderRadius: 16, overflow: "hidden", backgroundColor: colors.card }}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
          <View style={{ flexGrow: 1 }}>
            <View role="row" style={{ flexDirection: "row" }}>
              <View
                role="columnheader"
                style={[headerStyle, stickyFirst, { width: nameWidth, backgroundColor: colors.card }]}
              >
                <Text style={[s.muted, { fontSize: 12, fontFamily: fonts.medium }]}>Player</Text>
              </View>
              {columns.map((col) => (
                <View
                  role="columnheader"
                  key={col.title}
                  style={[headerStyle, column(col.width), { alignItems: "flex-end" }]}
                >
                  <Text style={[s.muted, { fontSize: 12, fontFamily: fonts.medium }]}>{col.title}</Text>
                </View>
              ))}
            </View>
            {all.map((row) => (
              <View
                role="row"
                key={row.id}
                style={{ flexDirection: "row", backgroundColor: row.mine ? colors.raised : colors.card }}
              >
                <View
                  role="rowheader"
                  style={[
                    cellStyle,
                    stickyFirst,
                    { width: nameWidth, backgroundColor: row.mine ? colors.raised : colors.card },
                  ]}
                >
                  {row.name}
                </View>
                {columns.map((col, i) => (
                  <View
                    role="cell"
                    key={col.title}
                    style={[cellStyle, column(col.width), { alignItems: "flex-end" }]}
                  >
                    <Text style={[s.text, { fontSize: 14, fontVariant: ["tabular-nums"] }]}>
                      {row.values[i]}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  return (
    <View
      accessibilityLabel={label}
      style={{ borderRadius: 16, overflow: "hidden", backgroundColor: colors.card, flexDirection: "row" }}
    >
      <View style={{ width: nameWidth, zIndex: 1 }}>
        <View style={headerStyle}>
          <Text style={[s.muted, { fontSize: 12, fontFamily: fonts.medium }]}>Player</Text>
        </View>
        {all.map((row) => (
          <View key={row.id} style={[cellStyle, row.mine && { backgroundColor: colors.raised }]}>
            {row.name}
          </View>
        ))}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        accessibilityLabel={`${label} statistics, scroll horizontally`}
        // Scrolls sideways on a phone; on a wide screen the columns grow to fill the card.
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View style={{ flexGrow: 1 }}>
          <View style={{ flexDirection: "row" }}>
            {columns.map((col) => (
              <View key={col.title} style={[headerStyle, column(col.width), { alignItems: "flex-end" }]}>
                <Text style={[s.muted, { fontSize: 12, fontFamily: fonts.medium }]}>{col.title}</Text>
              </View>
            ))}
          </View>
          {all.map((row) => (
            <View
              key={row.id}
              style={{ flexDirection: "row", backgroundColor: row.mine ? colors.raised : colors.card }}
            >
              {columns.map((col, i) => (
                <View key={col.title} style={[cellStyle, column(col.width), { alignItems: "flex-end" }]}>
                  <Text
                    accessibilityLabel={`${col.title}: ${typeof row.values[i] === "string" || typeof row.values[i] === "number" ? row.values[i] : ""}`}
                    style={[s.text, { fontSize: 14, fontVariant: ["tabular-nums"] }]}
                  >
                    {row.values[i]}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export function StandingsDashboard({ standings, userId }: { standings: Standings; userId: string }) {
  return (
    <View style={{ gap: 24 }}>
      <YourSeason standings={standings} userId={userId} />
      <View style={{ gap: 12 }}>
        {standings.weeks.length > 0 && <Eyebrow>Leaderboard</Eyebrow>}
        <StickyTable
          label="Season standings"
          columns={[
            { title: "Pts", width: 54 },
            { title: "POW", width: 80 },
            { title: "W–L", width: 80 },
            { title: "Win %" },
            { title: "Avg", width: 54 },
            { title: "MNF", width: 54 },
            { title: "SNF", width: 54 },
            { title: "Wks", width: 54 },
          ]}
          rows={standings.entries.map((entry) => ({
            id: entry.userId,
            mine: entry.userId === userId,
            name: (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontFamily: fonts.displayBold, fontSize: 18, color: colors.mutedForeground }}>
                  {entry.rank}
                </Text>
                <Name entry={entry} />
              </View>
            ),
            values: [
              <Text key="points" style={{ fontFamily: fonts.displayBold, fontSize: 22 }}>
                {entry.points}
              </Text>,
              record({ wins: entry.powWins, losses: entry.powLosses, pushes: entry.powPushes }),
              record(entry),
              percent(winRate(entry)),
              average(avg(entry)),
              entry.mondayWins,
              entry.sundayNightWins,
              entry.weeksWon,
            ],
          }))}
        />
        <Text style={[s.muted, { fontSize: 12, lineHeight: 18 }]}>
          Closed weeks only. Ties go to POWs won, then wins, then MNF and SNF wins.
        </Text>
      </View>
      {standings.weeks.length > 0 && (
        <>
          <View style={{ gap: 12 }}>
            <Eyebrow>Week by week</Eyebrow>
            <StickyTable
              label="Points by week"
              columns={[
                ...standings.weeks.map((w) => ({ title: `W${w.number}`, width: 58 })),
                { title: "Total", width: 64 },
              ]}
              rows={standings.entries.map((entry) => ({
                id: entry.userId,
                mine: entry.userId === userId,
                name: <Name entry={entry} />,
                values: [
                  ...standings.weeks.map((week, i) => {
                    const result = entry.weekly[i];
                    return result ? (
                      <Text
                        key={week.id}
                        accessibilityLabel={`${result.points} points, ${ordinal(result.rank)}${result.isWinner ? ", won the week" : ""}`}
                        style={{ color: result.isWinner ? colors.win : colors.foreground }}
                      >
                        {result.isWinner ? "★ " : ""}
                        {result.points}
                        {Platform.OS === "web" && result.isWinner && (
                          <Text style={srOnly}> (won the week)</Text>
                        )}
                      </Text>
                    ) : (
                      "—"
                    );
                  }),
                  entry.points,
                ],
              }))}
              footer={{
                id: "average",
                name: <Text style={s.muted}>Avg</Text>,
                values: [...standings.weeks.map((w) => average(w.averagePoints)), ""],
              }}
            />
          </View>
          <View style={{ gap: 12 }}>
            <Eyebrow>Pick splits</Eyebrow>
            <StickyTable
              label="Pick splits"
              columns={[
                { title: "Favorites", width: 116 },
                { title: "Underdogs", width: 116 },
                { title: "Home", width: 116 },
                { title: "Away", width: 116 },
              ]}
              rows={standings.entries.map((entry) => ({
                id: entry.userId,
                mine: entry.userId === userId,
                name: <Name entry={entry} />,
                values: (["favorite", "underdog", "home", "away"] as const).map((kind) => {
                  const r = entry.splits[kind];
                  return r.wins + r.losses + r.pushes ? `${record(r)}  ${percent(winRate(r))}` : "—";
                }),
              }))}
            />
            <Label>Records against the spread. Pick'em games count as home or away only.</Label>
          </View>
        </>
      )}
    </View>
  );
}
function YourSeason({ standings, userId }: { standings: Standings; userId: string }) {
  const { width } = useWindowDimensions();
  const cols = width >= 1024 ? 6 : width >= 640 ? 3 : 2;
  const me = standings.entries.find((entry) => entry.userId === userId);
  if (!me || !standings.weeks.length) return null;
  const leader = standings.entries[0];
  const behind = (leader?.points ?? 0) - me.points;
  const played = me.weekly.flatMap((result, index) =>
    result ? [{ ...result, week: standings.weeks[index] }] : [],
  );
  const best = played.reduce<(typeof played)[number] | undefined>(
    (a, b) => (!a || b.points > a.points ? b : a),
    undefined,
  );
  const pow = { wins: me.powWins, losses: me.powLosses, pushes: me.powPushes };
  const tiles = [
    {
      label: "Rank",
      value: (
        <>
          {ordinal(me.rank)}
          <RankChange change={me.rankChange} />
        </>
      ),
      detail:
        me.rank === 1
          ? "Leading the league"
          : `${behind} ${behind === 1 ? "pt" : "pts"} behind ${leader?.displayName}`,
    },
    { label: "Points", value: me.points, detail: `${average(avg(me))} a week` },
    { label: "Record", value: record(me), detail: `${percent(winRate(me))} against the spread` },
    { label: "POW", value: record(pow), detail: `${percent(winRate(pow))} of POWs won` },
    { label: "Weeks won", value: me.weeksWon, detail: `of ${standings.weeks.length} closed` },
    {
      label: "Best week",
      value: best?.points ?? "—",
      detail: best?.week ? `${weekLabel(best.week.number)} · ${ordinal(best.rank)}` : undefined,
    },
  ];
  return (
    <View role="region" aria-label="Your season" style={{ gap: 12 }}>
      <Eyebrow>Your season</Eyebrow>
      <View role="region" aria-label="Your season stats" style={{ gap: 8 }}>
        {Array.from({ length: Math.ceil(tiles.length / cols) }, (_, i) =>
          tiles.slice(i * cols, (i + 1) * cols),
        ).map((row) => (
          <View key={row[0]?.label} style={{ flexDirection: "row", gap: 8 }}>
            {row.map((tile) => (
              <StatTile key={tile.label} {...tile} />
            ))}
          </View>
        ))}
      </View>
      <PointsChart standings={standings} entry={me} />
    </View>
  );
}
function PointsChart({ standings, entry }: { standings: Standings; entry: Entry }) {
  const [selected, setSelected] = useState(standings.weeks.length - 1);
  const max = Math.max(
    1,
    ...standings.weeks.map((w) => w.topPoints ?? 0),
    ...entry.weekly.map((w) => w?.points ?? 0),
  );
  const week = standings.weeks[selected];
  const mine = entry.weekly[selected];
  const description = (i: number) => {
    const w = standings.weeks[i],
      result = entry.weekly[i];
    return `${weekLabel(w?.number ?? 0)}: ${result ? `${result.points} pts, ${ordinal(result.rank)}${result.isWinner ? " (won the week)" : ""}` : "Didn't play"} · league average ${average(w?.averagePoints ?? null)} · top ${w?.topPoints ?? "—"}`;
  };
  return (
    <Card>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
        <Eyebrow>Points by week</Eyebrow>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
          <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors.primary }} />
            <Text style={[s.muted, { fontSize: 12 }]}>You</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 5, alignItems: "center" }}>
            <View style={{ width: 12, height: 2, backgroundColor: colors.mutedForeground }} />
            <Text style={[s.muted, { fontSize: 12 }]}>League average</Text>
          </View>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ height: 150, flexDirection: "row", alignItems: "flex-end", gap: 2 }}>
          {standings.weeks.map((w, i) => {
            const result = entry.weekly[i];
            return (
              <Pressable
                key={w.id}
                accessibilityRole="button"
                accessibilityLabel={description(i)}
                accessibilityState={{ selected: i === selected }}
                onPress={() => setSelected(i)}
                style={{ width: 44, height: 148 }}
              >
                <View style={{ flex: 1, position: "relative" }}>
                  {result && (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 7,
                        right: 7,
                        height: Math.max(1, (result.points / max) * 112),
                        backgroundColor: colors.primary,
                        opacity: i === selected ? 1 : 0.75,
                        borderTopLeftRadius: 3,
                        borderTopRightRadius: 3,
                      }}
                    />
                  )}
                  <View
                    style={{
                      position: "absolute",
                      bottom: ((w.averagePoints ?? 0) / max) * 112,
                      left: 0,
                      right: 0,
                      height: 2,
                      backgroundColor: colors.mutedForeground,
                    }}
                  />
                  {result?.isWinner && (
                    <View style={{ position: "absolute", bottom: (result.points / max) * 112 + 3, left: 15 }}>
                      <Icon name="trophy" size={14} filled color={colors.win} />
                    </View>
                  )}
                </View>
                <Text
                  style={[
                    s.muted,
                    {
                      textAlign: "center",
                      fontSize: 11,
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      paddingTop: 4,
                    },
                  ]}
                >
                  {w.number}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Text accessibilityLiveRegion="polite" style={[s.text, { minHeight: 40 }]}>
        {week ? description(selected) : mine ? `${mine.points} points` : ""}
      </Text>
    </Card>
  );
}

export function SeasonResults({
  standings,
  userId,
  onWeek,
}: {
  standings: Standings;
  userId: string;
  onWeek: (id: string) => void;
}) {
  const me = standings.entries.find((e) => e.userId === userId);
  return (
    <View style={{ gap: 8 }}>
      {[...standings.weeks].reverse().map((week) => {
        const index = standings.weeks.findIndex((w) => w.id === week.id);
        const mine = me?.weekly[index];
        return (
          <RowLink key={week.id} onPress={() => onWeek(week.id)} label={`${weekLabel(week.number)} results`}>
            <Text style={[s.subtitle, { fontSize: 24 }]}>{weekLabel(week.number)}</Text>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.muted}>
                {week.winners.length ? `Won by ${week.winners.join(", ")}` : "Final"}
                {week.topPoints !== null ? ` · ${week.topPoints} pts` : ""}
              </Text>
              {week.lowPointLosers.length > 0 && (
                <Text style={s.muted}>LPL: {week.lowPointLosers.join(", ")}</Text>
              )}
            </View>
            {mine && (
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Text
                  style={{
                    fontFamily: fonts.displayBold,
                    fontSize: 20,
                    lineHeight: 20,
                    color: mine.isWinner ? colors.win : colors.foreground,
                  }}
                >
                  {mine.points}
                </Text>
                <Text style={[s.muted, { fontSize: 12, lineHeight: 16 }]}>You · {ordinal(mine.rank)}</Text>
              </View>
            )}
          </RowLink>
        );
      })}
    </View>
  );
}
