// biome-ignore-all lint/correctness/noReactNativeRawText: Heading and Label render native Text.
import { type SurvivorView, weekLabel } from "@picks/shared";
import { type ComponentRef, Fragment, type ReactNode, useRef, useState } from "react";
import { Platform, ScrollView, Text, useWindowDimensions, View, type ViewStyle } from "react-native";
import { Avatar } from "../../components/Avatar";
import { Icon } from "../../components/Icon";
import { TeamLogo } from "../../components/TeamLogo";
import { corner, layout, radius, type, widths } from "../../components/theme";
import { colors, fonts } from "../../components/ui";
import {
  aliveCount,
  type GridCell,
  gridCell,
  gridLayout,
  gridWeeks,
  listNames,
  playerStatus,
  type SurvivorPlayer,
  type SurvivorWeek,
  weekShort,
} from "../../lib/survivor";
import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps } from "../leagueTypeScreens";
import { Card, EmptyState, Failure, Heading, Label, s } from "../leagueUi";
import { LivesPips } from "./LivesPips";
import { SurvivorSkeleton, useSurvivor } from "./useSurvivor";

/** The web build's pinned columns (the player, then Lives) stay put while the weeks scroll sideways. */
const sticky = (left: number) => ({ position: "sticky", left, zIndex: 1 }) as unknown as ViewStyle;
/** The web build's scroller snaps to whole week columns, which start just right of the pinned ones. */
const snapScroller = (pinned: number) =>
  Platform.OS === "web"
    ? ({ scrollSnapType: "x mandatory", scrollPaddingLeft: pinned } as unknown as ViewStyle)
    : undefined;
const snapCell = Platform.OS === "web" ? ({ scrollSnapAlign: "start" } as unknown as ViewStyle) : undefined;
const ROW = 60;
/** The out group's label row. */
const GROUP_ROW = 32;
/** The Lives column: up to three pips. */
const LIVES = 72;

/**
 * Starts a sideways scroller at its far end, once per `columns` count: the newest week is the one players
 * come for, and the earlier ones are a swipe back. After that the player's own scrolling is left alone.
 */
function useStartAtEnd(columns: string) {
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const placed = useRef("");
  const onContentSizeChange = () => {
    if (placed.current === columns) return;
    placed.current = columns;
    ref.current?.scrollToEnd({ animated: false });
  };
  return { ref, onContentSizeChange };
}

/**
 * Standings: the survivor grid. Players down the side (alive first, the rest by how long they lasted), weeks
 * across, each cell the team picked once it is revealed, with how it did as an icon and a word, never color alone.
 */
export function SurvivorStandings({ league, year, userId, header, reload }: LeagueTabProps) {
  const survivor = useSurvivor(league.id, year);
  const view = survivor.data;
  return (
    <LeagueTabScroll header={header} reload={() => Promise.all([survivor.refresh(), reload()])}>
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
        <EmptyState
          icon="trophy"
          title={view.settings ? "No standings yet" : "No pool this season"}
          detail={
            view.settings
              ? "The grid fills in as the pool's weeks are played."
              : "There's no pool this season yet."
          }
        />
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
      <Text
        accessibilityLabel={cell.label}
        numberOfLines={1}
        style={[s.muted, { fontSize: 12, lineHeight: 16, color: colors.destructive }]}
      >
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
  // A player who is out steps back: avatar and name faded, the reason in full.
  const faded = !player.alive && { opacity: 0.6 };
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", flex: 1 }}>
      <View style={faded}>
        <Avatar avatarId={player.avatarId} name={player.displayName} size={28} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={[
            s.text,
            { fontSize: 14, lineHeight: 18, fontFamily: mine ? fonts.semibold : fonts.medium },
            faded,
          ]}
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
  const { width: windowWidth } = useWindowDimensions();
  // The card's own width, once laid out (the page's width less its padding until then). Set only when it
  // changes, and nothing inside the card decides it, so this can't loop.
  const [measured, setMeasured] = useState<number | null>(null);
  // A phone keeps as many weeks in view as it can: a narrower player column, and no Lives column (the line
  // under each name already says "Alive · 1 of 2 lives").
  const phone = windowWidth < 560;
  const showLives = !phone && (view.settings?.lives ?? 1) > 1;
  const fixed = showLives ? LIVES : 0;
  const cardWidth = measured ?? Math.min(windowWidth, widths.page) - 2 * layout.pageX;
  // Whole week columns always: the slack goes to the player column, then (wider screens) to the cells.
  const { name: nameWidth, cell: CELL } = gridLayout({
    width: cardWidth,
    weeks: weeks.length,
    name: phone ? 148 : 210,
    fixed,
    maxCell: phone ? 56 : 96,
  });
  const pinned = nameWidth + fixed;
  const columns: { key: string; title: string; label: string; cell: (p: SurvivorPlayer) => ReactNode }[] =
    weeks.map((week) => ({
      key: week.id,
      title: weekShort(week.number),
      label: weekLabel(week.number),
      cell: (p: SurvivorPlayer) => <CellContent cell={gridCell(view, p, week)} />,
    }));
  const lives = view.settings?.lives ?? 1;
  const livesCell = (p: SurvivorPlayer) => <LivesPips left={p.livesLeft} lives={lives} size={14} />;
  const alive = view.players.filter((p) => p.alive);
  const out = view.players.filter((p) => !p.alive);
  // Between the last player still in and the first one out, a row naming the group.
  const groups = [
    { key: "alive", label: null, players: alive },
    { key: "out", label: alive.length && out.length ? `Out (${out.length})` : null, players: out },
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
  const group = {
    height: GROUP_ROW,
    justifyContent: "center" as const,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  };
  // The pinned columns end in a hairline, so they read as a pane the weeks slide under.
  const edge = { borderRightWidth: 1, borderRightColor: colors.border };
  const headerText = [s.muted, { fontSize: 12, fontFamily: fonts.medium }];
  const groupText = [type.caption, { fontFamily: fonts.semibold, color: colors.mutedForeground }];
  // Takes up the rest of a row wider than its columns, so the row's divider runs to the card's edge.
  const filler = <View aria-hidden style={[cell, { flexGrow: 1, paddingHorizontal: 0 }]} />;
  const label = `Survivor grid: ${view.players.length} players, ${weeks.length} weeks`;
  // Opens on the newest weeks; the player column stays pinned as the older ones scroll in.
  const scroller = useStartAtEnd(`${columns.length}:${CELL}`);
  const frame = { ...corner(radius.xl), overflow: "hidden" as const, backgroundColor: colors.card };
  const onLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    const width = Math.round(e.nativeEvent.layout.width);
    if (width !== measured) setMeasured(width);
  };
  if (Platform.OS === "web")
    return (
      <View role="table" aria-label={label} onLayout={onLayout} style={frame}>
        <ScrollView
          ref={scroller.ref}
          onContentSizeChange={scroller.onContentSizeChange}
          horizontal
          showsHorizontalScrollIndicator
          style={snapScroller(pinned)}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <View style={{ flexGrow: 1 }}>
            <View role="row" style={{ flexDirection: "row" }}>
              <View
                role="columnheader"
                style={[
                  header,
                  sticky(0),
                  { width: nameWidth, alignItems: "flex-start", backgroundColor: colors.card },
                  !showLives && edge,
                ]}
              >
                <Text style={headerText}>Player</Text>
              </View>
              {showLives && (
                <View
                  role="columnheader"
                  aria-label="Lives left"
                  style={[header, sticky(nameWidth), { width: fixed, backgroundColor: colors.card }, edge]}
                >
                  <Text style={headerText}>Lives</Text>
                </View>
              )}
              {columns.map((col) => (
                <View
                  role="columnheader"
                  key={col.key}
                  aria-label={col.label}
                  style={[header, snapCell, { width: CELL }]}
                >
                  <Text style={headerText}>{col.title}</Text>
                </View>
              ))}
            </View>
            {groups.map((g) => (
              <Fragment key={g.key}>
                {g.label && (
                  <View role="row" style={{ flexDirection: "row", backgroundColor: colors.card }}>
                    <View
                      role="cell"
                      style={[group, sticky(0), { width: pinned, backgroundColor: colors.card }]}
                    >
                      <Text style={groupText}>{g.label}</Text>
                    </View>
                    <View aria-hidden style={[group, { flexGrow: 1 }]} />
                  </View>
                )}
                {g.players.map((player) => {
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
                          sticky(0),
                          { width: nameWidth, alignItems: "stretch", backgroundColor: fill },
                          !showLives && edge,
                        ]}
                      >
                        <PlayerName view={view} player={player} mine={mine} />
                      </View>
                      {showLives && (
                        <View
                          role="cell"
                          style={[cell, sticky(nameWidth), { width: fixed, backgroundColor: fill }, edge]}
                        >
                          {livesCell(player)}
                        </View>
                      )}
                      {columns.map((col) => (
                        <View role="cell" key={col.key} style={[cell, { width: CELL }]}>
                          {col.cell(player)}
                        </View>
                      ))}
                      {filler}
                    </View>
                  );
                })}
              </Fragment>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  // iPhone: the pinned columns and the weeks are two views side by side, each drawing every row (the group
  // row too), so their rows stay the same height.
  return (
    <View accessibilityLabel={label} onLayout={onLayout} style={[frame, { flexDirection: "row" }]}>
      <View style={[{ width: pinned, zIndex: 1 }, edge]}>
        <View style={{ flexDirection: "row" }}>
          <View style={[header, { width: nameWidth, alignItems: "flex-start" }]}>
            <Text style={headerText}>Player</Text>
          </View>
          {showLives && (
            <View accessibilityLabel="Lives left" style={[header, { width: fixed }]}>
              <Text style={headerText}>Lives</Text>
            </View>
          )}
        </View>
        {groups.map((g) => (
          <Fragment key={g.key}>
            {g.label && (
              <View style={group}>
                <Text style={groupText}>{g.label}</Text>
              </View>
            )}
            {g.players.map((player) => (
              <View
                key={player.userId}
                style={[
                  { flexDirection: "row" },
                  player.userId === userId && { backgroundColor: colors.raised },
                ]}
              >
                <View style={[cell, { width: nameWidth, alignItems: "stretch" }]}>
                  <PlayerName view={view} player={player} mine={player.userId === userId} />
                </View>
                {showLives && <View style={[cell, { width: fixed }]}>{livesCell(player)}</View>}
              </View>
            ))}
          </Fragment>
        ))}
      </View>
      <ScrollView
        ref={scroller.ref}
        onContentSizeChange={scroller.onContentSizeChange}
        horizontal
        showsHorizontalScrollIndicator
        snapToInterval={CELL}
        decelerationRate="fast"
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
          {groups.map((g) => (
            <Fragment key={g.key}>
              {g.label && <View aria-hidden style={group} />}
              {g.players.map((player) => (
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
            </Fragment>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
