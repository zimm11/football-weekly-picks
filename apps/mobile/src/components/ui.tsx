import { type ComponentRef, type ReactNode, type Ref, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type PressableStateCallbackType,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { fieldDefaults } from "../lib/fieldProps";
import { webTransition } from "../lib/motion";
import { useScrollRestore } from "../lib/scrollRestore";
import { AppLink, type LinkHow } from "./AppLink";
import { BottomSheet } from "./BottomSheet";
import { Icon, type IconName } from "./Icon";
import {
  atRest,
  busyOpacity,
  busyProps,
  disabledOpacity,
  hoverFill,
  pressFade,
  pressState,
} from "./pressState";
import { colors, corner, elevation, fonts, layout, radius, space, tabular, type, widths } from "./theme";

export { colors, fonts } from "./theme";
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: layout.pageX,
    paddingTop: layout.pageTop,
    gap: layout.pageGap,
    paddingBottom: layout.pageBottom,
    width: "100%",
    maxWidth: widths.page,
    alignSelf: "center",
  },
  card: {
    backgroundColor: colors.card,
    ...corner(radius.xl),
    padding: layout.cardPad,
    gap: layout.cardGap,
    boxShadow: elevation.cardEdge,
  },
  title: { ...type.title, color: colors.foreground },
  body: { ...type.body, color: colors.foreground },
  muted: { color: colors.mutedForeground },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    // 9 + 24 + 9 and the two 1px borders: 44.
    paddingVertical: 9,
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.input,
    color: colors.foreground,
    ...type.body,
  },
  button: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.md,
    backgroundColor: colors.primary,
  },
  buttonText: { ...type.body, fontFamily: fonts.semibold, color: colors.primaryForeground },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  error: { ...type.small, color: colors.destructive, fontFamily: fonts.medium },
  skeleton: { height: 20, borderRadius: radius.sm, backgroundColor: colors.raised },
  label: { ...type.small, fontFamily: fonts.medium, color: colors.mutedForeground },
});
export function Screen({
  children,
  narrow = false,
  contentStyle,
}: {
  children: ReactNode;
  narrow?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  // In a browser, Back and Forward return to where the page was scrolled (lib/scrollRestore).
  const scrollRef = useScrollRestore();
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        // A focused field stays above the iPhone keyboard, and dragging the page puts the keyboard away.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        contentContainerStyle={[styles.content, narrow && { maxWidth: widths.form }, contentStyle]}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}
/**
 * A page title. `level` is its place in the page's outline for screen readers (1 the page, 2 a section,
 * 3 a part of one); it doesn't change how the title looks. `size` does: `hero` (48), `title` (36, the
 * default), `heading` (24) or `subheading` (20), each with its own line height and tracking.
 */
export function Title({
  children,
  style,
  level = 1,
  size = "title",
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  level?: 1 | 2 | 3 | 4;
  size?: "hero" | "title" | "heading" | "subheading";
}) {
  return (
    <Text
      accessibilityRole="header"
      aria-level={level}
      style={[styles.title, size !== "title" && type[size], style]}
    >
      {children}
    </Text>
  );
}
/**
 * A card's title: Barlow in sentence case (`type.cardTitle`), announced as a heading. `level` is its place in
 * the page's outline (2 by default: a card under the page's title; 3 for a card inside a section).
 */
export function CardTitle({
  children,
  level = 2,
  style,
}: {
  children: ReactNode;
  level?: 1 | 2 | 3 | 4;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text
      accessibilityRole="header"
      aria-level={level}
      style={[type.cardTitle, { color: colors.foreground }, style]}
    >
      {children}
    </Text>
  );
}
export function Body({
  children,
  muted = false,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.body, muted && styles.muted, style]}>{children}</Text>;
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text style={[type.small, { fontFamily: fonts.semibold, color: colors.mutedForeground }]}>
      {children}
    </Text>
  );
}
const ignore = () => {};
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "link" | "destructive";
/**
 * The app's one button (`Action` and `WeekAction` in the screens draw this one too).
 *
 * - `primary`: the screen's main action, a solid blue fill.
 * - `secondary` (and its old name `outline`): the quiet filled button, `raised` with `raisedHover` under the
 *   mouse. Surfaces, not outlines: no border.
 * - `ghost`: no fill until the mouse or a finger is on it. `link`: underlined primary text.
 * - `destructive`: a coral tint with a coral label, for removals.
 *
 * Disabled, it fades (`disabledOpacity`); a disabled primary instead turns `raised` with a muted label, so it
 * reads as switched off rather than as a dull blue slab. Busy (`busy`), it fades less (`busyOpacity`) and shows
 * a spinner before the caller's label ("Saving…").
 */
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  destructive = false,
  variant,
  icon,
  iconAfter,
  style,
  small = false,
  fit = false,
  link = false,
  busy = false,
  href,
  how,
  accessibilityLabel,
  labelTone,
}: {
  /** The label: text, or text runs that a `Text` can hold. */
  title: ReactNode;
  /** Optional with `href`, where it replaces the default navigation. */
  onPress?: () => void;
  disabled?: boolean;
  /**
   * Its own request is running: it looks disabled and ignores presses, but stays a keyboard stop so the
   * focus isn't dropped to the page. Use it rather than `disabled` for "Saving…".
   */
  busy?: boolean;
  secondary?: boolean;
  destructive?: boolean;
  variant?: ButtonVariant;
  /** An icon before the label. */
  icon?: IconName;
  /** An icon after the label ("Next →"). */
  iconAfter?: IconName;
  style?: StyleProp<ViewStyle>;
  /** 14px text and tighter sides. */
  small?: boolean;
  /** As wide as its content (`alignSelf: "flex-start"`) instead of the row's width. */
  fit?: boolean;
  /** It goes to another screen: announced as a link, as on the web. */
  link?: boolean;
  /**
   * An in-app path: the button is a real link (`AppLink`: an `<a href>` on the web, so Enter and new-tab
   * clicks work), opened through the unsaved-work guard. `how` is push (default), replace or dismissTo.
   */
  href?: string;
  how?: LinkHow;
  /** The accessible name, when it should say more than the label. */
  accessibilityLabel?: string;
  /** A quiet button's label (and icon) in muted or coral ink instead of the foreground. */
  labelTone?: "muted" | "destructive";
}) {
  const chosen = variant ?? (destructive ? "destructive" : secondary ? "secondary" : "primary");
  const kind = chosen === "outline" ? "secondary" : chosen;
  // A disabled primary is drawn switched off: the raised fill and a muted label, at full opacity.
  const off = kind === "primary" && disabled && !busy;
  const tint = off
    ? colors.mutedForeground
    : kind === "primary"
      ? colors.primaryForeground
      : kind === "destructive"
        ? colors.destructive
        : labelTone === "muted"
          ? colors.mutedForeground
          : labelTone === "destructive"
            ? colors.destructive
            : kind === "link"
              ? colors.primary
              : colors.foreground;
  const shared = {
    accessibilityLabel,
    ...busyProps(disabled, busy, Platform.OS === "web"),
    style: (state: PressableStateCallbackType) => {
      const live = busy || disabled ? atRest : pressState(state);
      const { pressed, hovered } = live;
      return [
        webTransition(["background-color", "border-color", "opacity", "transform", "box-shadow"]),
        styles.button,
        small && { paddingHorizontal: 12 },
        fit && { alignSelf: "flex-start" as const },
        kind === "secondary" && { backgroundColor: hovered ? colors.raisedHover : colors.raised },
        // A stronger coral tint under the mouse.
        kind === "destructive" && {
          backgroundColor: hovered ? `${colors.destructive}2e` : colors.destructiveTint,
        },
        (kind === "ghost" || kind === "link") && { backgroundColor: "transparent" },
        kind === "ghost" && !busy && !disabled && { backgroundColor: hoverFill(state) },
        off && { backgroundColor: colors.raised },
        // A solid fill (or a link) lightens under the mouse and more while pressed; a raised or tinted one
        // has already changed its fill on hover, so it only fades while pressed.
        (kind === "primary" || kind === "link") && !busy && !disabled && pressFade(state),
        (kind === "secondary" || kind === "destructive") && pressed && pressFade(state),
        disabled && !busy && !off && { opacity: disabledOpacity },
        busy && ({ opacity: busyOpacity, cursor: "auto" } as const),
        style,
      ];
    },
  };
  const iconSize = small ? 16 : 20;
  const content = (
    <>
      {busy && (
        // Decorative: the label already says what is happening ("Saving…").
        <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ActivityIndicator size="small" color={tint} />
        </View>
      )}
      {icon && <Icon name={icon} size={iconSize} color={tint} weight="bold" />}
      <Text
        style={[
          styles.buttonText,
          small && type.small,
          small && { fontFamily: fonts.semibold },
          { color: tint },
          kind === "link" && { textDecorationLine: "underline" },
        ]}
      >
        {title}
      </Text>
      {iconAfter && <Icon name={iconAfter} size={iconSize} color={tint} weight="bold" />}
    </>
  );
  if (href !== undefined)
    return (
      <AppLink href={href} how={how} onPress={busy ? ignore : onPress} {...shared}>
        {content}
      </AppLink>
    );
  return (
    <Pressable accessibilityRole={link ? "link" : "button"} onPress={busy ? ignore : onPress} {...shared}>
      {content}
    </Pressable>
  );
}
/**
 * A labelled text field. Beyond `TextInput`'s props:
 *
 * - `onSubmit` runs when the player presses Enter (or the keyboard's return key) in a single-line field:
 *   pass the form's submit, or focus the next field (`enterKeyHint="next"` with `ref` on the next one).
 *   The return key says "done" unless `enterKeyHint`/`returnKeyType` says otherwise.
 * - `ref` reaches the `TextInput` (`ref.current?.focus()`).
 * - A `secureTextEntry` field turns off capitalization, autocorrect and spell-check by itself.
 * - `hint` is one muted line under the field.
 * - `reveal`, on a `secureTextEntry` field, adds a "Show password" / "Hide password" eye at its right edge.
 */
/** Read by screen readers but not drawn (the same rule as `srOnly` in `screens/SeasonDashboard.tsx`). */
const visuallyHidden = { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 } as const;
export function Field({
  label,
  onSubmit,
  ref,
  hint,
  reveal = false,
  ...props
}: Omit<TextInputProps, "ref"> & {
  label: string;
  onSubmit?: () => void;
  ref?: Ref<ComponentRef<typeof TextInput>>;
  hint?: string;
  reveal?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  const revealable = reveal && !!props.secureTextEntry;
  const web = Platform.OS === "web";
  const eyeName = shown ? "Hide password" : "Show password";
  const input = (
    <TextInput
      ref={ref}
      accessibilityLabel={label}
      accessibilityHint={hint}
      placeholderTextColor={colors.mutedForeground}
      selectionColor={colors.primary}
      onSubmitEditing={onSubmit && !props.multiline ? () => onSubmit() : undefined}
      {...fieldDefaults({ submits: !!onSubmit, ...props }, Platform.OS === "web")}
      {...props}
      secureTextEntry={props.secureTextEntry && !(revealable && shown)}
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      style={[
        webTransition(["border-color"]),
        styles.input,
        revealable && { paddingRight: 44 },
        focused && { borderColor: colors.primary },
        props.editable === false && { opacity: 0.7 },
        props.style,
      ]}
    />
  );
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.label}>{label}</Text>
      {revealable ? (
        <View>
          {input}
          <Pressable
            accessibilityRole="button"
            // On the web the eye is named by its hidden text, not `aria-label`: a label would make a search for
            // the field by its label ("Password") find the eye too. iPhone has no such search: a label there.
            {...(web ? null : { accessibilityLabel: eyeName })}
            onPress={() => setShown(!shown)}
            style={(state) => [
              webTransition(["background-color"]),
              {
                position: "absolute",
                top: 0,
                right: 0,
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.md,
                backgroundColor: hoverFill(state),
              },
            ]}
          >
            <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Icon name={shown ? "eye-slash" : "eye"} size={20} color={colors.mutedForeground} />
            </View>
            {web && <Text style={visuallyHidden}>{eyeName}</Text>}
          </Pressable>
        </View>
      ) : (
        input
      )}
      {hint && <Text style={[type.caption, { color: colors.mutedForeground }]}>{hint}</Text>}
    </View>
  );
}
export function Notice({ message, kind = "status" }: { message?: string; kind?: "status" | "alert" }) {
  if (!message) return null;
  const tint = kind === "alert" ? colors.destructive : colors.win;
  return (
    <View
      role={kind === "alert" ? "alert" : "status"}
      accessibilityLiveRegion="polite"
      style={{ flexDirection: "row", gap: space.sm, alignItems: "flex-start" }}
    >
      {/* 2px down, so the 16px icon sits on the first line's 20px. */}
      <View style={{ marginTop: 2 }}>
        <Icon name={kind === "alert" ? "warning" : "check-circle"} weight="fill" color={tint} size={16} />
      </View>
      <Text style={[type.small, { fontFamily: fonts.medium, color: tint, flex: 1 }]}>{message}</Text>
    </View>
  );
}
/**
 * Something failed ("This didn't load"): a coral warning icon, the message, and **Try again** when `onRetry`
 * is given. The same drawing as `Failure` in the league screens.
 *
 * `announce` is what screen readers hear as the alert: the message alone (default), or the whole block with
 * its button (`Failure`).
 */
export function ErrorMessage({
  message,
  onRetry,
  announce = "message",
}: {
  message?: string;
  onRetry?: () => void;
  announce?: "message" | "block";
}) {
  if (!message) return null;
  const alert = { role: "alert" as const, accessibilityLiveRegion: "polite" as const };
  return (
    <View
      {...(announce === "block" ? { accessibilityRole: "alert" as const } : null)}
      style={{ gap: space.lg }}
    >
      <View
        {...(announce === "message" ? alert : null)}
        style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}
      >
        {/* 2px down, so the 20px icon sits on the first line's 24px. */}
        <View style={{ marginTop: 2 }}>
          <Icon name="warning" weight="fill" size={20} color={colors.destructive} />
        </View>
        <Text style={[styles.body, { flex: 1 }]}>{message}</Text>
      </View>
      {onRetry && <Button title="Try again" onPress={onRetry} secondary small fit icon="refresh" />}
    </View>
  );
}
export type BadgeTone = "muted" | "primary" | "win" | "loss" | "warning" | "pow" | "outline";
const badgeTones: Record<BadgeTone, { fill: string; ink: string; border?: string }> = {
  muted: { fill: colors.raised, ink: colors.mutedForeground },
  // `primaryText`: plain primary on its own tint falls under 4.5:1.
  primary: { fill: colors.primaryTint, ink: colors.primaryText },
  win: { fill: colors.winTint, ink: colors.win },
  loss: { fill: colors.destructiveTint, ink: colors.destructive },
  warning: { fill: colors.destructiveTint, ink: colors.destructive },
  // `powFill`: white on plain `pow` is only 3.45:1.
  pow: { fill: colors.powFill, ink: colors.powForeground },
  outline: { fill: "transparent", ink: colors.mutedForeground, border: colors.border },
};
/**
 * A pill holding a word or a score ("Open", "Final 13–17", "Won +8"): 12px semibold with tabular figures.
 * `icon` sits before the text; `small` is the tight chip beside a team name; `inline` centers it in a row
 * instead of sitting at the top. `Pill` and `WeekBadge` in the screens are this badge.
 */
export function Badge({
  children,
  tone = "muted",
  icon,
  small = false,
  inline = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: IconName;
  small?: boolean;
  inline?: boolean;
}) {
  const { fill, ink, border } = badgeTones[tone];
  return (
    <View
      style={[
        {
          alignSelf: inline ? "center" : "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          minHeight: 24,
          paddingHorizontal: 10,
          paddingVertical: space.xs,
          borderRadius: radius.full,
          backgroundColor: fill,
        },
        border ? { borderWidth: 1, borderColor: border, paddingVertical: 3 } : undefined,
        small && { minHeight: 16, paddingVertical: 0, paddingHorizontal: space.xs },
      ]}
    >
      {icon && <Icon name={icon} size={12} color={ink} weight={icon === "lock" ? "fill" : "bold"} />}
      <Text
        style={[
          type.caption,
          tabular,
          { fontFamily: fonts.semibold, color: ink },
          small && { lineHeight: 14 },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}
/**
 * A bottom sheet over the current screen (`BottomSheet`). The ✕ is named "Close <title>"; a tap outside,
 * Escape and the phone's back button close it too.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} closeLabel={`Close ${title}`}>
      {children}
    </BottomSheet>
  );
}
