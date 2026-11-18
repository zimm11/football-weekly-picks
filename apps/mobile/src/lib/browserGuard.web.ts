import { createHistoryOrder } from "./historyOrder";
import { overlays } from "./overlayStack";

/**
 * Guards the page against the browser itself: the back and forward buttons (a phone's back gesture too) close
 * the top open overlay (a sheet, the confirm dialog, a menu) or ask before leaving unsaved work, and a reload or
 * tab close gets the browser's own warning.
 *
 * The router hears `popstate` only after the URL has changed, and would leave the screen at once. This listener
 * is registered when the module loads, before the router's, so it can hold the event back and put the address
 * the player was on back in place (re-pushing it, which drops any Forward history, as a link would). Then it
 * closes the top overlay, or asks about the unsaved work and on "Leave" replays the step back. With nothing open
 * and nothing unsaved, the event goes on untouched to the router and the scroll memory.
 *
 * Steps the app takes itself (`history.back()`/`go()`, as `router.back()` does) are never taken for a request to
 * close an overlay, and neither is Forward: the overlays close and the page moves on. (Back from the entry the
 * page loaded on leaves the document, which no page can hold; `beforeunload` covers unsaved work there.)
 */
export function guardBrowserHistory(dirty: () => boolean, ask: () => Promise<boolean>) {
  if (typeof window === "undefined") return;
  const { history } = window;
  const order = createHistoryOrder();
  let current = { href: window.location.href, state: history.state as unknown };
  let replaying = false;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (state: unknown, unused: string, url?: string | URL | null) => {
      original(state, unused, url);
      order.wrote(method === "pushState" ? "push" : "replace", current.state, history.state);
      current = { href: window.location.href, state: history.state };
    };
  }
  // The app's own steps through history. A step that can't be taken fires no `popstate`, so the count lapses.
  let ownSteps = 0;
  let lapse: ReturnType<typeof setTimeout> | undefined;
  for (const method of ["back", "forward", "go"] as const) {
    const original = history[method].bind(history) as (delta?: number) => void;
    history[method] = (delta?: number) => {
      ownSteps += 1;
      clearTimeout(lapse);
      lapse = setTimeout(() => {
        ownSteps = 0;
      }, 500);
      original(delta);
    };
  }
  const push = History.prototype.pushState.bind(history);
  window.addEventListener("popstate", (event) => {
    const own = ownSteps > 0;
    if (own) ownSteps -= 1;
    if (!replaying && overlays.size) {
      // The page is moving on: nothing is left open over it (the confirm dialog lives above every screen).
      if (own || order.isForward(current.state, history.state)) overlays.closeAll();
      else {
        event.stopImmediatePropagation();
        push(current.state, "", current.href);
        overlays.closeTop();
        return;
      }
    }
    if (replaying || !dirty()) {
      replaying = false;
      current = { href: window.location.href, state: history.state };
      return;
    }
    event.stopImmediatePropagation();
    const stay = current;
    push(stay.state, "", stay.href);
    void ask().then((leave) => {
      if (!leave) return;
      replaying = true;
      // Let the discarded drafts re-render (and release the router's own guard) before stepping back.
      setTimeout(() => history.back(), 0);
    });
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty()) event.preventDefault();
  });
}
