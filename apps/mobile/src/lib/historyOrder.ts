/** The router's id for a browser history entry (`history.state.id`), if the state has one. */
export function entryIdOf(state: unknown) {
  const id = (state as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : undefined;
}

/**
 * Where the router's history entries sit relative to each other, learned from the `pushState` and
 * `replaceState` calls seen since the page loaded, so a `popstate` can tell Back from Forward (the browser
 * doesn't say). An entry pushed later always lies further forward: a push drops whatever was ahead of it.
 * Entries from before a reload are unknown, and count as Back.
 */
export function createHistoryOrder() {
  const order = new Map<string, number>();
  let last = 0;
  return {
    /** Records an entry written by `pushState` (on top) or `replaceState` (in the place of `from`). */
    wrote(kind: "push" | "replace", from: unknown, to: unknown) {
      const id = entryIdOf(to);
      if (!id || order.has(id)) return;
      const replaced = kind === "replace" ? order.get(entryIdOf(from) ?? "") : undefined;
      order.set(id, replaced ?? ++last);
    },
    /** Whether moving from one entry to the other went forward in the history. */
    isForward(from: unknown, to: unknown) {
      const before = order.get(entryIdOf(from) ?? "");
      const after = order.get(entryIdOf(to) ?? "");
      return before !== undefined && after !== undefined && after > before;
    },
  };
}
