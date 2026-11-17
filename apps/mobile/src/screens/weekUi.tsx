import type { ReactNode } from "react";
import { Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Icon } from "../components/Icon";
import { colors, fonts } from "../components/ui";

export type WeekTone = "primary" | "win" | "pow" | "loss" | "outline";
const tones = {
  primary: colors.primary,
  win: colors.win,
  pow: colors.pow,
  loss: colors.destructive,
  outline: colors.mutedForeground,
};
export function WeekBadge({
  children,
  tone = "outline",
  icon,
  small = false,
}: {
  children: ReactNode;
  tone?: WeekTone;
  icon?: "lock" | "check" | "equals";
  small?: boolean;
}) {
  return (
    <View
      style={[
        w.badge,
        {
          backgroundColor:
            tone === "outline" ? colors.raised : tone === "pow" ? colors.pow : `${tones[tone]}26`,
        },
        small && w.badgeSmall,
      ]}
    >
      {icon && <Icon name={icon} size={12} color={tones[tone]} weight={icon === "lock" ? "fill" : "bold"} />}
      <Text
        style={[
          w.badgeText,
          { color: tone === "pow" ? colors.powForeground : tones[tone] },
          small && { fontSize: 12, lineHeight: 14 },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}
export function WeekAction({
  label,
  onPress,
  disabled = false,
  secondary = false,
  compact = false,
  style,
  link = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  /** It goes to another screen: announced as a link, as on the web. */
  link?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={link ? "link" : "button"}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        w.action,
        secondary && w.secondary,
        compact && w.compact,
        compact &&
          secondary && { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
        style,
        disabled && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[w.actionText, secondary && { color: colors.foreground }, compact && { fontSize: 14 }]}>
        {label}
      </Text>
    </Pressable>
  );
}
export function WeekCaption({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={w.caption}>
      {children}
    </Text>
  );
}
export function WeekStat({
  label,
  value,
  detail,
  style,
  tone,
  compact = false,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  style?: StyleProp<ViewStyle>;
  tone?: string;
  compact?: boolean;
}) {
  return (
    <View style={[w.stat, style]}>
      <Text style={w.statLabel}>{label}</Text>
      <Text
        style={[w.statValue, compact && { fontSize: 24, lineHeight: 26 }, tone ? { color: tone } : undefined]}
      >
        {value}
      </Text>
      {detail && <Text style={w.muted}>{detail}</Text>}
    </View>
  );
}
export const w = StyleSheet.create({
  stack: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  grow: { flex: 1 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.foreground },
  muted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.mutedForeground },
  small: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.mutedForeground },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: 8 },
  caption: { fontFamily: fonts.semibold, fontSize: 14, color: colors.mutedForeground },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: 10,
    minHeight: 24,
  },
  badgeSmall: { minHeight: 16, paddingVertical: 0, paddingHorizontal: 4 },
  badgeText: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  action: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { backgroundColor: colors.raised },
  compact: { paddingHorizontal: 12 },
  actionText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.primaryForeground },
  stat: { backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: 4 },
  statLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.mutedForeground,
  },
  statValue: {
    fontFamily: fonts.displayBold,
    fontSize: 30,
    lineHeight: 32,
    color: colors.foreground,
    fontVariant: ["tabular-nums"],
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
