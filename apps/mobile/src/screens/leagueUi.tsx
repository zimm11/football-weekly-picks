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
  Pressable,
  type PressableStateCallbackType,
  type StyleProp,
  StyleSheet,
  Text,
  type TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { AppLink, type LinkHow } from "../components/AppLink";
import { BottomSheet } from "../components/BottomSheet";
import { FadeIn } from "../components/FadeIn";
import { Icon, type IconName } from "../components/Icon";
import { Menu, MenuItem, useAnchor } from "../components/Popover";
import { disabledOpacity, hoverFill, pressState } from "../components/pressState";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { corner, elevation, layout, radius, space, type, widths } from "../components/theme";
import {
  Badge,
  Button,
  CardTitle,
  colors,
  ErrorMessage,
  Field,
  fonts,
  styles as uiStyles,
} from "../components/ui";
import { WebSelect } from "../components/WebSelect";
import { statusOf } from "../lib/api";
import { showConfirm } from "../lib/dialogs";
import { dropLoadCache, loadCacheGeneration, readLoadCache, writeLoadCache } from "../lib/loadCache";
import { duration, webTransition } from "../lib/motion";
import { confirmDiscard, hasUnsavedWork, useRemovalGuard, useUnsavedWork } from "../lib/unsaved";

export { CardTitle, colors };
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
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
  row: { flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" },
  text: { ...type.body, color: colors.foreground },
  muted: { ...type.small, color: colors.mutedForeground },
  title: { ...type.title, color: colors.foreground },
  subtitle: { ...type.heading, color: colors.foreground },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  secondary: { backgroundColor: colors.raised },
  buttonText: { ...type.body, fontFamily: fonts.semibold, color: colors.foreground },
  input: {
    backgroundColor: colors.field,
    borderWidth: 1,
    borderColor: colors.input,
    borderRadius: radius.md,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...type.body,
    color: colors.foreground,
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
/** The app's `Badge` (components/ui.tsx), under the league screens' name. */
export function Pill({
  children,
  tone = "muted",
  inline = false,
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "win" | "pow" | "warning";
  inline?: boolean;
}) {
  return (
    <Badge tone={tone} inline={inline}>
      {children}
    </Badge>
  );
}
/**
 * The app's `Button` (components/ui.tsx), with the league screens' props: primary by default, `secondary`
 * (the quiet raised button), `ghost`, `danger` (the coral destructive button; on a ghost, a coral label),
 * `muted` (a muted label on a quiet button) and `compact` (small, as wide as its content). `label` is the
 * accessible name when it should say more than the text.
 */
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
  return (
    <Button
      title={children}
      onPress={onPress}
      disabled={!!disabled}
      busy={busy}
      variant={ghost ? "ghost" : danger ? "destructive" : secondary ? "secondary" : "primary"}
      labelTone={ghost && danger ? "destructive" : muted ? "muted" : undefined}
      accessibilityLabel={label}
      icon={icon}
      small={!!compact}
      fit={!!compact}
      style={style}
      link={!!link}
      href={href}
      how={how}
    />
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
      style={(state) => [
        webTransition(["background-color", "opacity"]),
        {
          minWidth: 44,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.full,
          backgroundColor: disabled ? "transparent" : hoverFill(state),
          opacity: disabled ? disabledOpacity : 1,
        },
      ]}
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
      webTransition(["background-color", "opacity"]),
      {
        backgroundColor: hoverFill(state, colors.card),
        ...corner(radius.xl),
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
 * The app's `Field` (components/ui.tsx) under the league screens' name: a labelled text field. Beyond
 * `TextInput`'s props:
 *
 * - `onSubmit` runs when the player presses Enter (or the keyboard's return key) in a single-line field:
 *   pass the form's submit, or focus the next field (`enterKeyHint="next"` with `ref` on the next one).
 *   The return key says "done" unless `enterKeyHint`/`returnKeyType` says otherwise.
 * - `ref` reaches the `TextInput` (`ref.current?.focus()`).
 * - A `secureTextEntry` field turns off capitalization, autocorrect and spell-check by itself.
 * - `hint` is one muted line under the field; `reveal` adds a show-password eye to a `secureTextEntry` one.
 */
export function Input(
  props: Omit<TextInputProps, "ref"> & {
    label: string;
    onSubmit?: () => void;
    ref?: Ref<ComponentRef<typeof TextInput>>;
    hint?: string;
    reveal?: boolean;
  },
) {
  return <Field {...props} />;
}
/** Something didn't load: the message, and **Try again** with `retry`. The app's `ErrorMessage`, announced whole. */
export function Failure({ message, retry }: { message?: string; retry?: () => void }) {
  return <ErrorMessage message={message} onRetry={retry} announce="block" />;
}
/**
 * The placeholder while a league screen loads: a title bar and three cards, pulsing gently. Named `label` and
 * marked busy for screen readers. `bare` leaves out the page's own padding, for a tab that already has it.
 */
export function Skeleton({ label = "Loading league", bare = false }: { label?: string; bare?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={bare ? { gap: layout.pageGap } : s.content}
    >
      <SkeletonBlock width={190} height={30} />
      {[0, 1, 2].map((n) => (
        <View key={n} style={[s.card, { height: n === 0 ? 64 : 120 }]}>
          <SkeletonBlock width="40%" height={16} />
          {n > 0 && <SkeletonBlock width="75%" height={16} />}
        </View>
      ))}
    </View>
  );
}
/**
 * "Nothing here yet", drawn the same on every screen: an icon in a disc, a title (a heading at `level`, 2 by
 * default), one muted line (`detail` or `children`), and an optional `action` (a button) under it.
 */
export function EmptyState({
  icon,
  title,
  detail,
  children,
  action,
  level = 2,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  children?: ReactNode;
  action?: ReactNode;
  level?: 1 | 2 | 3 | 4;
}) {
  const line = children ?? detail;
  return (
    <View style={[s.card, { padding: space["3xl"], alignItems: "center" }]}>
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.full,
          backgroundColor: colors.raised,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={24} color={colors.mutedForeground} />
      </View>
      <View style={{ gap: space.xs, alignItems: "center" }}>
        <CardTitle level={level} style={{ textAlign: "center" }}>
          {title}
        </CardTitle>
        {line !== undefined && <Text style={[s.muted, { textAlign: "center" }]}>{line}</Text>}
      </View>
      {action}
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
      {!compact && <Text style={uiStyles.label}>{label}</Text>}
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
            style={(state) => {
              const { pressed } = pressState(state);
              return [
                webTransition(["background-color", "opacity"]),
                {
                  minHeight: 44,
                  minWidth: compact ? compactWidth : undefined,
                  backgroundColor: compact ? (pressed ? colors.raisedHover : colors.raised) : colors.field,
                  borderWidth: compact ? 0 : 1,
                  borderColor: pressed ? colors.primary : colors.input,
                  borderRadius: compact ? radius.full : radius.md,
                  paddingHorizontal: compact ? 16 : 12,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  opacity: disabled ? disabledOpacity : 1,
                },
              ];
            }}
          >
            <Text
              numberOfLines={1}
              style={[
                s.text,
                {
                  fontFamily: compact ? fonts.semibold : fonts.body,
                  fontSize: compact ? 14 : 16,
                  lineHeight: compact ? 20 : 24,
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
/**
 * A labelled number. `raised` inside a sheet or a card, where a tile in the card's own fill would disappear
 * (its corner is then the smaller 12, inside the card's 16). `tone` colors the value; `compact` is the
 * smaller value for a row of several. It fills its share of a row (`flex: 1`) unless `grow` is false.
 */
export function StatTile({
  label,
  value,
  detail,
  raised = false,
  tone,
  compact = false,
  grow = true,
  style,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  raised?: boolean;
  tone?: string;
  compact?: boolean;
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: raised ? colors.raised : colors.card,
          ...corner(raised ? radius.lg : radius.xl),
          padding: 12,
          gap: space.xs,
          minWidth: 0,
        },
        grow && { flex: 1 },
        style,
      ]}
    >
      <Text style={[type.caption, { fontFamily: fonts.medium, color: colors.mutedForeground }]}>{label}</Text>
      {/* One big value standing alone: proportional figures (see `tabular` in theme.ts). */}
      <Text
        style={[type.stat, { color: tone ?? colors.foreground }, compact && { fontSize: 24, lineHeight: 26 }]}
      >
        {value}
      </Text>
      {detail && <Text style={[s.muted, compact && type.caption]}>{detail}</Text>}
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
        style={(state) => [
          webTransition(["background-color"]),
          {
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginHorizontal: -8,
            paddingHorizontal: 8,
            borderRadius: radius.md,
            backgroundColor: hoverFill(state),
          },
        ]}
      >
        {/* The chevron turns down when open (eased on the web). */}
        <View
          style={[
            webTransition(["transform"], duration.base),
            { transform: [{ rotate: open ? "90deg" : "0deg" }] },
          ]}
        >
          <Icon name="chevron-right" size={16} color={colors.mutedForeground} />
        </View>
        <Text style={[s.text, { fontFamily: fonts.medium }]}>{title}</Text>
      </Pressable>
      {open && (
        <FadeIn from={-4} style={{ gap: 12 }}>
          {children}
        </FadeIn>
      )}
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
