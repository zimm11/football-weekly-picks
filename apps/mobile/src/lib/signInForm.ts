import { useIsFocused } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether the screen in front is already showing the sign-in form in place of its content (a signed-out visit
 * to a page that needs an account, or `/login`). The header reads it to leave out its own "Sign in" link, which
 * would only swap the page the visitor asked for with `/login`.
 */
let shown = 0;
const listeners = new Set<() => void>();
function change(by: number) {
  shown += by;
  for (const listener of listeners) listener();
}

/** Called by the sign-in form's screen: counts while `active` and the screen is the focused one. */
export function useShowsSignInForm(active: boolean) {
  const focused = useIsFocused();
  useEffect(() => {
    if (!active || !focused) return;
    change(1);
    return () => change(-1);
  }, [active, focused]);
}

/** True while the focused screen shows the sign-in form in place. */
export function useSignInFormShown() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => shown > 0,
    () => false,
  );
}
