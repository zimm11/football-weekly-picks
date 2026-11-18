import { Children, isValidElement, type ReactNode } from "react";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { mailtoProps } from "../lib/mail";
import { duration, webTransition } from "../lib/motion";
import { AppLink } from "./AppLink";
import { Icon, type IconName } from "./Icon";
import { hoverFill } from "./pressState";
import { colors, corner, fonts, layout, radius, space, type } from "./theme";
import { Card } from "./ui";

/*
 * Settings' rows: a card of whole-row controls, a hairline between each. A row goes to another page (`href`, a
 * real link), writes an email (`mail`), or does something here (`onPress`, a button; with `expanded`, one that
 * opens its own part of the card in place).
 */

/** One card of rows, divided by hairlines. A row's own expanded part sits inside its slot. */
export function SettingsRows({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <Card style={{ gap: 0, paddingVertical: space.xs }}>
      {rows.map((row, index) => (
        <View
          key={row.key ?? index}
          style={index ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
        >
          {row}
        </View>
      ))}
    </Card>
  );
}

export function SettingsRow({
  icon,
  label,
  detail,
  trailing,
  href,
  mail,
  onPress,
  expanded,
  destructive = false,
  accessibilityLabel,
  children,
}: {
  icon?: IconName;
  label: string;
  /** A muted line under the label (the current email address, the support address). */
  detail?: string;
  /** What sits at the row's right, before the chevron (the player's avatar and name). */
  trailing?: ReactNode;
  href?: string;
  mail?: string;
  onPress?: () => void;
  /** An `onPress` row that opens a part of the card under it: its state, and the chevron turns. */
  expanded?: boolean;
  /** Coral ink, for Delete account. No chevron: it asks before anything happens. */
  destructive?: boolean;
  /** The row's accessible name, when it should say more than the label and detail. */
  accessibilityLabel?: string;
  /** The part an `expanded` row opens. */
  children?: ReactNode;
}) {
  const ink = destructive ? colors.destructive : colors.foreground;
  const shared = {
    accessibilityLabel: accessibilityLabel ?? (detail ? `${label}, ${detail}` : undefined),
    style: (state: PressableStateCallbackType) => [
      webTransition(["background-color"]),
      {
        minHeight: 52,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: space.lg,
        marginHorizontal: -space.md,
        paddingHorizontal: space.md,
        paddingVertical: space.md,
        ...corner(radius.md),
        backgroundColor: hoverFill(state),
      },
    ],
  };
  const content = (
    <>
      {icon && (
        <Icon name={icon} size={20} color={destructive ? colors.destructive : colors.mutedForeground} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[type.body, { fontFamily: fonts.medium, color: ink }]}>{label}</Text>
        {detail && (
          <Text numberOfLines={1} style={[type.small, { color: colors.mutedForeground }]}>
            {detail}
          </Text>
        )}
      </View>
      {trailing}
      {expanded !== undefined ? (
        <View
          style={[
            webTransition(["transform"], duration.base),
            { transform: [{ rotate: expanded ? "180deg" : "0deg" }] },
          ]}
        >
          <Icon name="chevron-down" size={16} color={colors.mutedForeground} />
        </View>
      ) : (
        !destructive && <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
      )}
    </>
  );
  const row = href ? (
    <AppLink href={href} {...shared}>
      {content}
    </AppLink>
  ) : mail ? (
    <Pressable accessibilityRole="link" {...mailtoProps(mail)} {...shared}>
      {content}
    </Pressable>
  ) : (
    <Pressable
      accessibilityRole="button"
      {...(expanded !== undefined
        ? // react-native-web reads only the aria-* form.
          { accessibilityState: { expanded }, "aria-expanded": expanded }
        : null)}
      onPress={onPress}
      {...shared}
    >
      {content}
    </Pressable>
  );
  if (!children) return row;
  return (
    <View>
      {row}
      {children}
    </View>
  );
}

/** The part an expanded row opens, under it in the same slot. */
export function SettingsRowPanel({ children }: { children: ReactNode }) {
  return (
    <View style={{ gap: layout.cardGap, paddingTop: space.xs, paddingBottom: space.lg }}>{children}</View>
  );
}
