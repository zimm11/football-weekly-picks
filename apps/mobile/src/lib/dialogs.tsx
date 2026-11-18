import { type ReactNode, useEffect, useRef, useState } from "react";
import { Modal, View } from "react-native";
import { Body, Button, Card, colors, Title } from "../components/ui";
import { type ConfirmPrompt, setConfirmPresenter } from "./confirm";
import { useReducedMotion } from "./motion";

// `showConfirm` lives in ./confirm (no interface code there); it is re-exported for the screens that import
// it from here.
export { showConfirm } from "./confirm";
export function DialogProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<ConfirmPrompt>();
  const pending = useRef<((answer: boolean) => void) | undefined>(undefined);
  const reduced = useReducedMotion();
  useEffect(() => {
    const remove = setConfirmPresenter(
      (value) =>
        new Promise<boolean>((resolve) => {
          pending.current?.(false);
          pending.current = resolve;
          setPrompt(value);
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
  return (
    <>
      {children}
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
            padding: 20,
          }}
        >
          <View
            role="alertdialog"
            aria-modal
            aria-label={prompt?.title}
            style={{ width: "100%", maxWidth: 448 }}
          >
            <Card style={{ padding: 24, gap: 16 }}>
              <Title level={2} style={{ fontSize: 24, lineHeight: 28 }}>
                {prompt?.title}
              </Title>
              {prompt?.message && <Body muted>{prompt.message}</Body>}
              <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
                <Button title="Cancel" variant="outline" onPress={() => answer(false)} />
                <Button
                  title={prompt?.confirmLabel ?? "Continue"}
                  destructive={prompt?.destructive}
                  onPress={() => answer(true)}
                />
              </View>
            </Card>
          </View>
        </View>
      </Modal>
    </>
  );
}
