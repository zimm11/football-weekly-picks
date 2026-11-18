import { useEffect } from "react";
import {
  Animated,
  type DimensionValue,
  Easing,
  Platform,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { nativeDriver, useReducedMotion } from "../lib/motion";
import { colors, radius as radii } from "./theme";

const PULSE_MS = 900;
const DIM = 0.55;

// The web pulses in CSS (react-native-web compiles `animationKeyframes` into a @keyframes rule, which it
// does only for styles made with StyleSheet.create): no JavaScript runs per frame.
const webPulse =
  Platform.OS === "web"
    ? StyleSheet.create({
        pulse: {
          animationKeyframes: [{ "0%": { opacity: 1 }, "100%": { opacity: DIM } }],
          animationDuration: `${PULSE_MS}ms`,
          animationIterationCount: "infinite",
          animationDirection: "alternate",
          animationTimingFunction: "ease-in-out",
        } as ViewStyle,
      }).pulse
    : undefined;

// iPhone: one value and one loop on the native driver, shared by every block on screen, running while at
// least one animated block is mounted.
const shared = new Animated.Value(1);
const step = (toValue: number) =>
  Animated.timing(shared, {
    toValue,
    duration: PULSE_MS,
    easing: Easing.inOut(Easing.ease),
    useNativeDriver: nativeDriver,
  });
let mounted = 0;
// A stopped loop can't be started again, so each run of blocks gets a new one.
let loop: Animated.CompositeAnimation | undefined;

/**
 * One placeholder block for a loading skeleton: a `raised` shape that pulses gently. Decorative (hidden from
 * screen readers); the skeleton around it carries the name and the busy state. Static under reduced motion.
 */
export function SkeletonBlock({
  width,
  height,
  radius = radii.sm,
  style,
}: {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const pulseNative = !reduced && Platform.OS !== "web";
  useEffect(() => {
    if (!pulseNative) return;
    mounted += 1;
    if (mounted === 1) {
      loop = Animated.loop(Animated.sequence([step(DIM), step(1)]));
      loop.start();
    }
    return () => {
      mounted -= 1;
      if (mounted === 0) {
        loop?.stop();
        loop = undefined;
        shared.setValue(1);
      }
    };
  }, [pulseNative]);
  const shape = { width, height, borderRadius: radius, backgroundColor: colors.raised };
  // A plain View on the web: Animated flattens its style into a new object, which would lose the compiled
  // keyframes (react-native-web finds them by the object StyleSheet.create made).
  if (Platform.OS === "web")
    return <View accessible={false} aria-hidden style={[shape, reduced ? undefined : webPulse, style]} />;
  return (
    <Animated.View
      accessible={false}
      aria-hidden
      style={[shape, pulseNative ? { opacity: shared } : undefined, style]}
    />
  );
}
