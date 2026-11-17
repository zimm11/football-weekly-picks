import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./Icon";
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
  return (
    <SafeAreaView edges={["bottom"]} style={styles.screen}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
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
export function Title({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text accessibilityRole="header" style={[styles.title, style]}>
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
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  destructive?: boolean;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "link" | "destructive";
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  /** It goes to another screen: announced as a link, as on the web. */
  link?: boolean;
}) {
  const kind = variant ?? (destructive ? "destructive" : secondary ? "secondary" : "primary");
  const tint =
    kind === "primary"
      ? colors.primaryForeground
      : kind === "destructive"
        ? colors.destructive
        : kind === "link"
          ? colors.primary
          : colors.foreground;
  return (
    <Pressable
      accessibilityRole={link ? "link" : "button"}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind !== "primary" && {
          backgroundColor:
            kind === "secondary"
              ? colors.raised
              : kind === "destructive"
                ? colors.destructiveTint
                : "transparent",
        },
        kind === "outline" && { borderColor: colors.input },
        kind === "destructive" && { borderColor: `${colors.destructive}66` },
        small && { paddingHorizontal: 12 },
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.8, transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
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
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.mutedForeground }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        {...props}
        style={[styles.input, props.editable === false && { opacity: 0.7 }, props.style]}
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
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay }}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          onPress={onClose}
        />
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: "90%",
            width: "100%",
            maxWidth: 672,
            alignSelf: "center",
            backgroundColor: colors.card,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingBottom: Math.max(insets.bottom, 16),
          }}
        >
          <View
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.mutedForeground,
              opacity: 0.4,
              alignSelf: "center",
              marginTop: 10,
            }}
          />
          <View
            style={{
              paddingHorizontal: 20,
              paddingTop: 8,
              paddingBottom: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{
                fontFamily: fonts.displayBold,
                fontSize: 24,
                color: colors.foreground,
                flex: 1,
                textTransform: "uppercase",
              }}
            >
              {title}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              onPress={onClose}
              style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
            >
              <Icon name="close" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, gap: 16, paddingBottom: 16 }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
