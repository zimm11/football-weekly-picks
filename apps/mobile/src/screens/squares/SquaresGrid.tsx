import { BOARD_SIZE, type BoardSquare, type BoardView, type SquarePeriod, teamName } from "@picks/shared";
import { useRef, useState } from "react";
import { type LayoutChangeEvent, Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { Avatar, avatarColor, avatarInitials } from "../../components/Avatar";
import { pressState } from "../../components/pressState";
import { TeamLogo } from "../../components/TeamLogo";
import { colors, fonts } from "../../components/ui";
import {
  cellLabel,
  digitAt,
  GRID_GAP,
  gridLayout,
  gridMove,
  SHORT_PERIOD,
  squareKey,
  winsOf,
} from "../../lib/squaresBoard";

const range = Array.from({ length: BOARD_SIZE }, (_, i) => i);
/** The page's side padding (`s.content`), which the card gives up on a phone to run edge to edge. */
const GUTTER = 16;
/** The widest the page's content gets (`s.content`). */
const PAGE_WIDTH = 896;

type GridLayout = ReturnType<typeof gridLayout>;

/**
 * The grid's measurements for the width it has: the page's content width, measured (`onLayout` goes on a
 * full-width wrapper), and until then worked out from the window so the first paint is already the right size.
 */
function useGridLayout() {
  const window = useWindowDimensions().width;
  const [measured, setMeasured] = useState<number>();
  const layout = gridLayout(measured ?? Math.min(window, PAGE_WIDTH) - 2 * GUTTER, GUTTER);
  const onLayout = (event: LayoutChangeEvent) => {
    const width = Math.round(event.nativeEvent.layout.width);
    if (width > 0) setMeasured(width);
  };
  return { layout, onLayout };
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
 * team's up the left side ("?" until the draw). A cell shows its holder's profile logo or initials (yours in
 * primary); a winning square takes the win fill and its quarter's label (with a primary ring when it is yours),
 * a square that hit with nobody on it is only tinted and outlined, and the square that would win now says "Now"
 * with its two numbers picked out on the edges, so none of them is color alone.
 *
 * The whole board always fits the width (`gridLayout`): edge to edge with small cells on a phone, 43px cells and
 * up from 560px, centered in its card. In a browser the grid is one tab stop: the arrow keys, Home and End move
 * between squares, and Enter or Space presses one.
 */
export function SquaresGrid({
  view,
  squares,
  userId,
  onPress,
  disabled,
}: {
  view: BoardView;
  /** The squares to show: the saved ones with any unanswered claims laid over them. */
  squares: BoardSquare[];
  userId: string;
  onPress: (row: number, col: number, square: BoardSquare | undefined) => void;
  disabled?: (row: number, col: number, square: BoardSquare | undefined) => boolean;
}) {
  const { layout, onLayout } = useGridLayout();
  const { cell, axis, side, span } = layout;
  const web = Platform.OS === "web";
  // The one square the Tab key lands on; the arrow keys move it.
  const [active, setActive] = useState({ row: 0, col: 0 });
  const cells = useRef(new Map<string, { focus?: () => void }>());
  const byKey = new Map(squares.map((sq) => [squareKey(sq.row, sq.col), sq]));
  const open = view.phase === "open";

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
                        claimable={open && !square && !off}
                        disabled={off}
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
  claimable,
  disabled,
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
  /** An open square on an open board: it lifts under the mouse, since it is there to be claimed. */
  claimable: boolean;
  disabled: boolean;
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
  const fill = won
    ? colors.win
    : mine
      ? colors.primary
      : square
        ? avatarColor(square.name)
        : emptyHit || current
          ? colors.winTint
          : colors.raised;
  const ink = won || mine ? colors.primaryForeground : colors.avatarForeground;
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
      style={(state) => {
        const { pressed, hovered } = pressState(state);
        return {
          width: cell,
          height: cell,
          borderRadius: cell >= 40 ? 8 : 6,
          backgroundColor: claimable && hovered ? colors.raisedHover : fill,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          opacity: pressed ? 0.7 : hovered && !claimable ? 0.9 : 1,
          borderWidth: ring,
          borderColor: won && mine ? colors.primary : colors.win,
          borderStyle: emptyHit && !current ? "dashed" : "solid",
        };
      }}
    >
      {showMark &&
        square &&
        (square.avatarId ? (
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
        ))}
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

/** A placeholder shaped like the board while it loads: the same card, with the cells where they will be. */
export function BoardSkeleton() {
  const { layout, onLayout } = useGridLayout();
  return (
    <View
      accessible
      accessibilityLabel="Loading board"
      accessibilityState={{ busy: true }}
      onLayout={onLayout}
      style={{ gap: 16 }}
    >
      <View style={{ width: 220, height: 30, borderRadius: 6, backgroundColor: colors.raised }} />
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
                <View
                  key={col}
                  style={{
                    width: layout.cell,
                    height: layout.cell,
                    borderRadius: layout.cell >= 40 ? 8 : 6,
                    backgroundColor: colors.raised,
                  }}
                />
              ))}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
