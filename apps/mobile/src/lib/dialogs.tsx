import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Modal, Platform, View } from "react-native";
import { elevation, layout, space } from "../components/theme";
import { Body, Button, Card, colors, Title } from "../components/ui";
import { type ConfirmPrompt, setConfirmPresenter } from "./confirm";
import { haptics } from "./haptics";
import { duration, easing, nativeDriver, useReducedMotion } from "./motion";
import { useOverlayBack } from "./overlayBack";

const web = Platform.OS === "web";

// `showConfirm` lives in ./confirm (no interface code there); it is re-exported for the screens that import
// it from here.
export { showConfirm } from "./confirm";
export function DialogProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<ConfirmPrompt>();
  // What the dialog last asked: it keeps showing while the dialog fades out, rather than an empty box.
  const [shown, setShown] = useState<ConfirmPrompt>();
  const pending = useRef<((answer: boolean) => void) | undefined>(undefined);
  const reduced = useReducedMotion();
  useEffect(() => {
    const remove = setConfirmPresenter(
      (value) =>
        new Promise<boolean>((resolve) => {
          pending.current?.(false);
          pending.current = resolve;
          setPrompt(value);
          setShown(value);
          // A question about something that can't be undone is felt as it is asked (iPhone).
          if (value.destructive) haptics.warn();
        }),
    );
    return () => {
      remove();
      pending.current?.(false);
    };
  }, []);
  function answer(value: boolean) {
    const resolve = pending.current;
    pending.current = undefined;
    setPrompt(undefined);
    resolve?.(value);
  }
  // On top of the Modal's fade, the dialog grows a little into place each time a question is asked.
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!prompt || reduced) return;
    scale.setValue(0.96);
    const timing = Animated.timing(scale, {
      toValue: 1,
      duration: duration.base,
      easing: easing.out,
      useNativeDriver: nativeDriver,
    });
    timing.start();
    return () => {
      timing.stop();
      scale.setValue(1);
    };
  }, [prompt, reduced, scale]);
  // The browser's Back answers Cancel, as Escape does.
  useOverlayBack(!!prompt, () => answer(false));
  return (
    <>
      {children}
      {/*
        In a browser the dialog leaves the page with the answer, in the same update. react-native-web keeps a
        closing Modal's focus trap on until its fade-out ends, which pulls the focus (and the player's typing)
        back from whatever they turn to next; unmounted at once, the trap ends and hands the focus back to the
        control that asked before anything else can take it. It still fades in. The iPhone has no focus trap
        and keeps its fade-out.
      */}
      {(!web || !!prompt) && (
        <Modal
          visible={!!prompt}
          transparent
          animationType={reduced ? "none" : "fade"}
          onRequestClose={() => answer(false)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: colors.overlay,
              alignItems: "center",
              justifyContent: "center",
              padding: layout.pageGap,
            }}
          >
            <Animated.View
              role="alertdialog"
              aria-modal
              aria-label={shown?.title}
              style={{ width: "100%", maxWidth: 448, transform: [{ scale }] }}
            >
              {/* The menus' surface, lifted higher: the top layer of the app. */}
              <Card
                style={{
                  padding: space["3xl"],
                  gap: space.xl,
                  backgroundColor: colors.popover,
                  borderWidth: 1,
                  borderColor: colors.border,
                  boxShadow: elevation.dialog,
                }}
              >
                <Title level={2} style={{ fontSize: 24, lineHeight: 28 }}>
                  {shown?.title}
                </Title>
                {shown?.message && <Body muted>{shown.message}</Body>}
                <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.md }}>
                  <Button title="Cancel" variant="outline" onPress={() => answer(false)} />
                  <Button
                    title={shown?.confirmLabel ?? "Continue"}
                    destructive={shown?.destructive}
                    onPress={() => answer(true)}
                  />
                </View>
              </Card>
            </Animated.View>
          </View>
        </Modal>
      )}
    </>
  );
}
