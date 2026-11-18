import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

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
