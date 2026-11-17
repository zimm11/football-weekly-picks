// biome-ignore-all lint/correctness/noReactNativeRawText: the texts render inside native Text.
import { SUPER_BOWL_ROUND, type WeekView, weekLabel } from "@picks/shared";
import { Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import { colors, fonts } from "../../components/ui";

/**
 * A Guillotine round's status line on the pick sheet: whether the player is still in, from their own picks (their
 * POW result shows as soon as its game ends). Out is said in words with an icon, never by color alone.
 */
export function PlayoffStatusLine({ view }: { view: WeekView }) {
  const playoff = view.playoff;
  if (playoff?.format !== "guillotine" || !playoff.me) return null;
  const { me, mayPick } = playoff;
  const superBowl = view.number === SUPER_BOWL_ROUND;
  const out = me.state === "out" && me.outIn !== null;
  const title = !out
    ? "You're in"
    : mayPick
      ? `You're out after the ${weekLabel(me.outIn ?? view.number)} round`
      : "You're out of picking";
  const how =
    me.reason === "pow_lost"
      ? `your POW lost in the ${weekLabel(me.outIn ?? view.number)} round`
      : `you had no POW in the ${weekLabel(me.outIn ?? view.number)} round`;
  const detail = !out
    ? superBowl
      ? "No POW in the Super Bowl: nobody goes out now. Your pick and your total guess decide the rest."
      : "Choose a POW: if it loses, or you skip it, you're out from the next round."
    : mayPick
      ? `${how[0]?.toUpperCase()}${how.slice(1)}. Finish this round's picks: they still count.`
      : `${how[0]?.toUpperCase()}${how.slice(1)}. You keep your points and your place, and you can still guess the Super Bowl's total.`;
  const tone = out ? colors.destructive : colors.win;
  const tint = out ? colors.destructiveTint : colors.winTint;
  return (
    <View
      accessibilityLabel="Guillotine status"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: 16,
        padding: 12,
        backgroundColor: tint,
      }}
    >
      <Icon name={out ? "close" : "check-circle"} size={28} color={tone} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20, color: colors.foreground }}>
          {title}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.mutedForeground }}>
          {detail}
        </Text>
      </View>
    </View>
  );
}
