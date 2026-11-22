import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, space, tabular, type } from "./theme";

/**
 * "Live" on a game being played: a small green dot and the word in a muted pill, the size of a small `Badge`.
 * Deliberately not a green pill, which is a won pick's ("Won +8"), and never red, which is the POW's alone. It
 * says nothing to screen readers by itself: the row or line it sits in names the game as live in words.
 */
export function LiveMark() {
  return (
    <View aria-hidden style={s.mark}>
      <View style={s.dot} />
      <Text style={s.word}>Live</Text>
    </View>
  );
}

const s = StyleSheet.create({
  // A small inline `Badge`'s box.
  mark: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    minHeight: 16,
    paddingHorizontal: space.xs,
    borderRadius: radius.full,
    backgroundColor: colors.raised,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.win },
  word: { ...type.caption, ...tabular, fontFamily: fonts.semibold, lineHeight: 14, color: colors.foreground },
});
