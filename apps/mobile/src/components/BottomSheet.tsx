import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "../lib/motion";
import { NotificationBanner } from "../lib/notify";
import { Icon } from "./Icon";
import { hoverFill } from "./pressState";
import { colors, fonts } from "./theme";

/**
 * The area around a sheet or a menu: a tap or click on it closes. It is never a keyboard stop or something a
 * screen reader lands on (the visible Close button, Escape and the menu's own items are the accessible ways
 * out). In a browser it is a plain element with no `tabindex` at all, because the Modal's focus trap would
 * otherwise put the focus on it.
 */
export function Backdrop({ onPress }: { onPress: () => void }) {
  if (Platform.OS === "web") return <View onClick={onPress} style={StyleSheet.absoluteFill} />;
  return (
    <Pressable
      accessible={false}
      importantForAccessibility="no"
      onPress={onPress}
      style={StyleSheet.absoluteFill}
    />
  );
}

/**
 * The app's one bottom sheet: `Sheet` in `components/ui.tsx`, `Sheet` in `screens/leagueUi.tsx` and the
 * home-screen help are thin wrappers over it. Use one of those in a screen; use this for a new kind of sheet.
 *
 * The dim backdrop fades in place while the panel slides up (no movement when the player asked for reduced
 * motion), and both run back before the sheet goes. It closes with the ✕, a tap outside, Escape or the
 * phone's back button; in a browser the dialog is named by `title`, the keyboard focus stays inside it and
 * returns to the control that opened it. On iPhone the panel rides above the keyboard. A banner raised with
 * `notifyDone`/`notifyError` while it is open shows over the sheet.
 */
export function BottomSheet({
  visible = true,
  onClose,
  title,
  description,
  closeLabel = "Close",
  exitFirst = false,
  footer,
  children,
}: {
  /** Leaving this out and mounting the sheet only while it is open works too. */
  visible?: boolean;
  onClose: () => void;
  /** The heading, and the dialog's accessible name. */
  title: string;
  /** A line under the title; it describes the dialog to screen readers. */
  description?: string;
  /** The ✕ button's accessible name. */
  closeLabel?: string;
  /**
   * For a sheet whose parent unmounts it on close: when the player closes it, slide out first and call
   * `onClose` afterwards, so the exit is seen. (A parent that flips `visible` gets the exit either way.)
   * Not for an `onClose` that may refuse to close.
   */
  exitFirst?: boolean;
  /** Pinned under the scrolling content (a "Not now" button). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduced = useReducedMotion();
  const id = useId();
  const progress = useRef(new Animated.Value(0)).current;
  // The Modal stays mounted through the exit, after `visible` has turned false.
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  // How far the panel travels: its own height, once it has been laid out.
  const [distance, setDistance] = useState<number>();
  const closing = useRef(false);
  const recheck = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef({ onClose, visible });
  latest.current = { onClose, visible };

  const run = useCallback(
    (toValue: 0 | 1, done?: () => void) => {
      progress.stopAnimation();
      if (reduced) {
        progress.setValue(toValue);
        done?.();
        return;
      }
      Animated.timing(progress, {
        toValue,
        duration: toValue ? 260 : 200,
        easing: toValue ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: Platform.OS !== "web",
      }).start(({ finished }) => {
        if (finished) done?.();
      });
    },
    [progress, reduced],
  );
  useEffect(() => {
    if (!mounted) return;
    if (!visible) {
      // Closed from outside. If the player closed it (`exitFirst`), it has already slid out.
      const gone = () => {
        setMounted(false);
        setDistance(undefined);
      };
      if (closing.current) gone();
      else run(0, gone);
    } else if (distance !== undefined) {
      closing.current = false;
      run(1);
    }
  }, [visible, mounted, distance, run]);
  // A panel that somehow reports no layout still opens.
  useEffect(() => {
    if (!mounted || distance !== undefined) return;
    const timer = setTimeout(() => setDistance((value) => value ?? windowHeight), 150);
    return () => clearTimeout(timer);
  }, [mounted, distance, windowHeight]);
  useEffect(
    () => () => {
      progress.stopAnimation();
      clearTimeout(recheck.current);
    },
    [progress],
  );

  const close = useCallback(() => {
    if (!exitFirst) return latest.current.onClose();
    if (closing.current) return;
    closing.current = true;
    run(0, () => {
      latest.current.onClose();
      // An onClose that declined leaves the sheet open: bring it back rather than leave an unseen dialog.
      recheck.current = setTimeout(() => {
        if (!closing.current || !latest.current.visible) return;
        closing.current = false;
        run(1);
      }, 60);
    });
  }, [exitFirst, run]);

  if (!mounted) return null;
  // On the web, Modal's own element is the dialog; these name and describe it.
  const dialog = {
    "aria-label": title,
    "aria-describedby": description ? `${id}-description` : undefined,
  } as object;
  return (
    <Modal visible transparent animationType="none" onRequestClose={close} {...dialog}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1, justifyContent: "flex-end" }}
      >
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay, opacity: progress }]}
        />
        <Backdrop onPress={close} />
        <Animated.View
          accessibilityViewIsModal
          onLayout={(event) => setDistance(event.nativeEvent.layout.height)}
          style={{
            maxHeight: "90%",
            width: "100%",
            maxWidth: 672,
            alignSelf: "center",
            backgroundColor: colors.card,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            borderCurve: "continuous",
            paddingBottom: Math.max(insets.bottom, 16),
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [distance ?? windowHeight, 0],
                }),
              },
            ],
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
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 8,
              paddingLeft: 20,
              paddingRight: 8,
              paddingTop: 6,
              paddingBottom: 4,
            }}
          >
            <View style={{ flex: 1, gap: 6, paddingVertical: 8 }}>
              <Text
                accessibilityRole="header"
                aria-level={2}
                style={{
                  fontFamily: fonts.displayBold,
                  fontSize: 24,
                  lineHeight: 28,
                  letterSpacing: 0.6,
                  color: colors.foreground,
                  textTransform: "uppercase",
                }}
              >
                {title}
              </Text>
              {description && (
                <Text
                  id={`${id}-description`}
                  style={{
                    fontFamily: fonts.body,
                    fontSize: 14,
                    lineHeight: 20,
                    color: colors.mutedForeground,
                  }}
                >
                  {description}
                </Text>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
              onPress={close}
              style={(state) => ({
                width: 44,
                height: 44,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 100,
                backgroundColor: hoverFill(state),
              })}
            >
              <Icon name="close" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {/* The top padding is the content's own, so a first line with a little negative margin isn't clipped. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 16 }}
          >
            {children}
          </ScrollView>
          {footer && <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>{footer}</View>}
        </Animated.View>
        <NotificationBanner above={distance ?? 0} />
      </KeyboardAvoidingView>
    </Modal>
  );
}
