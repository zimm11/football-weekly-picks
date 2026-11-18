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
  Platform,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { AppLink, type LinkHow } from "../components/AppLink";
import { BottomSheet } from "../components/BottomSheet";
import { Icon } from "../components/Icon";
import { Menu, MenuItem, useAnchor } from "../components/Popover";
import { atRest, busyProps, hoverFill, pressState } from "../components/pressState";
import { colors, fonts } from "../components/ui";
import { WebSelect } from "../components/WebSelect";
import { statusOf } from "../lib/api";
import { showConfirm } from "../lib/dialogs";
import { fieldDefaults } from "../lib/fieldProps";
import { dropLoadCache, loadCacheGeneration, readLoadCache, writeLoadCache } from "../lib/loadCache";
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
/**
 * A section heading. `level` is its place in the page's outline for screen readers: 2 by default (a section
 * under the page's title), 3 for a part of a section. It doesn't change how the heading looks.
 */
export function Heading({ children, level = 2 }: { children: ReactNode; level?: 1 | 2 | 3 | 4 }) {
  return (
    <Text accessibilityRole="header" aria-level={level} style={s.subtitle}>
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
const ignore = () => {};
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
  busy = false,
  href,
  how,
}: {
  children: ReactNode;
  /** Optional with `href`, where it replaces the default navigation. */
  onPress?: () => void;
  disabled?: boolean;
  /**
   * Its own request is running: it looks disabled and ignores presses, but stays a keyboard stop so the
   * focus isn't dropped to the page. Use it rather than `disabled` for "Saving…".
   */
  busy?: boolean;
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
  /**
   * An in-app path: the button is a real link (`AppLink`: an `<a href>` on the web, so Enter and new-tab
   * clicks work), opened through the unsaved-work guard. `how` is push (default), replace or dismissTo.
   */
  href?: string;
  how?: LinkHow;
}) {
  const off = !!disabled || busy;
  const shared = {
    accessibilityLabel: label,
    ...busyProps(disabled, busy, Platform.OS === "web"),
    style: (state: PressableStateCallbackType) => {
      const { pressed, hovered } = busy ? atRest : pressState(state);
      return [
        s.button,
        secondary && s.secondary,
        ghost && { backgroundColor: "transparent" },
        compact && { alignSelf: "flex-start" as const, paddingHorizontal: 12 },
        // Under the mouse: a filled button lightens, a secondary or ghost one takes the next layer up.
        hovered &&
          (ghost
            ? { backgroundColor: colors.raised }
            : secondary
              ? { backgroundColor: colors.raisedHover }
              : { opacity: 0.9 }),
        off && { opacity: 0.45 },
        busy && { cursor: "auto" },
        pressed && { opacity: 0.75 },
        style,
      ];
    },
  };
  const content = (
    <>
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
      style={(state) => ({
        minWidth: 44,
        minHeight: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 100,
        backgroundColor: hoverFill(state),
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
  href,
  how,
}: {
  children: ReactNode;
  /** Optional with `href`, where it replaces the default navigation. */
  onPress?: () => void;
  label?: string;
  style?: ViewStyle;
  /**
   * The in-app path the row opens: the row is then a real link (`AppLink`: an `<a href>` on the web, so
   * Enter and new-tab clicks work), opened through the unsaved-work guard. `how` is push (default), replace
   * or dismissTo.
   */
  href?: string;
  how?: LinkHow;
}) {
  const shared = {
    accessibilityLabel: label,
    style: (state: PressableStateCallbackType) => [
      {
        backgroundColor: hoverFill(state, colors.card),
        borderRadius: 16,
        minHeight: 64,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
      },
      style,
    ],
  };
  const content = (
    <>
      {children}
      <Icon name="chevron-right" size={20} color={colors.mutedForeground} />
    </>
  );
  if (href !== undefined)
    return (
      <AppLink href={href} how={how} onPress={onPress} {...shared}>
        {content}
      </AppLink>
    );
  return (
    <Pressable accessibilityRole="link" onPress={onPress} {...shared}>
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
export function Input({
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
      <Text
        style={[
          s.text,
          { fontSize: 14, lineHeight: 20, fontFamily: fonts.medium, color: colors.mutedForeground },
        ]}
      >
        {label}
      </Text>
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
        style={[s.input, focused && { borderColor: colors.primary }, props.style]}
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
  /**
   * False when the sheet ends with its own button named Close (the week recap). The ✕ shows either way; it
   * is then named "Dismiss", so there is still exactly one "Close" button in the sheet.
   */
  closeButton?: boolean;
}) {
  // Most callers mount the sheet only while it is open, so it slides out before telling them it closed.
  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={title}
      closeLabel={closeButton ? "Close" : "Dismiss"}
      exitFirst
    >
      {children}
    </BottomSheet>
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
  /**
   * A compact control's least width. It grows to fit the chosen label ("2026 playoffs", "2026 · Not
   * started"), as far as the row allows, and shortens the label with an ellipsis past that.
   */
  compactWidth?: number;
}) {
  const menu = useAnchor();
  const chosen = choices.find((c) => c.value === value)?.label ?? String(value);
  return (
    <View style={{ gap: 6, ...(compact ? { flexShrink: 1, minWidth: 0, maxWidth: "100%" } : {}) }}>
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
          minWidth={compact ? compactWidth : undefined}
        />
      ) : (
        <>
          <Pressable
            ref={menu.ref}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${chosen}`}
            disabled={disabled}
            onPress={menu.open}
            style={({ pressed }) => ({
              minHeight: 44,
              minWidth: compact ? compactWidth : undefined,
              backgroundColor: compact
                ? pressed
                  ? colors.raisedHover
                  : colors.raised
                : `${colors.background}99`,
              borderWidth: compact ? 0 : 1,
              borderColor: pressed ? colors.primary : colors.input,
              borderRadius: compact ? 100 : 10,
              paddingHorizontal: compact ? 16 : 12,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              opacity: disabled ? 0.45 : 1,
            })}
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
              {chosen}
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
/** `raised` inside a sheet or a card, where a tile in the card's own fill would disappear. */
export function StatTile({
  label,
  value,
  detail,
  raised = false,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  raised?: boolean;
}) {
  return (
    <View
      style={{
        backgroundColor: raised ? colors.raised : colors.card,
        borderRadius: 16,
        padding: 12,
        gap: 4,
        minWidth: 0,
        flex: 1,
      }}
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
        // react-native-web reads only the aria-* form.
        aria-expanded={open}
        onPress={() => setOpen(!open)}
        // The fill reaches 8px past the text on each side without moving it.
        style={(state) => ({
          minHeight: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          marginHorizontal: -8,
          paddingHorizontal: 8,
          borderRadius: 10,
          backgroundColor: hoverFill(state),
        })}
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
 *
 * Stale while revalidating: the last value loaded under `key` is kept in memory (`lib/loadCache.ts`), so a screen
 * that mounts again shows it at once and this load only refreshes it. Use the API path as the key when the value
 * is that path's response ("/leagues/<id>"), so every screen loading it shares one copy.
 *
 * Returns `data`, `fresh` (false while `data` is only the remembered copy and this mount's own load hasn't
 * answered: wait for it before doing something once from the data, like showing a recap or seeding a form),
 * `error` (the message of the last failed load), `status` (its HTTP status: 404 means the thing
 * is gone or not the player's to see, so show not-found rather than **Try again**; undefined when there was no
 * answer), `reload()` (start a refresh), `refresh()` (the same, resolving when that load has settled: for pull to
 * refresh) and `setData(value)` (show a value the screen already has, e.g. a save's response).
 */
export function useLeagueLoad<T>(load: () => Promise<T>, key: string, intervalMs = 0) {
  const [loaded, setLoaded] = useState<{ key: string; value: T; fresh: boolean } | undefined>(() => {
    const value = readLoadCache<T>(key);
    return value === undefined ? undefined : { key, value, fresh: false };
  });
  const [failure, setFailure] = useState<{ message: string; status?: number }>();
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const writes = useRef(0);
  // A key this hook hasn't loaded yet (it changed, or the screen just mounted) still shows its cached value.
  const data = loaded?.key === key ? loaded.value : readLoadCache<T>(key);
  const showing = useRef(false);
  showing.current = data !== undefined;
  // The first focus comes with the mount, which has already started a load.
  const mounted = useRef(false);
  // Whoever awaits `refresh()`; released when the load in flight settles, or the screen goes away.
  const waiting = useRef<(() => void)[]>([]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiting.current.push(resolve);
        setVersion((v) => v + 1);
      }),
    [],
  );
  const setData = useCallback(
    (value: T) => {
      writes.current++;
      writeLoadCache(key, value);
      setLoaded({ key, value, fresh: true });
    },
    [key],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the explicit refresh invalidator; the loader lives in a ref to avoid an effect per render.
  useEffect(() => {
    let current = true;
    const stamp = writes.current;
    const started = loadCacheGeneration();
    const settle = () => {
      if (!current) return;
      for (const resolve of waiting.current.splice(0)) resolve();
    };
    setFailure(undefined);
    loadRef.current().then(
      (value) => {
        if (current && stamp === writes.current) {
          writeLoadCache(key, value, started);
          setLoaded({ key, value, fresh: true });
        }
        settle();
      },
      (err: unknown) => {
        if (current && stamp === writes.current) {
          const status = statusOf(err);
          if (status === 404) {
            // Gone, or no longer this player's: nothing stale may show now or the next time.
            dropLoadCache(key);
            setLoaded(undefined);
          }
          setFailure({ message: err instanceof Error ? err.message : "Something went wrong.", status });
        }
        settle();
      },
    );
    return () => {
      current = false;
    };
  }, [key, version]);
  useEffect(
    () => () => {
      for (const resolve of waiting.current.splice(0)) resolve();
    },
    [],
  );
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
  return {
    data,
    // False while `data` is only the remembered copy: wait for it before acting once on what the server says.
    fresh: loaded?.key === key && loaded.fresh,
    error: failure?.message,
    status: failure?.status,
    reload,
    refresh,
    setData,
  };
}
