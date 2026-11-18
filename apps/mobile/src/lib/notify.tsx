import { usePathname } from "expo-router";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../components/Icon";
import { hoverFill } from "../components/pressState";
import { colors, elevation, fonts } from "../components/theme";
import { now } from "./clock";
import { haptics } from "./haptics";
import { duration, easing, nativeDriver, pop, useReducedMotion } from "./motion";

type Notice = { message: string; kind: "status" | "alert" };

// One notice at a time for the whole app, shown by whichever banner is on top: the app's own, or the one
// inside an open bottom sheet (a sheet covers the app's banner, so it hosts its own).
let current: Notice | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const hosts: object[] = [];
const subscribers = new Set<() => void>();
function changed() {
  for (const subscriber of subscribers) subscriber();
}
function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}
/** How long a notice stays: long enough to read a confirmation, longer for a problem the player must act on. */
const SHOWN_MS = { status: 4000, alert: 10_000 } as const;
// An alert waits while the player is reading it (the pointer over the banner) or about to dismiss it (its
// Dismiss button has the focus); it gets what was left of its time back afterwards.
const held = { hover: false, focus: false };
let remaining = 0;
let deadline = 0;
const clockMs = () => now().getTime();
function start(ms: number) {
  if (timer) clearTimeout(timer);
  remaining = ms;
  deadline = clockMs() + ms;
  timer = setTimeout(dismiss, ms);
}
function holding() {
  return current?.kind === "alert" && (held.hover || held.focus);
}
function hold(reason: keyof typeof held, on: boolean) {
  const was = holding();
  held[reason] = on;
  const is = holding();
  if (is && !was && timer) {
    clearTimeout(timer);
    timer = undefined;
    remaining = Math.max(0, deadline - clockMs());
  } else if (!is && was && current) start(remaining);
}
function dismiss() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  current = undefined;
  // The banner it was read on goes; the next one starts unheld.
  held.hover = false;
  held.focus = false;
  changed();
}
function raise(notice: Notice) {
  current = notice;
  if (holding()) {
    if (timer) clearTimeout(timer);
    timer = undefined;
    remaining = SHOWN_MS.alert;
  } else start(SHOWN_MS[notice.kind]);
  changed();
  // The iPhone has no live regions: VoiceOver is told directly.
  if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(notice.message);
}
// The banner is where an outcome is said, so it is also where it is felt (on iPhone): a screen that raises it
// doesn't add a haptic of its own for the same event.
export function notifyDone(message: string) {
  raise({ message, kind: "status" });
  haptics.success();
}
export function notifyError(message: string) {
  raise({ message, kind: "alert" });
  haptics.error();
}

/** The notice this banner should show: the current one while it is the top banner, else none. */
function useNotice() {
  const [host] = useState(() => ({}));
  useEffect(() => {
    hosts.push(host);
    changed();
    return () => {
      hosts.splice(hosts.indexOf(host), 1);
      changed();
    };
  }, [host]);
  const read = () => (hosts[hosts.length - 1] === host ? current : undefined);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * The banner that says how an action went (`notifyDone`, `notifyError`). Mounted once for the app; a bottom
 * sheet mounts its own, since a sheet covers the app's, and passes its panel's height as `above` so the
 * banner floats over the top edge of the sheet instead of covering the sheet's buttons.
 *
 * On phones it sits at the bottom, above the league tab bar and a save bar; from 768px wide it is pinned to
 * the bottom-right corner, clear of the centered column's controls. Its text element stays mounted and only
 * its words change, because a screen reader misses a live region that arrives together with its content.
 */
export function NotificationBanner({ above }: { above?: number }) {
  const notice = useNotice();
  // What is drawn: the notice, kept while it fades out.
  const [shown, setShown] = useState(notice);
  const progress = useRef(new Animated.Value(0)).current;
  // A notice that replaces one still showing pops a little, so two saves in a row read as two.
  const scale = useRef(new Animated.Value(1)).current;
  const showing = useRef<Notice | undefined>(undefined);
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  // Phones keep the league tab bar (and a save bar) at the bottom; wide screens put the tabs at the top.
  const { width, height } = useWindowDimensions();
  const wide = width >= 768;
  // New league (`/leagues/new`) sits outside any league, so it has no tab bar.
  const leagueScreen =
    (path.startsWith("/leagues/") && path !== "/leagues/new") ||
    path.startsWith("/weeks/") ||
    path.startsWith("/boards/");
  const bottom =
    above === undefined
      ? insets.bottom + (leagueScreen ? (wide ? 96 : 136) : 24)
      : // Over a sheet: just above it, or at the top of the screen when the sheet is nearly as tall.
        Math.min(above + 12, height - insets.top - 72);
  useEffect(() => {
    const replaced = !!notice && !!showing.current && showing.current !== notice;
    showing.current = notice;
    progress.stopAnimation();
    if (notice) setShown(notice);
    if (reduced) {
      progress.setValue(notice ? 1 : 0);
      if (!notice) setShown(undefined);
      return;
    }
    if (replaced) {
      scale.setValue(0.97);
      Animated.spring(scale, { toValue: 1, ...pop, useNativeDriver: nativeDriver }).start();
    }
    Animated.timing(progress, {
      toValue: notice ? 1 : 0,
      duration: notice ? duration.base : duration.fast,
      easing: notice ? easing.out : easing.in,
      useNativeDriver: nativeDriver,
    }).start(({ finished }) => {
      if (finished && !notice) setShown(undefined);
    });
  }, [notice, reduced, progress, scale]);
  const alert = shown?.kind === "alert";
  return (
    // The full-width row places the banner, since an absolutely positioned view ignores alignSelf.
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        bottom,
        left: 0,
        right: 0,
        paddingHorizontal: wide ? 24 : 16,
        alignItems: wide ? "flex-end" : "center",
      }}
    >
      <Animated.View
        pointerEvents={notice ? "auto" : "none"}
        // A mouse over the banner holds an alert (in a browser; a finger on iPhone doesn't hover).
        {...(Platform.OS === "web"
          ? { onPointerEnter: () => hold("hover", true), onPointerLeave: () => hold("hover", false) }
          : null)}
        style={{
          width: "100%",
          maxWidth: wide ? 380 : 420,
          backgroundColor: colors.raised,
          paddingVertical: 4,
          paddingLeft: 14,
          paddingRight: 4,
          borderRadius: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          boxShadow: elevation.float,
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
            { scale },
          ],
        }}
      >
        {shown && (
          <Icon
            name={alert ? "warning" : "check-circle"}
            filled
            size={20}
            color={alert ? colors.destructive : colors.win}
          />
        )}
        <Text
          accessibilityLiveRegion={alert ? "assertive" : "polite"}
          accessibilityRole={alert ? "alert" : "text"}
          style={{
            fontFamily: fonts.medium,
            fontSize: 14,
            lineHeight: 20,
            color: colors.foreground,
            flex: 1,
            paddingVertical: 10,
          }}
        >
          {shown?.message ?? ""}
        </Text>
        {shown && (
          <Pressable
            accessibilityLabel="Dismiss notification"
            accessibilityRole="button"
            onPress={dismiss}
            onFocus={() => hold("focus", true)}
            onBlur={() => hold("focus", false)}
            style={(state) => ({
              minWidth: 44,
              minHeight: 44,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 10,
              backgroundColor: hoverFill(state, "transparent", colors.raisedHover),
            })}
          >
            <Icon name="close" size={16} color={colors.mutedForeground} />
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}
