import { BOARD_SIZE, type BoardSquare, type BoardView, teamName } from "@picks/shared";
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

/** What a key press on the web hands us: the key, and a way to keep the page from scrolling with the arrows. */
type GridKeyEvent = { nativeEvent: { key?: string }; preventDefault?: () => void };

/**
 * The 10 by 10 board: the home team's numbers across the top, the away team's down the side ("?" until the
 * draw). A cell shows its holder's profile logo or initials (yours in primary); a winning square takes the
 * win fill and its quarter's label (with a primary ring when it is yours), a square that hit with nobody on it
 * is only tinted and outlined, and the square that would win now says "Now", so none of them is color alone.
 *
 * The whole board always fits the width (`gridLayout`): edge to edge with small cells on a phone, 44px cells and
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
  const { cell, axis } = layout;
  const web = Platform.OS === "web";
  // The one square the Tab key lands on; the arrow keys move it.
  const [active, setActive] = useState({ row: 0, col: 0 });
  const cells = useRef(new Map<string, { focus?: () => void }>());
  const byKey = new Map(squares.map((sq) => [squareKey(sq.row, sq.col), sq]));
  const open = view.phase === "open";
  const radius = cell >= 40 ? 8 : 6;

  function onKeyDown(event: GridKeyEvent) {
    const next = gridMove(event.nativeEvent.key ?? "", active.row, active.col);
    if (!next) return;
    event.preventDefault?.();
    setActive(next);
    cells.current.get(squareKey(next.row, next.col))?.focus?.();
  }
  const header = (text: string, label: string, width: number) => (
    <View
      accessible
      accessibilityLabel={label}
      style={{ width, height: cell, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ fontFamily: fonts.displayBold, fontSize: layout.digitSize, color: colors.foreground }}>
        {text}
      </Text>
    </View>
  );
  return (
    <View onLayout={onLayout}>
      <View
        role="region"
        aria-label="Squares board"
        style={{
          backgroundColor: colors.card,
          borderRadius: layout.bleed ? 0 : 16,
          marginHorizontal: layout.bleed ? -GUTTER : 0,
          paddingHorizontal: layout.padding,
          paddingVertical: layout.bleed ? 10 : 12,
          alignItems: "center",
        }}
      >
        <View style={{ width: layout.width, gap: layout.bleed ? 6 : 10 }}>
          <View
            style={{ flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "space-between" }}
          >
            <TeamAxis
              team={view.awayTeam}
              direction="Down the side"
              short={layout.bleed ? "Down" : undefined}
              compact={cell < 30}
            />
            <TeamAxis
              team={view.homeTeam}
              direction="Across the top"
              short={layout.bleed ? "Across" : undefined}
              compact={cell < 30}
            />
          </View>
          <View style={{ gap: GRID_GAP }} {...(web ? ({ onKeyDown } as object) : null)}>
            <View style={{ flexDirection: "row", gap: GRID_GAP }}>
              <View style={{ width: axis, height: cell }} />
              {range.map((col) => (
                <View key={col}>
                  {header(
                    digitAt(view.homeDigits, col),
                    `${teamName(view.homeTeam)} ${digitAt(view.homeDigits, col)}`,
                    cell,
                  )}
                </View>
              ))}
            </View>
            {range.map((row) => (
              <View key={row} style={{ flexDirection: "row", gap: GRID_GAP }}>
                {header(
                  digitAt(view.awayDigits, row),
                  `${teamName(view.awayTeam)} ${digitAt(view.awayDigits, row)}`,
                  axis,
                )}
                {range.map((col) => {
                  const key = squareKey(row, col);
                  const square = byKey.get(key);
                  const wins = winsOf(view.quarters, row, col);
                  const current = view.current?.row === row && view.current.col === col;
                  const mine = !!square && square.userId === userId;
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
                  const off = disabled?.(row, col, square) ?? false;
                  const label = wins.length
                    ? wins.length > 1
                      ? `${wins.length}×`
                      : SHORT_PERIOD[wins[0] ?? "q1"]
                    : current
                      ? "Now"
                      : null;
                  // A cell too small for two lines keeps the label: it is what says "won" without color.
                  const showMark = !!square && (layout.twoLines || !label);
                  const focusable = active.row === row && active.col === col;
                  return (
                    <Pressable
                      key={col}
                      ref={(node) => {
                        if (node) cells.current.set(key, node as unknown as { focus?: () => void });
                        else cells.current.delete(key);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={cellLabel({ view, row, col, square, userId, wins, current })}
                      accessibilityState={{ disabled: off, selected: mine }}
                      disabled={off}
                      onPress={() => onPress(row, col, square)}
                      onFocus={() => setActive({ row, col })}
                      {...(web ? { tabIndex: focusable ? 0 : -1 } : null)}
                      style={(state) => {
                        const { pressed, hovered } = pressState(state);
                        // An open square on an open board lifts under the mouse: it is there to be claimed.
                        const claimable = open && !square && !off;
                        return {
                          width: cell,
                          height: cell,
                          borderRadius: radius,
                          backgroundColor: claimable && hovered ? colors.raisedHover : fill,
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          opacity: pressed ? 0.7 : hovered && !claimable ? 0.9 : 1,
                          // Your own winning square keeps a ring in your color; the square that would win now
                          // has a ring as well as its "Now"; a hit on nobody's square is an outline, not a fill.
                          borderWidth: won && mine ? 3 : current && !won ? 2 : emptyHit ? 1 : 0,
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
                            size={label ? layout.avatarSizeLabelled : layout.avatarSize}
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
                      {label && (
                        <Text
                          numberOfLines={1}
                          style={{
                            fontFamily: fonts.semibold,
                            fontSize: layout.labelSize,
                            lineHeight: layout.labelSize + 2,
                            color: square ? ink : colors.win,
                          }}
                        >
                          {label}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * Which team's numbers run which way. A phone gets the short word, and the narrowest phones smaller type
 * (`compact`), so both teams fit on one line even when they are the Buccaneers and the Commanders.
 */
function TeamAxis({
  team,
  direction,
  short,
  compact,
}: {
  team: string;
  direction: string;
  short?: string;
  compact?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${direction}: ${teamName(team)}`}
      style={{ flexDirection: "row", alignItems: "center", gap: compact ? 4 : 6, flexShrink: 1, minWidth: 0 }}
    >
      <TeamLogo team={team} size={compact ? 16 : 20} />
      <Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.medium,
          fontSize: compact ? 12 : 14,
          color: colors.mutedForeground,
          flexShrink: 1,
        }}
      >
        {short ?? direction}:{" "}
        <Text
          style={{ fontFamily: fonts.displayBold, fontSize: compact ? 15 : 18, color: colors.foreground }}
        >
          {teamName(team).toUpperCase()}
        </Text>
      </Text>
    </View>
  );
}

/** A placeholder shaped like the board while it loads. */
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
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: layout.bleed ? 0 : 16,
          marginHorizontal: layout.bleed ? -GUTTER : 0,
          paddingHorizontal: layout.padding,
          paddingVertical: layout.bleed ? 10 : 12,
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <View style={{ width: layout.width, gap: GRID_GAP }}>
          {[...range, BOARD_SIZE].map((row) => (
            <View key={row} style={{ flexDirection: "row", gap: GRID_GAP }}>
              {[...range, BOARD_SIZE].map((col) => (
                <View
                  key={col}
                  style={{
                    width: col === 0 ? layout.axis : layout.cell,
                    height: layout.cell,
                    borderRadius: 6,
                    backgroundColor: row === 0 || col === 0 ? "transparent" : colors.raised,
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
