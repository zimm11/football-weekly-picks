/**
 * Guards unsaved work against the browser itself: the back and forward buttons
 * (a phone's back gesture too) ask before leaving, and a reload or tab close gets the browser's own warning.
 *
 * The router hears `popstate` only after the URL has changed, and would leave the screen at once. This listener
 * is registered when the module loads, before the router's, so it can hold the event back, put the address the
 * player was on back in place and ask; on "Leave" it replays the step back.
 */
export function guardBrowserHistory(dirty: () => boolean, ask: () => Promise<boolean>) {
  if (typeof window === "undefined") return;
  const { history } = window;
  let current = { href: window.location.href, state: history.state as unknown };
  let replaying = false;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (state: unknown, unused: string, url?: string | URL | null) => {
      original(state, unused, url);
      current = { href: window.location.href, state: history.state };
    };
  }
  const push = History.prototype.pushState.bind(history);
  window.addEventListener("popstate", (event) => {
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
