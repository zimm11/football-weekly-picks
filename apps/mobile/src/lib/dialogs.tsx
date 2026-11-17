import { type ReactNode, useEffect, useRef, useState } from "react";
import { Modal, View } from "react-native";
import { Body, Button, Card, colors, Title } from "../components/ui";

type Prompt = { title: string; message?: string; confirmLabel?: string; destructive?: boolean };
let present: ((prompt: Prompt) => Promise<boolean>) | undefined;
export function showConfirm(prompt: Prompt): Promise<boolean> {
  return present?.(prompt) ?? Promise.resolve(false);
}
export function DialogProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<Prompt>();
  const pending = useRef<((answer: boolean) => void) | undefined>(undefined);
  useEffect(() => {
    const handler = (value: Prompt) =>
      new Promise<boolean>((resolve) => {
        pending.current?.(false);
        pending.current = resolve;
        setPrompt(value);
      });
    present = handler;
    return () => {
      if (present === handler) present = undefined;
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
      <Modal visible={!!prompt} transparent animationType="fade" onRequestClose={() => answer(false)}>
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
              <Title style={{ fontSize: 24, lineHeight: 28 }}>{prompt?.title}</Title>
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
