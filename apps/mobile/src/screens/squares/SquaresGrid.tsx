import { BOARD_SIZE, type BoardSquare, type BoardView, teamName } from "@picks/shared";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Avatar, avatarColor, avatarInitials } from "../../components/Avatar";
import { TeamLogo } from "../../components/TeamLogo";
import { colors, fonts } from "../../components/ui";
import { cellLabel, digitAt, SHORT_PERIOD, squareKey, winsOf } from "../../lib/squaresBoard";

/** Cells are 44px, the smallest tap target, with a 2px gap. */
export const CELL = 44;
const GAP = 2;
const range = Array.from({ length: BOARD_SIZE }, (_, i) => i);

/**
 * The 10 by 10 board: the home team's numbers across the top, the away team's down the side ("?" until the
 * draw). A cell shows its holder's profile logo or initials (yours in primary); a winning square takes the
 * win fill and its quarter's label, and the square that would win now says "Now", so neither is color alone.
 * On a phone the grid scrolls sideways inside its card while the column of numbers stays put.
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
  const byKey = new Map(squares.map((sq) => [squareKey(sq.row, sq.col), sq]));
  const header = (text: string, label: string) => (
    <View
      accessible
      accessibilityLabel={label}
      style={{ width: CELL, height: CELL, alignItems: "center", justifyContent: "center" }}
    >
      <Text style={{ fontFamily: fonts.displayBold, fontSize: 22, color: colors.foreground }}>{text}</Text>
    </View>
  );
  return (
    <View
      role="region"
      aria-label="Squares board"
      style={{ backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: 8 }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <TeamAxis team={view.awayTeam} direction="Down the side" />
        <TeamAxis team={view.homeTeam} direction="Across the top" />
      </View>
      <View style={{ flexDirection: "row" }}>
        {/* The away team's numbers: pinned while the grid scrolls sideways. */}
        <View style={{ gap: GAP, marginRight: GAP }}>
          <View style={{ width: CELL, height: CELL }} />
          {range.map((row) => (
            <View key={row}>
              {header(
                digitAt(view.awayDigits, row),
                `${teamName(view.awayTeam)} ${digitAt(view.awayDigits, row)}`,
              )}
            </View>
          ))}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          {/* A horizontal ScrollView lays its children in a row: one column holds the number row and the grid. */}
          <View style={{ gap: GAP }}>
            <View style={{ flexDirection: "row", gap: GAP }}>
              {range.map((col) => (
                <View key={col}>
                  {header(
                    digitAt(view.homeDigits, col),
                    `${teamName(view.homeTeam)} ${digitAt(view.homeDigits, col)}`,
                  )}
                </View>
              ))}
            </View>
            {range.map((row) => (
              <View key={row} style={{ flexDirection: "row", gap: GAP }}>
                {range.map((col) => {
                  const square = byKey.get(squareKey(row, col));
                  const wins = winsOf(view.quarters, row, col);
                  const current = view.current?.row === row && view.current.col === col;
                  const mine = !!square && square.userId === userId;
                  const fill = wins.length
                    ? colors.win
                    : mine
                      ? colors.primary
                      : square
                        ? avatarColor(square.name)
                        : current
                          ? colors.winTint
                          : colors.raised;
                  const ink = wins.length || mine ? colors.primaryForeground : colors.avatarForeground;
                  const off = disabled?.(row, col, square) ?? false;
                  return (
                    <Pressable
                      key={col}
                      accessibilityRole="button"
                      accessibilityLabel={cellLabel({ view, row, col, square, userId, wins, current })}
                      accessibilityState={{ disabled: off, selected: mine }}
                      disabled={off}
                      onPress={() => onPress(row, col, square)}
                      style={({ pressed }) => ({
                        width: CELL,
                        height: CELL,
                        borderRadius: 8,
                        backgroundColor: fill,
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: pressed ? 0.7 : 1,
                        // The square that would win now: a ring as well as its "Now" label.
                        borderWidth: current ? 2 : 0,
                        borderColor: colors.win,
                      })}
                    >
                      {square?.avatarId ? (
                        <Avatar name={square.name} avatarId={square.avatarId} size={24} />
                      ) : (
                        square && (
                          <Text
                            numberOfLines={1}
                            style={{
                              fontFamily: fonts.semibold,
                              fontSize: 13,
                              lineHeight: 15,
                              color: square || wins.length ? ink : colors.mutedForeground,
                            }}
                          >
                            {avatarInitials(square.name)}
                          </Text>
                        )
                      )}
                      {wins.length > 0 && (
                        <Text
                          numberOfLines={1}
                          style={{ fontFamily: fonts.semibold, fontSize: 11, lineHeight: 13, color: ink }}
                        >
                          {wins.length > 1 ? `${wins.length}×` : SHORT_PERIOD[wins[0] ?? "q1"]}
                        </Text>
                      )}
                      {current && !wins.length && (
                        <Text
                          style={{
                            fontFamily: fonts.semibold,
                            fontSize: 11,
                            lineHeight: 13,
                            color: square ? ink : colors.win,
                          }}
                        >
                          Now
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

function TeamAxis({ team, direction }: { team: string; direction: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <TeamLogo team={team} size={20} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.mutedForeground }}>
        {direction}:{" "}
        <Text style={{ fontFamily: fonts.displayBold, fontSize: 18, color: colors.foreground }}>
          {teamName(team).toUpperCase()}
        </Text>
      </Text>
    </View>
  );
}

/** A placeholder shaped like the board while it loads. */
export function BoardSkeleton() {
  return (
    <View
      accessible
      accessibilityLabel="Loading board"
      accessibilityState={{ busy: true }}
      style={{ gap: 16 }}
    >
      <View style={{ width: 220, height: 30, borderRadius: 6, backgroundColor: colors.raised }} />
      <View
        style={{ backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: GAP, overflow: "hidden" }}
      >
        {[...range, BOARD_SIZE].map((row) => (
          <View key={row} style={{ flexDirection: "row", gap: GAP }}>
            {[...range, BOARD_SIZE].map((col) => (
              <View
                key={col}
                style={{
                  width: CELL,
                  height: CELL,
                  borderRadius: 8,
                  backgroundColor: row === 0 || col === 0 ? "transparent" : colors.raised,
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}
