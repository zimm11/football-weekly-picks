import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, Text, type ViewStyle } from "react-native";
import type { LinkHow } from "../components/AppLink";
import { corner, elevation, layout, radius, type } from "../components/theme";
import { Badge, Button, colors, fonts } from "../components/ui";
import { StatTile } from "./leagueUi";

export type WeekTone = "primary" | "win" | "pow" | "loss" | "outline";
/**
 * The app's `Badge` (components/ui.tsx) with the week screens' tones. `outline`, the default, is the quiet
 * `raised` pill (the badge's `muted`).
 */
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
    <Badge tone={tone === "outline" ? "muted" : tone} icon={icon} small={small}>
      {children}
    </Badge>
  );
}
/** The app's `Button` (components/ui.tsx) with the week screens' props: `secondary` is the quiet raised one. */
export function WeekAction({
  label,
  onPress,
  disabled = false,
  secondary = false,
  compact = false,
  style,
  link = false,
  busy = false,
  href,
  how,
}: {
  label: string;
  /** Optional with `href`, where it replaces the default navigation. */
  onPress?: () => void;
  disabled?: boolean;
  /**
   * Its own request is running: it looks disabled and ignores presses, but stays a keyboard stop so the
   * focus isn't dropped to the page. Use it rather than `disabled` for "Saving…".
   */
  busy?: boolean;
  secondary?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  /** It goes to another screen: announced as a link, as on the web. */
  link?: boolean;
  /**
   * An in-app path: the button is a real link (`AppLink`: an `<a href>` on the web, so Enter and new-tab
   * clicks work), opened through the unsaved-work guard. `how` is push (default), replace or dismissTo.
   */
  href?: string;
  how?: LinkHow;
}) {
  return (
    <Button
      title={label}
      onPress={onPress}
      disabled={disabled}
      busy={busy}
      secondary={secondary}
      small={compact}
      style={style}
      link={link}
      href={href}
      how={how}
    />
  );
}
export function WeekCaption({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={w.caption}>
      {children}
    </Text>
  );
}
/** The league screens' `StatTile`, sized by its `style` rather than filling its share of the row. */
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
    <StatTile
      label={label}
      value={value}
      detail={detail}
      tone={tone}
      compact={compact}
      grow={false}
      style={style}
    />
  );
}
export const w = StyleSheet.create({
  stack: { gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  grow: { flex: 1 },
  body: { ...type.body, color: colors.foreground },
  muted: { ...type.small, color: colors.mutedForeground },
  small: { ...type.caption, color: colors.mutedForeground },
  card: {
    backgroundColor: colors.card,
    ...corner(radius.xl),
    padding: layout.cardPad,
    gap: layout.cardGap,
    boxShadow: elevation.cardEdge,
  },
  caption: { ...type.small, fontFamily: fonts.semibold, color: colors.mutedForeground },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
