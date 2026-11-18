import { useLayoutEffect, useReducer, useRef } from "react";
import { overlays } from "./overlayStack";
// The listener that hears Back is installed with the unsaved-work guard; make sure it is, wherever this is used.
import "./unsaved";

/**
 * Lets the browser's Back (a phone's back gesture too) close this overlay while `open`, instead of leaving the
 * page: `browserGuard.web.ts` holds the step back and calls `close`, the same close as the overlay's own ✕, so
 * its exit animation and focus return run as usual. The top-most open overlay closes first. Call it in every
 * sheet, dialog and menu (`BottomSheet`, `Popover`, the confirm dialog already do).
 *
 * Nothing touches the history while the overlay is open or when it closes by itself, so closing it any other
 * way leaves Back exactly as it was. An overlay that unmounts while open is taken off the stack too.
 */
export function useOverlayBack(open: boolean, close: () => void) {
  const latest = useRef(close);
  latest.current = close;
  // Back takes the overlay off the stack at once (a second quick Back goes on to the next one, or the page); if
  // it is still open afterwards because its close was refused (a sheet busy saving), it joins again.
  const [taken, retake] = useReducer((count: number) => count + 1, 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `taken` is the signal to join the stack again.
  useLayoutEffect(() => {
    if (!open) return;
    return overlays.open(() => latest.current(), retake);
  }, [open, taken]);
}
