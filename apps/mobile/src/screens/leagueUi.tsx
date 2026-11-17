// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading, Eyebrow, Pill and Label render children inside native Text.
import { router, useFocusEffect } from "expo-router";
import {
  type ComponentProps,
  type ComponentRef,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../components/Icon";
import { Menu, MenuItem, useAnchor } from "../components/Popover";
import { colors, fonts } from "../components/ui";
import { WebSelect } from "../components/WebSelect";
import { showConfirm } from "../lib/dialogs";
import { confirmDiscard, hasUnsavedWork, useRemovalGuard, useUnsavedWork } from "../lib/unsaved";

export { colors };
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: 16,
    paddingTop: 20,
    gap: 24,
    paddingBottom: 36,
    width: "100%",
    maxWidth: 896,
    alignSelf: "center",
  },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 12 },
  row: { flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" },
  text: { color: colors.foreground, fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  muted: { color: colors.mutedForeground, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  title: {
    color: colors.foreground,
    fontFamily: fonts.displayExtraBold,
    fontSize: 36,
    letterSpacing: 0.9,
    lineHeight: 36,
    textTransform: "uppercase",
  },
  subtitle: {
    color: colors.foreground,
    fontFamily: fonts.displayBold,
    fontSize: 24,
    letterSpacing: 0.6,
    lineHeight: 28,
    textTransform: "uppercase",
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondary: { backgroundColor: colors.raised },
  buttonText: { color: colors.foreground, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 24 },
  input: {
    backgroundColor: `${colors.background}99`,
    borderWidth: 1,
    borderColor: colors.input,
    borderRadius: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: 24,
    color: colors.foreground,
    fontFamily: fonts.body,
  },
  grow: { flex: 1 },
  divider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  cell: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 10 },
});
/** A `label` makes the card a named region for screen readers. */
export function Card({ children, style, label }: { children: ReactNode; style?: ViewStyle; label?: string }) {
  return (
    <View role={label ? "region" : undefined} aria-label={label} style={[s.card, style]}>
      {children}
    </View>
  );
}
export function Label({ children }: { children: ReactNode }) {
  return <Text style={s.muted}>{children}</Text>;
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={[s.muted, { fontFamily: fonts.semibold }]}>{children}</Text>;
}
export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={s.subtitle}>
      {children}
    </Text>
  );
}
export function Pill({
  children,
  tone = "muted",
  inline = false,
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "win" | "pow" | "warning";
  inline?: boolean;
}) {
  const ink =
    tone === "primary"
      ? colors.primary
      : tone === "win"
        ? colors.win
        : tone === "pow"
          ? colors.powForeground
          : tone === "warning"
            ? colors.destructive
            : colors.mutedForeground;
  return (
    <View
      style={{
        alignSelf: inline ? "center" : "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: 100,
        backgroundColor:
          tone === "pow"
            ? colors.pow
            : tone === "primary"
              ? `${colors.primary}20`
              : tone === "win"
                ? `${colors.win}18`
                : colors.raised,
      }}
    >
      <Text style={{ fontFamily: fonts.semibold, color: ink, fontSize: 12, lineHeight: 18 }}>{children}</Text>
    </View>
  );
}
export function Action({
  children,
  onPress,
  disabled,
  secondary,
  danger,
  label,
  icon,
  ghost,
  muted,
  compact,
  style,
  link,
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
  label?: string;
  icon?: ComponentProps<typeof Icon>["name"];
  ghost?: boolean;
  /** Muted text, as web's quiet ghost buttons ("Make a new link"). */
  muted?: boolean;
  compact?: boolean;
  style?: ViewStyle;
  /** It goes to another screen: announced as a link, as on the web. */
  link?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={link ? "link" : "button"}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        ghost && { backgroundColor: "transparent" },
        compact && { alignSelf: "flex-start", paddingHorizontal: 12 },
        disabled && { opacity: 0.45 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {icon && (
        <Icon
          name={icon}
          size={18}
          color={danger ? colors.destructive : muted ? colors.mutedForeground : colors.foreground}
        />
      )}
      <Text
        style={[
          s.buttonText,
          { color: secondary || ghost ? colors.foreground : colors.primaryForeground },
          compact && { fontSize: 14 },
          muted && { color: colors.mutedForeground },
          danger && { color: colors.destructive },
        ]}
      >
        {children}
      </Text>
    </Pressable>
  );
}
export function IconButton({
  name,
  label,
  onPress,
  disabled,
  ref,
}: {
  name: ComponentProps<typeof Icon>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** For a menu to anchor to (see `useAnchor`). */
  ref?: Ref<ComponentRef<typeof View>>;
}) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      style={({ pressed }) => ({
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 100,
        backgroundColor: pressed ? colors.raised : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon name={name} size={24} color={colors.mutedForeground} />
    </Pressable>
  );
}
export function RowLink({
  children,
  onPress,
  label,
  style,
}: {
  children: ReactNode;
  onPress: () => void;
  label?: string;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: pressed ? colors.raised : colors.card,
          borderRadius: 16,
          minHeight: 64,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
        },
        style,
      ]}
    >
      {children}
      <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}
export function Input({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text
        style={[
          s.text,
          { fontSize: 14, lineHeight: 20, fontFamily: fonts.medium, color: colors.mutedForeground },
        ]}
      >
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.mutedForeground}
        selectionColor={colors.primary}
        {...props}
        style={[s.input, props.style]}
      />
    </View>
  );
}
export function Failure({ message, retry }: { message?: string; retry?: () => void }) {
  return message ? (
    <View accessibilityRole="alert" style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
        <Icon name="warning" size={20} color={colors.destructive} />
        <Text style={[s.text, { color: colors.destructive, flex: 1 }]}>{message}</Text>
      </View>
      {retry && (
        <Action secondary compact onPress={retry} icon="refresh">
          Try again
        </Action>
      )}
    </View>
  ) : null;
}
export function Skeleton({ label = "Loading league" }: { label?: string }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }} style={s.content}>
      <View style={{ width: 190, height: 30, borderRadius: 6, backgroundColor: colors.raised }} />
      {[0, 1, 2].map((n) => (
        <View key={n} style={[s.card, { height: n === 0 ? 64 : 120 }]} />
      ))}
    </View>
  );
}
export function Sheet({
  title,
  children,
  visible = true,
  close,
  closeButton = true,
}: {
  title: string;
  children: ReactNode;
  visible?: boolean;
  close: () => void;
  /** False when the sheet ends with its own Close button (the week recap). */
  closeButton?: boolean;
}) {
  const insets = useSafeAreaInsets();
  // On the web, Modal's own element is the dialog; this names it.
  const dialog = { "aria-label": title } as object;
  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={close} {...dialog}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: `${colors.chrome}99` }}>
        {/* Tapping outside closes, as the web sheet does; the Close button is the accessible way. */}
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          tabIndex={-1}
          onPress={close}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: "88%",
            width: "100%",
            maxWidth: 672,
            alignSelf: "center",
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            backgroundColor: colors.card,
            paddingBottom: Math.max(16, insets.bottom),
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 40,
              height: 4,
              backgroundColor: colors.raised,
              borderRadius: 10,
              marginTop: 10,
            }}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 16,
              paddingRight: 8,
              paddingTop: 6,
            }}
          >
            <Text accessibilityRole="header" style={[s.subtitle, { flex: 1 }]}>
              {title}
            </Text>
            {closeButton && <IconButton name="close" label="Close" onPress={close} />}
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16 }}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
export function Select<T extends string | number>({
  label,
  value,
  choices,
  onChange,
  disabled,
  compact,
  compactWidth = 112,
}: {
  label: string;
  value: T;
  choices: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  compact?: boolean;
  /** A compact control's width, for labels longer than a year ("2026 playoffs"). */
  compactWidth?: number;
}) {
  const menu = useAnchor();
  return (
    <View style={{ gap: 6, ...(compact ? { flexShrink: 1, minWidth: 0, width: compactWidth } : {}) }}>
      {!compact && (
        <Text
          style={[
            s.text,
            { fontFamily: fonts.medium, color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
          ]}
        >
          {label}
        </Text>
      )}
      {WebSelect ? (
        <WebSelect
          label={label}
          value={String(value)}
          choices={choices.map((choice) => ({ value: String(choice.value), label: choice.label }))}
          onChange={(raw) => {
            const choice = choices.find((c) => String(c.value) === raw);
            if (choice) onChange(choice.value);
          }}
          disabled={disabled}
          compact={compact}
        />
      ) : (
        <>
          <Pressable
            ref={menu.ref}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${choices.find((c) => c.value === value)?.label ?? value}`}
            disabled={disabled}
            onPress={menu.open}
            style={{
              minHeight: 44,
              backgroundColor: compact ? colors.raised : `${colors.background}99`,
              borderWidth: compact ? 0 : 1,
              borderColor: colors.input,
              borderRadius: compact ? 100 : 10,
              paddingHorizontal: compact ? 16 : 12,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              opacity: disabled ? 0.45 : 1,
            }}
          >
            <Text
              numberOfLines={1}
              style={[
                s.text,
                {
                  fontFamily: compact ? fonts.semibold : fonts.body,
                  fontSize: compact ? 14 : 16,
                  flexShrink: 1,
                },
              ]}
            >
              {choices.find((c) => c.value === value)?.label ?? value}
            </Text>
            <Icon name="chevron-down" size={14} color={colors.mutedForeground} />
          </Pressable>
          {/* A dropdown under the control. */}
          <Menu
            anchor={menu.anchor}
            onClose={menu.close}
            label={label}
            width={compact ? undefined : menu.anchor?.width}
            maxHeight={360}
          >
            {choices.map((choice) => (
              <MenuItem
                key={choice.value}
                label={choice.label}
                checked={choice.value === value}
                onPress={() => {
                  menu.close();
                  onChange(choice.value);
                }}
              />
            ))}
          </Menu>
        </>
      )}
    </View>
  );
}
export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
  return (
    <View
      style={{ backgroundColor: colors.card, borderRadius: 16, padding: 12, gap: 4, minWidth: 0, flex: 1 }}
    >
      <Text style={[s.muted, { fontSize: 12, lineHeight: 16, fontFamily: fonts.medium }]}>{label}</Text>
      <Text style={{ fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 32, color: colors.foreground }}>
        {value}
      </Text>
      {detail && <Text style={[s.muted, { fontSize: 14, lineHeight: 20 }]}>{detail}</Text>}
    </View>
  );
}
export function StatGrid({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{children}</View>;
}
export function Disclosure({
  title,
  children,
  initial = false,
}: {
  title: string;
  children: ReactNode;
  initial?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <View style={{ gap: 12 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
        <Text style={[s.text, { fontFamily: fonts.medium }]}>{title}</Text>
      </Pressable>
      {open && children}
    </View>
  );
}
export function confirm(title: string, detail: string, action: string, run: () => void, destructive = false) {
  void showConfirm({ title, message: detail, confirmLabel: action, destructive }).then((ok) => {
    if (ok) run();
  });
}
export async function go(path: string) {
  // Synchronous when nothing is unsaved, so the next screen replaces this one within the tap, as a web link does.
  if (!hasUnsavedWork() || (await confirmDiscard())) router.push(path as never);
}
export function useEditsGuard(dirty: boolean, onDiscard?: () => void) {
  useUnsavedWork(dirty, onDiscard);
  useRemovalGuard(dirty);
}
/**
 * Loads on mount and whenever `key` changes, again each time the screen comes back into focus or the app
 * returns to the foreground, and every `intervalMs` while it shows something. A screen whose load failed
 * (a league that doesn't exist, no connection) waits for **Try again** or the next focus instead of polling.
 */
export function useLeagueLoad<T>(load: () => Promise<T>, key: string, intervalMs = 0) {
  const [loaded, setLoaded] = useState<{ key: string; value: T }>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const writes = useRef(0);
  const showing = useRef(false);
  showing.current = loaded?.key === key;
  // The first focus comes with the mount, which has already started a load.
  const mounted = useRef(false);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const setData = useCallback(
    (value: T) => {
      writes.current++;
      setLoaded({ key, value });
    },
    [key],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the explicit refresh invalidator; the loader lives in a ref to avoid an effect per render.
  useEffect(() => {
    let current = true;
    const stamp = writes.current;
    setError(undefined);
    loadRef.current().then(
      (value) => {
        if (current && stamp === writes.current) setLoaded({ key, value });
      },
      (err: unknown) => {
        if (current && stamp === writes.current)
          setError(err instanceof Error ? err.message : "Something went wrong.");
      },
    );
    return () => {
      current = false;
    };
  }, [key, version]);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) reload();
      mounted.current = true;
      const sub = AppState.addEventListener("change", (state) => {
        if (state === "active") reload();
      });
      const timer = intervalMs
        ? setInterval(() => {
            if (AppState.currentState === "active" && showing.current) reload();
          }, intervalMs)
        : undefined;
      return () => {
        sub.remove();
        if (timer) clearInterval(timer);
      };
    }, [reload, intervalMs]),
  );
  return { data: loaded?.key === key ? loaded.value : undefined, error, reload, setData };
}
