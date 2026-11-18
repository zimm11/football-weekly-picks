import { type ComponentRef, type Ref, useCallback, useEffect, useRef } from "react";
import type { ScrollView } from "react-native";

/** What a ScrollView's ref holds. */
type ScrollViewRef = ComponentRef<typeof ScrollView>;

import { createScrollMemory, notePop, offsetToRestore, rememberOffset, scrollKey } from "./scrollMemory";

/** How long a page that came back may take to grow tall enough before its old position is given up. */
const GIVE_UP_MS = 5000;

const memory = createScrollMemory();
/** The router gives every browser history entry an id (`history.state.id`). */
const entryId = () => {
  const id = (window.history.state as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : undefined;
};
// `popstate` is Back, Forward or history.go: the browser is already on the entry it moved to. When
// `browserGuard.web.ts` holds the step back (unsaved work, or a Back that only closes an open sheet, dialog or
// menu), it stops this event before it reaches here.
if (typeof window !== "undefined")
  window.addEventListener("popstate", () => notePop(memory, entryId(), Date.now()));

type Scrollable = { getScrollableNode?: () => unknown };
const elementOf = (node: unknown) => {
  const inner = (node as Scrollable | null)?.getScrollableNode?.() ?? node;
  return inner instanceof HTMLElement ? inner : undefined;
};

/**
 * Returns a scroll view to where it was when the browser's Back or Forward comes back to its page. The web
 * build shows one screen at a time (`FocusedOnly` in `app/_layout.tsx`), so a page reached again is rebuilt
 * from the top; this remembers each history entry's offset and scrolls back once the content is tall enough.
 * A page opened fresh (a link, a tab, a reload) starts at the top as before.
 *
 *   const scrollRef = useScrollRestore();            // or useScrollRestore(myRef) to keep using myRef
 *   <ScrollView ref={scrollRef}>…</ScrollView>        // a FlatList works too
 *
 * Call it in the component that renders the page's main vertical scroll view; that view may mount later than
 * the component (after a loading placeholder). A second scroll view on the same screen needs its own `name`.
 * Content that loads after the page mounts is waited for (up to five seconds, or until the player scrolls,
 * taps or types), so screens that draw from the load cache come back in place at once.
 */
export function useScrollRestore<T = ScrollViewRef>(ref?: Ref<T>, name = "page"): Ref<T> | undefined {
  // Decided once, as the screen mounts: was this history entry just reached by Back or Forward?
  const state = useRef<{ key?: string; target?: number; detach?: () => void }>(undefined);
  if (!state.current) {
    const entry = typeof window === "undefined" ? undefined : entryId();
    const target = offsetToRestore(memory, entry, name, Date.now());
    // Only a restored page knows its entry yet: a fresh page mounts before the router writes its entry.
    state.current = target === undefined ? {} : { key: scrollKey(entry as string, name), target };
  }
  useEffect(() => {
    const current = state.current;
    if (!current || current.key) return;
    // By the next task the router has pushed this page's history entry.
    const timer = setTimeout(() => {
      const entry = entryId();
      if (entry) current.key = scrollKey(entry, name);
    }, 0);
    return () => clearTimeout(timer);
  }, [name]);
  return useCallback(
    (node: T | null) => {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
      const current = state.current;
      if (!current) return;
      current.detach?.();
      current.detach = undefined;
      const element = elementOf(node);
      if (!element) return;
      const stops: (() => void)[] = [];
      const finish = () => {
        current.target = undefined;
        for (const stop of stops.splice(0)) stop();
      };
      const onScroll = () => {
        // While the old position is still being put back, the offsets passed through aren't the player's.
        if (current.key && current.target === undefined)
          rememberOffset(memory, current.key, element.scrollTop);
      };
      element.addEventListener("scroll", onScroll, { passive: true });
      if (current.target !== undefined) {
        const apply = () => {
          if (current.target === undefined) return;
          element.scrollTop = current.target;
          if (element.scrollTop >= current.target - 1) finish();
        };
        const observer = new ResizeObserver(apply);
        observer.observe(element);
        if (element.firstElementChild) observer.observe(element.firstElementChild);
        stops.push(() => observer.disconnect());
        // The player took over: don't pull the page out from under them.
        for (const type of ["wheel", "touchstart", "keydown", "mousedown"] as const) {
          window.addEventListener(type, finish, { passive: true, capture: true });
          stops.push(() => window.removeEventListener(type, finish, { capture: true }));
        }
        const timer = setTimeout(finish, GIVE_UP_MS);
        stops.push(() => clearTimeout(timer));
        apply();
      }
      current.detach = () => {
        element.removeEventListener("scroll", onScroll);
        for (const stop of stops.splice(0)) stop();
      };
    },
    [ref],
  );
}
