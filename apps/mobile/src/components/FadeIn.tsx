import { type ReactNode, useEffect, useRef } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";
import { duration, easing, nativeDriver, useReducedMotion } from "../lib/motion";

/**
 * Fades its children in when it mounts (`duration.base`, `easing.out`), and with `from` also moves them
 * that many pixels into place (at most 8 either way; 0, no movement, by default). `enabled={false}` or
 * reduced motion shows them at rest at once. A plain view otherwise: no role, no accessible name.
 */
export function FadeIn({
  from = 0,
  enabled = true,
  style,
  children,
}: {
  from?: number;
  enabled?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const animate = enabled && !reduced;
  const offset = Math.max(-8, Math.min(8, from));
  // Decided on mount: turned off mid-fade it lands at rest, and a fade that has run never runs again.
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    const timing = Animated.timing(progress, {
      toValue: 1,
      duration: duration.base,
      easing: easing.out,
      useNativeDriver: nativeDriver,
    });
    // From where it stands: 0 on mount, already 1 if it was turned on later (nothing then moves).
    timing.start();
    return () => timing.stop();
  }, [animate, progress]);
  const motion = offset
    ? {
        opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }],
      }
    : { opacity: progress };
  return <Animated.View style={[style, motion]}>{children}</Animated.View>;
}
