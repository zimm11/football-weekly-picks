import { BOARD_SIZE, type BoardSquare, type BoardView, type SquarePeriod, teamName } from "@picks/shared";
import { type ReactNode, useRef, useState } from "react";
import {
  Animated,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Avatar, avatarColor, avatarInitials } from "../../components/Avatar";
import { pressTile } from "../../components/pressState";
import { SkeletonBlock } from "../../components/SkeletonBlock";
import { TeamLogo } from "../../components/TeamLogo";
import { layout as pageLayout, radius, space, widths } from "../../components/theme";
import { colors, fonts } from "../../components/ui";
import { usePop, webTransition } from "../../lib/motion";
import {
  cellLabel,
  digitAt,
  GRID_GAP,
  gridLayout,
  gridMove,
  holderKey,
  SHORT_PERIOD,
  squareKey,
  squareTone,
  winsOf,
} from "../../lib/squaresBoard";
import { s } from "../leagueUi";

const range = Array.from({ length: BOARD_SIZE }, (_, i) => i);
/** The page's side padding (`s.content`), which the card gives up on a phone to run edge to edge. */
const GUTTER = pageLayout.pageX;
/** The widest the page's content gets (`s.content`). */
const PAGE_WIDTH = widths.page;

/** From this window width the board sits beside a rail of its details (`useBoardColumns`). */
const SIDE_BY_SIDE = 1024;
/** The rail's narrowest, and the gap between it and the grid's card. */
export const RAIL_WIDTH = 232;
export const RAIL_GAP = space.xl;
/** The web's app header (`AppHeader`: a 56px bar and its hairline), above the page's scroll view. */
const APP_HEADER = 57;
/** Where the board's row starts in the page until it has been laid out: under the league's header and tabs. */
const ROW_TOP_GUESS = 176;
/** The room kept under the grid's card at the window's bottom. */
const BOTTOM_MARGIN = space.xl;

/** How much a holder's squares step back while another player's are picked out in the Players card. */
const DIMMED = 0.35;

type GridLayout = ReturnType<typeof gridLayout>;
/** The room the grid has beside the rail: the width for it, and the height from its card's top to the window's bottom. */
export type GridFit = { width: number; maxHeight: number };

/**
 * A board screen's columns. Under 1024px the board is one column; from 1024px (`wide`) the grid sits on the
 * left, sized to fit both the width left beside a `RAIL_WIDTH` rail and the window's height, so the whole board
 * is in view (`fit`). `onLayout` goes on the row: its top in the page only moves with what is above it (the
 * league's header), never with the grid's size, so measuring it can't loop.
 */
export function useBoardColumns() {
  const { width, height } = useWindowDimensions();
  const [top, setTop] = useState<number>();
  const wide = width >= SIDE_BY_SIDE;
  const content = Math.min(width, PAGE_WIDTH) - 2 * GUTTER;
  const fit: GridFit | undefined = wide
    ? {
        width: content - RAIL_WIDTH - RAIL_GAP,
        maxHeight: height - APP_HEADER - (top ?? ROW_TOP_GUESS) - BOTTOM_MARGIN,
      }
    : undefined;
  const onLayout = (event: LayoutChangeEvent) => {
    const y = Math.round(event.nativeEvent.layout.y);
    setTop((was) => (was === y ? was : y));
  };
  // The grid's card, as wide as the grid and its padding: the left column's width, so a line under it wraps.
  const grid = fit && gridLayout(fit.width, GUTTER, fit.maxHeight);
  return { wide, fit, onLayout, gridWidth: grid ? grid.width + 2 * grid.padding : undefined };
}

/**
 * The grid's measurements for the width it has: beside the rail, the `fit` it is given; otherwise the page's
 * content width, measured (`onLayout` goes on a full-width wrapper), and until then worked out from the window
 * so the first paint is already the right size.
 */
function useGridLayout(fit?: GridFit) {
  const window = useWindowDimensions().width;
  const [measured, setMeasured] = useState<number>();
  const layout = fit
    ? gridLayout(fit.width, GUTTER, fit.maxHeight)
    : gridLayout(measured ?? Math.min(window, PAGE_WIDTH) - 2 * GUTTER, GUTTER);
  const onLayout = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0) setMeasured(width);
  };
  return { layout, onLayout: fit ? undefined : onLayout };
}

/** The board's card: edge to edge on a phone, a rounded card from 560px, the board centered in it. */
const cardStyle = (layout: GridLayout) =>
  ({
    backgroundColor: colors.card,
    borderRadius: layout.bleed ? 0 : 16,
    marginHorizontal: layout.bleed ? -GUTTER : 0,
    paddingHorizontal: layout.padding,
    paddingVertical: layout.bleed ? 10 : 16,
    alignItems: "center",
  }) as const;

/** The height of the home team's name above the grid, and the space under it. */
const nameRow = (layout: GridLayout) => ({ height: layout.side + 4, marginBottom: layout.bleed ? 2 : 6 });

/** What a key press on the web hands us: the key, and a way to keep the page from scrolling with the arrows. */
type GridKeyEvent = { nativeEvent: { key?: string }; preventDefault?: () => void };

/**
 * The 10 by 10 board, laid out as a paper one is: the home team's name and numbers across the top, the away
 * team's up the left side ("?" until the draw). A cell shows its holder's profile logo or initials: yours on a
 * solid primary fill, everyone else's on a tint of their avatar color (`squareTone`), so only yours and the
 * winners are solid. A winning square takes the win fill and its quarter's label (with a primary ring when it is yours),
 * a square that hit with nobody on it is only tinted and outlined, and the square that would win now says "Now"
 * with its two numbers picked out on the edges, so none of them is color alone.
 *
 * The whole board always fits the width (`gridLayout`): edge to edge with small cells on a phone, 43px cells and
 * up from 560px, centered in its card; beside the rail (`fit`), the window's height too. `highlight` picks out
 * one holder's squares (the Players card's toggle) by dimming the rest; it changes nothing a tap does. In a browser the grid is one tab stop: the arrow keys, Home and End move
 * between squares, and Enter or Space presses one.
 */
export function SquaresGrid({
  view,
  squares,
  userId,
  onPress,
  disabled,
  highlight,
  fit,
  badge,
}: {
  view: BoardView;
  /** The squares to show: the saved ones with any unanswered claims laid over them. */
  squares: BoardSquare[];
  userId: string;
  onPress: (row: number, col: number, square: BoardSquare | undefined) => void;
  disabled?: (row: number, col: number, square: BoardSquare | undefined) => boolean;
  /** One holder (`holderKey`) whose squares are picked out: every other square steps back. */
  highlight?: string | null;
  /** Beside the rail on a wide screen: the room the grid fits (`useBoardColumns`). */
  fit?: GridFit;
  /** A note at the top of the card, over the board (the guest a commissioner is claiming for). */
  badge?: ReactNode;
}) {
  const { layout, onLayout } = useGridLayout(fit);
  const { cell, axis, side, span } = layout;
  const web = Platform.OS === "web";
  // The one square the Tab key lands on; the arrow keys move it.
  const [active, setActive] = useState({ row: 0, col: 0 });
  const cells = useRef(new Map<string, { focus?: () => void }>());
  const byKey = new Map(squares.map((sq) => [squareKey(sq.row, sq.col), sq]));

  function onKeyDown(event: GridKeyEvent) {
    const next = gridMove(event.nativeEvent.key ?? "", active.row, active.col);
    if (!next) return;
    event.preventDefault?.();
    setActive(next);
    cells.current.get(squareKey(next.row, next.col))?.focus?.();
  }
  return (
    <View onLayout={onLayout}>
      <View role="region" aria-label="Squares board" style={cardStyle(layout)}>
        {badge && <View style={{ alignSelf: "center", marginBottom: space.md }}>{badge}</View>}
        <View style={{ width: layout.width }}>
          {/* The home team's name, centered over the ten columns. */}
          <View
            style={[
              nameRow(layout),
              { marginLeft: side + axis + GRID_GAP, alignItems: "center", justifyContent: "center" },
            ]}
          >
            <TeamAxis team={view.homeTeam} direction="Across the top" layout={layout} />
          </View>
          <View style={{ flexDirection: "row" }}>
            {/*
              The away team's name, turned to read up the side and centered on the ten rows. The turned box is
              as long as the rows are tall and placed so its center is the column's center.
            */}
            <View style={{ width: side, height: span, marginTop: cell + GRID_GAP }}>
              <View
                style={{
                  position: "absolute",
                  width: span,
                  height: side,
                  left: (side - span) / 2,
                  top: (span - side) / 2,
                  alignItems: "center",
                  justifyContent: "center",
                  transform: [{ rotate: "-90deg" }],
                }}
              >
                <TeamAxis team={view.awayTeam} direction="Down the side" layout={layout} turned />
              </View>
            </View>
            <View style={{ gap: GRID_GAP }} {...(web ? ({ onKeyDown } as object) : null)}>
              <View style={{ flexDirection: "row", gap: GRID_GAP }}>
                <View style={{ width: axis, height: cell }} />
                {range.map((col) => (
                  <Digit
                    key={col}
                    digit={digitAt(view.homeDigits, col)}
                    team={view.homeTeam}
                    width={cell}
                    layout={layout}
                    now={view.current?.col === col}
                  />
                ))}
              </View>
              {range.map((row) => (
                <View key={row} style={{ flexDirection: "row", gap: GRID_GAP }}>
                  <Digit
                    digit={digitAt(view.awayDigits, row)}
                    team={view.awayTeam}
                    width={axis}
                    layout={layout}
                    now={view.current?.row === row}
                  />
                  {range.map((col) => {
                    const key = squareKey(row, col);
                    const square = byKey.get(key);
                    const wins = winsOf(view.quarters, row, col);
                    const current = view.current?.row === row && view.current.col === col;
                    const off = disabled?.(row, col, square) ?? false;
                    return (
                      <Cell
                        key={col}
                        nodeRef={(node) => {
                          if (node) cells.current.set(key, node);
                          else cells.current.delete(key);
                        }}
                        layout={layout}
                        square={square}
                        mine={!!square && square.userId === userId}
                        wins={wins}
                        current={current}
                        disabled={off}
                        dimmed={!!highlight && (!square || holderKey(square) !== highlight)}
                        label={cellLabel({ view, row, col, square, userId, wins, current })}
                        onPress={() => onPress(row, col, square)}
                        onFocus={() => setActive({ row, col })}
                        tabStop={active.row === row && active.col === col}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * One row's or column's number. The two numbers of the square that would win now are picked out in the win
 * color, so the eye finds the square from the edges; "?" before the draw is quiet.
 */
function Digit({
  digit,
  team,
  width,
  layout,
  now,
}: {
  digit: string;
  team: string;
  width: number;
  layout: GridLayout;
  now: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${teamName(team)} ${digit}${now ? ", the score now" : ""}`}
      style={{
        width,
        height: layout.cell,
        borderRadius: layout.cell >= 40 ? 8 : 6,
        backgroundColor: now ? colors.winTint : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontFamily: fonts.displayBold,
          fontSize: layout.digitSize,
          color: now ? colors.win : digit === "?" ? colors.mutedForeground : colors.foreground,
          // Twenty of them before the draw: they mark where the numbers will go, quieter than any square.
          opacity: digit === "?" ? 0.6 : 1,
        }}
      >
        {digit}
      </Text>
    </View>
  );
}

/** One square: its holder's mark, and what it has won or would win now. */
function Cell({
  nodeRef,
  layout,
  square,
  mine,
  wins,
  current,
  disabled,
  dimmed,
  label,
  onPress,
  onFocus,
  tabStop,
}: {
  nodeRef: (node: { focus?: () => void } | null) => void;
  layout: GridLayout;
  square: BoardSquare | undefined;
  mine: boolean;
  wins: SquarePeriod[];
  current: boolean;
  disabled: boolean;
  /** Another holder's squares are picked out (the Players card): this one steps back. */
  dimmed: boolean;
  label: string;
  onPress: () => void;
  onFocus: () => void;
  /** The grid's one keyboard stop in a browser. */
  tabStop: boolean;
}) {
  const { cell } = layout;
  // A quarter landed here: a win only when somebody holds the square.
  const won = !!square && wins.length > 0;
  const emptyHit = !square && wins.length > 0;
  const tone = square ? squareTone({ mine, won, name: square.name }, avatarColor) : undefined;
  const fill = tone?.fill ?? (emptyHit || current ? colors.winTint : colors.raised);
  const ink = tone?.ink ?? colors.foreground;
  // A square claimed while the board is on screen: its mark springs in. One already held when the grid
  // appeared stays still, so a loaded board doesn't animate a hundred cells.
  const scale = usePop(!!square);
  const period = wins.length > 1 ? `${wins.length}×` : wins[0] ? SHORT_PERIOD[wins[0]] : null;
  // A square that has won a quarter and would win again now says both, in place of its holder's mark.
  const both = !!period && current;
  const text = both ? `${period}\nNow` : current ? "Now" : period;
  // A cell too small for two lines keeps the label: it is what says "won" without color.
  const showMark = !!square && !both && (layout.twoLines || !text);
  // Your own winning square keeps a ring in your color; the square that would win now has a ring as well as
  // its "Now"; a hit on nobody's square is an outline, not a fill. Two lines of label leave a small cell no
  // room for a thick ring.
  const ring = won && mine ? (both && cell < 32 ? 1 : 3) : current && !won ? 2 : emptyHit ? 1 : 0;
  return (
    <Pressable
      ref={(node) => nodeRef(node as unknown as { focus?: () => void } | null)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: mine }}
      disabled={disabled}
      onPress={onPress}
      onFocus={onFocus}
      {...(Platform.OS === "web" ? { tabIndex: tabStop ? 0 : -1 } : null)}
      style={(state) => [
        {
          width: cell,
          height: cell,
          borderRadius: cell >= 40 ? 8 : 6,
          backgroundColor: fill,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          borderWidth: ring,
          borderColor: won && mine ? colors.primary : colors.win,
          borderStyle: emptyHit && !current ? "dashed" : "solid",
        } as const,
        webTransition(["opacity", "background-color", "transform"]),
        // An open square is there to be claimed: it lifts to the hover fill. A filled one fades a touch.
        pressTile(state, fill !== colors.raised),
        dimmed && { opacity: DIMMED },
      ]}
    >
      {showMark && square && (
        <Animated.View style={{ transform: [{ scale }] }}>
          {square.avatarId ? (
            <Avatar
              name={square.name}
              avatarId={square.avatarId}
              size={text ? layout.avatarSizeLabelled : layout.avatarSize}
            />
          ) : (
            <Text
              numberOfLines={1}
              style={{
                fontFamily: fonts.semibold,
                fontSize: layout.initialsSize,
                lineHeight: layout.initialsSize + 2,
                color: ink,
              }}
            >
              {avatarInitials(square.name)}
            </Text>
          )}
        </Animated.View>
      )}
      {text && (
        <Text
          numberOfLines={both ? 2 : 1}
          style={{
            fontFamily: fonts.semibold,
            fontSize: layout.labelSize,
            lineHeight: layout.labelSize + (both ? 1 : 2),
            textAlign: "center",
            color: square ? ink : colors.win,
          }}
        >
          {text}
        </Text>
      )}
    </Pressable>
  );
}

/**
 * A team's name on its edge of the board, with its badge. The away team's is `turned` with its box to read up
 * the side; its badge is turned back, so the drawing stays upright.
 */
function TeamAxis({
  team,
  direction,
  layout,
  turned,
}: {
  team: string;
  direction: string;
  layout: GridLayout;
  turned?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${direction}: ${teamName(team)}`}
      style={{ flexDirection: "row", alignItems: "center", gap: layout.bleed ? 5 : 8, maxWidth: layout.span }}
    >
      <View style={turned && { transform: [{ rotate: "90deg" }] }}>
        <TeamLogo team={team} size={layout.side - 2} />
      </View>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.displayBold,
          fontSize: layout.nameSize,
          lineHeight: layout.side,
          letterSpacing: 0.6,
          color: colors.foreground,
          flexShrink: 1,
        }}
      >
        {teamName(team).toUpperCase()}
      </Text>
    </View>
  );
}

/**
 * A placeholder shaped like the board while it loads: the same card, with the cells where they will be, under
 * the heading on a phone and beside the rail from 1024px, as the board itself is laid out.
 */
export function BoardSkeleton() {
  const columns = useBoardColumns();
  const { layout, onLayout } = useGridLayout(columns.fit);
  const heading = (
    <View style={{ gap: space.md }}>
      <SkeletonBlock width={64} height={24} radius={radius.full} />
      <SkeletonBlock width={columns.wide ? "90%" : 220} height={30} />
      {columns.wide && <SkeletonBlock width="60%" height={16} />}
    </View>
  );
  const grid = (
    <View style={[cardStyle(layout), { overflow: "hidden" }]}>
      <View
        style={{
          width: layout.width,
          paddingLeft: layout.side + layout.axis + GRID_GAP,
          paddingTop: nameRow(layout).height + nameRow(layout).marginBottom + layout.cell + GRID_GAP,
          gap: GRID_GAP,
        }}
      >
        {range.map((row) => (
          <View key={row} style={{ flexDirection: "row", gap: GRID_GAP }}>
            {range.map((col) => (
              <SkeletonBlock
                key={col}
                width={layout.cell}
                height={layout.cell}
                radius={layout.cell >= 40 ? 8 : 6}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
  return (
    <View
      accessible
      accessibilityLabel="Loading board"
      accessibilityState={{ busy: true }}
      onLayout={columns.wide ? columns.onLayout : onLayout}
      style={
        columns.wide ? { flexDirection: "row", alignItems: "flex-start", gap: RAIL_GAP } : { gap: space.xl }
      }
    >
      {columns.wide ? (
        <>
          <View style={{ flexShrink: 0 }}>{grid}</View>
          <View style={{ flex: 1, minWidth: RAIL_WIDTH, gap: space.lg }}>
            {heading}
            <View style={[s.card, { height: 96 }]} />
            <View style={[s.card, { height: 120 }]} />
          </View>
        </>
      ) : (
        <>
          {heading}
          {grid}
        </>
      )}
    </View>
  );
}
