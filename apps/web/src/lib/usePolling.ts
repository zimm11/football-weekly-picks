import { useEffect, useRef } from "react";

/**
 * Calls `refresh` every `ms` while the page is on screen, and once as soon as the player comes back to a tab
 * that was hidden. Nothing runs while the tab is hidden or `enabled` is false, so a forgotten tab makes no
 * requests. `refresh` may change every render; the latest one is called.
 */
export function usePolling(refresh: () => void, ms: number, enabled = true) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      timer ??= setInterval(() => latest.current(), ms);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        latest.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms, enabled]);
}
