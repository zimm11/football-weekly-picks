/**
 * The overlays open right now (bottom sheets, the confirm dialog, menus), the top-most last, so the browser's
 * Back can close the top one instead of leaving the page (`browserGuard.web.ts`). Overlays join it through
 * `useOverlayBack` (`lib/overlayBack.web.ts`); this file holds only the bookkeeping, so it is tested on its own.
 */
export type OverlayStack = ReturnType<typeof createOverlayStack>;

export function createOverlayStack() {
  const entries: { id: symbol; close: () => void; taken: () => void }[] = [];
  return {
    /**
     * Adds an open overlay on top. `close` closes it as its own ✕ does; `taken` hears that Back took it off the
     * stack (so it can come back if its close was refused). Returns how to take it off without closing it.
     */
    open(close: () => void, taken: () => void = () => {}) {
      const id = Symbol();
      entries.push({ id, close, taken });
      return () => {
        const index = entries.findIndex((entry) => entry.id === id);
        if (index >= 0) entries.splice(index, 1);
      };
    },
    get size() {
      return entries.length;
    },
    /**
     * Closes the top overlay, taking it off the stack at once, so a second Back pressed before the screen has
     * re-rendered reaches the next overlay or the page. Returns whether there was one.
     */
    closeTop() {
      const top = entries.pop();
      if (!top) return false;
      top.close();
      top.taken();
      return true;
    },
    /** Closes every overlay, the top first (the page is changing under them). */
    closeAll() {
      while (this.closeTop()) {}
    },
  };
}

/** The app's one stack of open overlays. */
export const overlays = createOverlayStack();
