// biome-ignore-all lint/correctness/noReactNativeRawText: Heading and Label render native Text.
import { type SurvivorView, weekLabel } from "@picks/shared";
import type { ReactNode } from "react";
import { Platform, ScrollView, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { TeamLogo } from "../../components/TeamLogo";
import { colors, fonts } from "../../components/ui";
import {
  aliveCount,
  type GridCell,
  gridCell,
  gridWeeks,
  listNames,
  playerStatus,
  type SurvivorPlayer,
  type SurvivorWeek,
  weekShort,
} from "../../lib/survivor";
import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps } from "../leagueTypeScreens";
import { Card, Failure, Heading, Label, s } from "../leagueUi";
import { SurvivorSkeleton, useSurvivor } from "./useSurvivor";

/** The web build's first column stays put while the weeks scroll sideways. */
const stickyFirst = { position: "sticky", left: 0, zIndex: 1 } as unknown as ViewStyle;
const CELL = 64;
const ROW = 60;

/**
 * Standings: the survivor grid. Players down the side (alive first, the rest by how long they lasted), weeks
 * across, each cell the team picked once it is revealed, with how it did as an icon and a word, never color alone.
 */
export function SurvivorStandings({ league, year, userId, header, reload }: LeagueTabProps) {
  const survivor = useSurvivor(league.id, year);
  const view = survivor.data;
  return (
    <LeagueTabScroll
      header={header}
      reload={() => {
        reload();
        survivor.reload();
      }}
    >
      {!view ? (
        survivor.error ? (
          <Failure message={survivor.error} retry={survivor.reload} />
        ) : (
          <SurvivorSkeleton label="Loading standings" />
        )
      ) : (
        <SurvivorBoard view={view} userId={userId} />
      )}
    </LeagueTabScroll>
  );
}

function SurvivorBoard({ view, userId }: { view: SurvivorView; userId: string }) {
  const weeks = gridWeeks(view);
  const winners = view.players.filter((p) => p.winner).map((p) => p.displayName);
  const cancelled = view.weeks.filter((w) => w.cancelled);
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={s.title}>
          Standings
        </Text>
        {view.players.length > 0 && (
          <Text style={[s.text, { fontFamily: fonts.semibold }]}>{aliveCount(view)}</Text>
        )}
      </View>
      {view.over && winners.length > 0 && (
        <Card label="Winner">
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <Icon name="trophy" size={24} color={colors.win} filled />
            <Heading>
              {winners.length > 1 ? `${listNames(winners)} share the title` : `${winners[0]} won the pool`}
            </Heading>
          </View>
        </Card>
      )}
      {view.players.length === 0 ? (
        <Card>
          <Label>
            {view.settings
              ? "The grid fills in as the pool's weeks are played."
              : "There's no pool this season yet."}
          </Label>
        </Card>
      ) : (
        <Grid view={view} weeks={weeks} userId={userId} />
      )}
      {cancelled.map((w) => (
        <Label key={w.id}>
          {weekLabel(w.number)} would have put out everyone still in, so it put out nobody and its strikes
          don't count.
        </Label>
      ))}
    </View>
  );
}

function CellContent({ cell }: { cell: GridCell }) {
  if (cell.kind === "missed") {
    return (
      <Text accessibilityLabel={cell.label} style={[s.muted, { color: colors.destructive }]}>
        No pick
      </Text>
    );
  }
  if (cell.kind === "empty")
    return (
      <Text accessibilityLabel={cell.label} style={s.muted}>
        —
      </Text>
    );
  const struck = cell.outcome === "lost";
  return (
    <View accessible accessibilityLabel={cell.label} style={{ alignItems: "center", gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 3, opacity: struck ? 0.6 : 1 }}>
        <TeamLogo team={cell.team} size={20} />
        {cell.outcome === "won" && <Icon name="check" size={12} color={colors.win} weight="bold" />}
        {cell.outcome === "tie" && <Icon name="equals" size={12} color={colors.destructive} />}
      </View>
      <Text
        style={{
          fontFamily: fonts.semibold,
          fontSize: 12,
          lineHeight: 14,
          color:
            cell.outcome === "won"
              ? colors.win
              : struck || cell.outcome === "tie"
                ? colors.destructive
                : colors.foreground,
          textDecorationLine: struck ? "line-through" : "none",
        }}
      >
        {cell.team}
      </Text>
    </View>
  );
}

function PlayerName({ view, player, mine }: { view: SurvivorView; player: SurvivorPlayer; mine: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flex: 1 }}>
      <Avatar name={player.displayName} size={28} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={[s.text, { fontSize: 14, lineHeight: 18, fontFamily: mine ? fonts.semibold : fonts.medium }]}
        >
          {player.displayName}
          {mine ? " (you)" : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
          {player.winner && <Icon name="trophy" size={12} color={colors.win} filled />}
          {!player.alive && <Icon name="close" size={12} color={colors.destructive} />}
          <Text
            numberOfLines={2}
            style={[
              s.muted,
              {
                fontSize: 12,
                lineHeight: 15,
                flex: 1,
                color: player.alive ? colors.mutedForeground : colors.destructive,
              },
            ]}
          >
            {playerStatus(view, player)}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Grid({ view, weeks, userId }: { view: SurvivorView; weeks: SurvivorWeek[]; userId: string }) {
  const { width } = useWindowDimensions();
  const nameWidth = width < 440 ? 160 : 210;
  const lives = (view.settings?.lives ?? 1) > 1;
  const columns: { key: string; title: string; label: string; cell: (p: SurvivorPlayer) => ReactNode }[] = [
    ...(lives
      ? [
          {
            key: "lives",
            title: "Lives",
            label: "Lives left",
            cell: (p: SurvivorPlayer) => (
              <Text accessibilityLabel={`${p.livesLeft} lives left`} style={[s.text, { fontSize: 14 }]}>
                {p.livesLeft}
              </Text>
            ),
          },
        ]
      : []),
    ...weeks.map((week) => ({
      key: week.id,
      title: weekShort(week.number),
      label: weekLabel(week.number),
      cell: (p: SurvivorPlayer) => <CellContent cell={gridCell(view, p, week)} />,
    })),
  ];
  const header = {
    height: 40,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 6,
  };
  const cell = {
    height: ROW,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  };
  const headerText = [s.muted, { fontSize: 12, fontFamily: fonts.medium }];
  // Takes up the rest of a row wider than its columns, so the row's divider runs to the card's edge.
  const filler = <View aria-hidden style={[cell, { flexGrow: 1, paddingHorizontal: 0 }]} />;
  const label = `Survivor grid: ${view.players.length} players, ${weeks.length} weeks`;
  if (Platform.OS === "web")
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
                style={[
                  header,
                  stickyFirst,
                  { width: nameWidth, alignItems: "flex-start", backgroundColor: colors.card },
                ]}
              >
                <Text style={headerText}>Player</Text>
              </View>
              {columns.map((col) => (
                <View
                  role="columnheader"
                  key={col.key}
                  aria-label={col.label}
                  style={[header, { width: CELL }]}
                >
                  <Text style={headerText}>{col.title}</Text>
                </View>
              ))}
            </View>
            {view.players.map((player) => {
              const mine = player.userId === userId;
              const fill = mine ? colors.raised : colors.card;
              return (
                <View
                  role="row"
                  key={player.userId}
                  {...({ dataSet: { me: mine ? "true" : undefined } } as object)}
                  style={{ flexDirection: "row", backgroundColor: fill }}
                >
                  <View
                    role="rowheader"
                    style={[
                      cell,
                      stickyFirst,
                      { width: nameWidth, alignItems: "stretch", backgroundColor: fill },
                    ]}
                  >
                    <PlayerName view={view} player={player} mine={mine} />
                  </View>
                  {columns.map((col) => (
                    <View role="cell" key={col.key} style={[cell, { width: CELL }]}>
                      {col.cell(player)}
                    </View>
                  ))}
                  {filler}
                </View>
              );
            })}
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
        <View style={[header, { alignItems: "flex-start" }]}>
          <Text style={headerText}>Player</Text>
        </View>
        {view.players.map((player) => (
          <View
            key={player.userId}
            style={[
              cell,
              { alignItems: "stretch" },
              player.userId === userId && { backgroundColor: colors.raised },
            ]}
          >
            <PlayerName view={view} player={player} mine={player.userId === userId} />
          </View>
        ))}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        accessibilityLabel="Weeks, scroll horizontally"
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View style={{ flexGrow: 1 }}>
          <View style={{ flexDirection: "row" }}>
            {columns.map((col) => (
              <View key={col.key} accessibilityLabel={col.label} style={[header, { width: CELL }]}>
                <Text style={headerText}>{col.title}</Text>
              </View>
            ))}
          </View>
          {view.players.map((player) => (
            <View
              key={player.userId}
              style={{
                flexDirection: "row",
                backgroundColor: player.userId === userId ? colors.raised : colors.card,
              }}
            >
              {columns.map((col) => (
                <View key={col.key} style={[cell, { width: CELL }]}>
                  {col.cell(player)}
                </View>
              ))}
              {filler}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
