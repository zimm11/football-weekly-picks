import { useIsFocused, usePreventRemove } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { guardBrowserHistory } from "./browserGuard";
import { showConfirm } from "./confirm";

const drafts = new Map<symbol, () => void>();
/** The wording for leaving a screen with unsaved work by any route. */
const leavePrompt = {
  title: "Leave without saving?",
  message: "Your changes haven't been saved yet.",
  confirmLabel: "Leave",
  destructive: true,
};
// In a browser, the back and forward buttons and reloads ask too (a no-op in the native app).
guardBrowserHistory(
  () => drafts.size > 0,
  () => confirmDiscard(),
);
export function useUnsavedWork(dirty: boolean, onDiscard?: () => void) {
  const discardRef = useRef(onDiscard);
  discardRef.current = onDiscard;
  const focused = useIsFocused();
  useEffect(() => {
    if (!dirty || !focused) return;
    const id = Symbol();
    drafts.set(id, () => discardRef.current?.());
    return () => {
      drafts.delete(id);
    };
  }, [dirty, focused]);
}
/** Whether any screen holds unsaved work; lets navigation with nothing to lose happen in the same tap. */
export function hasUnsavedWork() {
  return drafts.size > 0;
}
export async function confirmDiscard(): Promise<boolean> {
  if (!drafts.size) return Promise.resolve(true);
  const confirmed = await showConfirm(leavePrompt);
  if (confirmed) for (const discard of drafts.values()) discard();
  return confirmed;
}

/** SDK 58's repeat callback releases prevention before replaying the blocked action. */
export function useRemovalGuard(dirty: boolean, busy = false) {
  const [discarded, setDiscarded] = useState(false);
  useEffect(() => {
    if (!dirty) setDiscarded(false);
  }, [dirty]);
  usePreventRemove(dirty && !discarded, ({ repeat }) => {
    if (busy) return;
    void showConfirm(leavePrompt).then((discard) => {
      if (discard) {
        setDiscarded(true);
        repeat();
      }
    });
  });
}
