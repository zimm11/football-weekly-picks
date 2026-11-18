import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, type ViewStyle } from "react-native";

/** The browser's "reduce motion" setting, or undefined in the iPhone app (which asks the system instead). */
function mediaQuery() {
  if (Platform.OS !== "web" || typeof window === "undefined" || typeof window.matchMedia !== "function")
    return;
  return window.matchMedia("(prefers-reduced-motion: reduce)");
}

// The iPhone's answer arrives asynchronously; remembered so the next screen to ask starts with it.
let known = false;
if (Platform.OS !== "web") {
  AccessibilityInfo.isReduceMotionEnabled().then(
    (value) => {
      known = value;
    },
    () => {},
  );
}

/**
 * True when the player has asked their phone or browser to reduce motion (iOS: Settings → Accessibility →
 * Motion; the web: `prefers-reduced-motion`). Follows the setting while the screen is open. Anything that
 * slides, grows or fades for more than a moment should skip the movement when it is true.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => mediaQuery()?.matches ?? known);
  useEffect(() => {
    const query = mediaQuery();
    if (query) {
      const changed = () => setReduced(query.matches);
      changed();
      query.addEventListener("change", changed);
      return () => query.removeEventListener("change", changed);
    }
    if (Platform.OS === "web") return;
    let current = true;
    AccessibilityInfo.isReduceMotionEnabled().then(
      (value) => {
        known = value;
        if (current) setReduced(value);
      },
      () => {},
    );
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      known = value;
      setReduced(value);
    });
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

/*
 * The app's motion vocabulary. House rules:
 * - A hover, press or tint change: `duration.fast` with `easing.out`.
 * - Something appearing in place: `duration.base` with `easing.out`. Something leaving: one step shorter
 *   (`fast` after `base`) with `easing.in`.
 * - A panel that travels (a bottom sheet sliding up): `duration.slow`.
 * - A fade moves at most 8px.
 * - Every `Animated` user honors `useReducedMotion()` by jumping to the end value (and `public/boot.css` cuts
 *   every CSS transition and animation short under the browser's setting).
 * - Only opacity and transform animate (plus the pick sheet's 4px progress bar width); never a height.
 */

/** How long a movement takes, in milliseconds. */
export const duration = { fast: 120, base: 200, slow: 260 } as const;

/** The curves for `Animated.timing`: `out` for arriving and for feedback, `in` for leaving. */
export const easing = { out: Easing.out(Easing.cubic), in: Easing.in(Easing.cubic) } as const;

/** The same curves for CSS transitions on the web. */
export const cssEasing = {
  out: "cubic-bezier(0.215, 0.61, 0.355, 1)",
  in: "cubic-bezier(0.55, 0.055, 0.675, 0.19)",
} as const;

/** The one spring: a selection landing (the check on a pick, the POW, a claimed square). */
export const pop = { speed: 28, bounciness: 7 } as const;

/** `useNativeDriver` for every `Animated` call: the native driver on iPhone; the web has none. */
export const nativeDriver = Platform.OS !== "web";

/**
 * A CSS transition for the named properties (never `all`), so a hover or a change of fill eases on the web
 * instead of snapping. `undefined` on iPhone, so it can sit in any style array.
 */
export function webTransition(properties: string[], ms: number = duration.fast): ViewStyle | undefined {
  if (Platform.OS !== "web") return;
  // React Native's style types don't know the CSS transition props; react-native-web passes them through.
  return {
    transitionProperty: properties.join(", "),
    transitionDuration: `${ms}ms`,
    transitionTimingFunction: cssEasing.out,
  } as ViewStyle;
}

/**
 * A scale for a selection landing: 1 at rest, and each time `on` turns true it starts at 0.85 and springs to
 * 1 (`pop`). Turning false, or a render with the same `on`, does nothing. Stays 1 under reduced motion. Use it
 * as `transform: [{ scale }]` on an `Animated.View`.
 */
export function usePop(on: boolean): Animated.Value {
  const scale = useRef(new Animated.Value(1)).current;
  const was = useRef(on);
  const reduced = useReducedMotion();
  useEffect(() => {
    const turnedOn = on && !was.current;
    was.current = on;
    if (!turnedOn || reduced) return;
    scale.setValue(0.85);
    const spring = Animated.spring(scale, { toValue: 1, ...pop, useNativeDriver: nativeDriver });
    spring.start();
    // Cut short (it turned off again, or the screen left): land at rest rather than part-way.
    return () => {
      spring.stop();
      scale.setValue(1);
    };
  }, [on, reduced, scale]);
  return scale;
}
