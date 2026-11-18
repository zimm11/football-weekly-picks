import { useSyncExternalStore } from "react";
import { type FocusedField, opensKeyboard } from "./softKeyboardField";

/**
 * Whether a phone's on-screen keyboard is up: a text field has the focus on a touch screen. A phone browser
 * keeps the page's bottom edge just above the keyboard, so anything pinned there (the league's tab bar) would
 * ride up with it; screens hide such things while this is true. A computer's keyboard is never on screen.
 */
function snapshot(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  if (!window.matchMedia?.("(pointer: coarse)").matches) return false;
  return opensKeyboard(document.activeElement as FocusedField | null);
}

function subscribe(changed: () => void) {
  // Moving between fields blurs one before focusing the next: read the focus once both have happened, so the
  // tab bar doesn't flash back in between. A tap on a button moves the focus on the way down: wait until the
  // tap's click has landed, or the bar coming back would move the button out from under the finger.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pressing = false;
  let pending = false;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(changed, 0);
  };
  const down = () => {
    pressing = true;
  };
  const up = () => {
    pressing = false;
    if (pending) {
      pending = false;
      later();
    }
  };
  const moved = () => {
    if (pressing) pending = true;
    else later();
  };
  document.addEventListener("focusin", moved);
  document.addEventListener("focusout", moved);
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
  return () => {
    clearTimeout(timer);
    document.removeEventListener("focusin", moved);
    document.removeEventListener("focusout", moved);
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("pointercancel", up, true);
  };
}

export function useSoftKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
