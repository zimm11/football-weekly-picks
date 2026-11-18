import { type ComponentRef, type ReactNode, type Ref, useState } from "react";
import {
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
import { useScrollRestore } from "../lib/scrollRestore";
import { AppLink, type LinkHow } from "./AppLink";
import { BottomSheet } from "./BottomSheet";
import { Icon, type IconName } from "./Icon";
import { atRest, busyProps, pressState } from "./pressState";
import { colors, fonts } from "./theme";

export { colors, fonts } from "./theme";
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 20,
    paddingBottom: 32,
    width: "100%",
    maxWidth: 896,
    alignSelf: "center",
  },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 16, borderCurve: "continuous" },
  title: {
    fontFamily: fonts.displayExtraBold,
    fontSize: 36,
    lineHeight: 36,
    letterSpacing: 0.9,
    color: colors.foreground,
    textTransform: "uppercase",
  },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.foreground },
  muted: { color: colors.mutedForeground },
  input: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: `${colors.background}99`,
    borderWidth: 1,
    borderColor: colors.input,
    color: colors.foreground,
    fontFamily: fonts.body,
    fontSize: 16,
  },
  button: {
    minHeight: 44,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: "transparent",
  },
  buttonText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.primaryForeground },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  error: { color: colors.destructive, fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  skeleton: { height: 20, borderRadius: 6, backgroundColor: colors.raised },
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
        contentContainerStyle={[styles.content, narrow && { maxWidth: 512 }, contentStyle]}
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
 * 3 a part of one); it doesn't change how the title looks.
 */
export function Title({
  children,
  style,
  level = 1,
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  level?: 1 | 2 | 3 | 4;
}) {
  return (
    <Text accessibilityRole="header" aria-level={level} style={[styles.title, style]}>
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
    <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.mutedForeground }}>
      {children}
    </Text>
  );
}
const ignore = () => {};
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  destructive = false,
  variant,
  icon,
  style,
  small = false,
  link = false,
  busy = false,
  href,
  how,
}: {
  title: string;
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
  variant?: "primary" | "secondary" | "outline" | "ghost" | "link" | "destructive";
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  /** It goes to another screen: announced as a link, as on the web. */
  link?: boolean;
  /**
   * An in-app path: the button is a real link (`AppLink`: an `<a href>` on the web, so Enter and new-tab
   * clicks work), opened through the unsaved-work guard. `how` is push (default), replace or dismissTo.
   */
  href?: string;
  how?: LinkHow;
}) {
  const kind = variant ?? (destructive ? "destructive" : secondary ? "secondary" : "primary");
  const off = disabled || busy;
  const tint =
    kind === "primary"
      ? colors.primaryForeground
      : kind === "destructive"
        ? colors.destructive
        : kind === "link"
          ? colors.primary
          : colors.foreground;
  const shared = {
    ...busyProps(disabled, busy, Platform.OS === "web"),
    style: (state: PressableStateCallbackType) => {
      const { pressed, hovered } = busy ? atRest : pressState(state);
      return [
        styles.button,
        kind !== "primary" && {
          backgroundColor:
            kind === "secondary"
              ? hovered
                ? colors.raisedHover
                : colors.raised
              : kind === "destructive"
                ? hovered
                  ? `${colors.destructive}2e`
                  : colors.destructiveTint
                : hovered && kind !== "link"
                  ? colors.raised
                  : "transparent",
        },
        kind === "outline" && { borderColor: colors.input },
        kind === "destructive" && { borderColor: `${colors.destructive}66` },
        small && { paddingHorizontal: 12 },
        off && { opacity: 0.45 },
        busy && { cursor: "auto" },
        hovered && (kind === "primary" || kind === "link") && { opacity: 0.9 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
        style,
      ];
    },
  };
  const content = (
    <>
      {icon && <Icon name={icon} size={small ? 16 : 20} color={tint} />}
      <Text
        style={[
          styles.buttonText,
          { color: tint, fontSize: small ? 14 : 16 },
          kind === "link" && { textDecorationLine: "underline" },
        ]}
      >
        {title}
      </Text>
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
 */
export function Field({
  label,
  onSubmit,
  ref,
  ...props
}: Omit<TextInputProps, "ref"> & {
  label: string;
  onSubmit?: () => void;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.mutedForeground }}>{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        onSubmitEditing={onSubmit && !props.multiline ? () => onSubmit() : undefined}
        {...fieldDefaults({ submits: !!onSubmit, ...props }, Platform.OS === "web")}
        {...props}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        style={[
          styles.input,
          focused && { borderColor: colors.primary },
          props.editable === false && { opacity: 0.7 },
          props.style,
        ]}
      />
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
      style={{ flexDirection: "row", gap: 6, alignItems: "flex-start" }}
    >
      <Icon name={kind === "alert" ? "warning" : "check-circle"} weight="regular" color={tint} size={16} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, lineHeight: 20, color: tint, flex: 1 }}>
        {message}
      </Text>
    </View>
  );
}
export function ErrorMessage({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return message ? (
    <View style={{ gap: 12 }}>
      <Notice message={message} kind="alert" />
      {onRetry && <Button title="Try again" onPress={onRetry} variant="outline" icon="refresh" />}
    </View>
  ) : null;
}
export function Loading({ label = "Loading POW Pick’em" }: { label?: string }) {
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={[styles.content, { gap: 16 }]}>
      {[0, 1, 2].map((n) => (
        <View key={n} style={styles.card}>
          <View style={[styles.skeleton, { width: "60%" }]} />
          <View style={[styles.skeleton, { height: 64 }]} />
        </View>
      ))}
    </View>
  );
}
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "win" | "pow" | "outline";
}) {
  const tint =
    tone === "primary"
      ? colors.primary
      : tone === "win"
        ? colors.win
        : tone === "pow"
          ? colors.pow
          : colors.mutedForeground;
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 9,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: tone === "outline" ? "transparent" : tone === "muted" ? colors.raised : `${tint}1f`,
        borderWidth: tone === "outline" ? 1 : 0,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, color: tint }}>{children}</Text>
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
