// biome-ignore-all lint/correctness/noReactNativeRawText: the texts render inside native Text.
import type { WeekView } from "@picks/shared";
import { Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import { colors, fonts } from "../../components/ui";
import { guillotineLine, type StatusLine } from "./playoffLines";

/**
 * A Guillotine status as a tinted card: in or out, said in words with an icon, never by color alone. The pick
 * sheet's line and the Picks tab's card between rounds both draw it.
 */
export function GuillotineStatusCard({ line }: { line: StatusLine }) {
  const tone = line.out ? colors.destructive : colors.win;
  return (
    <View
      accessibilityLabel="Guillotine status"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: 16,
        padding: 12,
        backgroundColor: line.out ? colors.destructiveTint : colors.winTint,
      }}
    >
      <Icon name={line.out ? "close" : "check-circle"} size={28} color={tone} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20, color: colors.foreground }}>
          {line.title}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.mutedForeground }}>
          {line.detail}
        </Text>
      </View>
    </View>
  );
}

/**
 * A Guillotine round's status line on the pick sheet: whether the player is still in, from their own saved picks
 * (it names their POW once one is saved, and its result as soon as the game ends). See `guillotineLine`.
 */
export function PlayoffStatusLine({ view }: { view: WeekView }) {
  const line = guillotineLine(view);
  return line ? <GuillotineStatusCard line={line} /> : null;
}
