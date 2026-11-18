import { useIsFocused } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

export const APP_TITLE = "POW Pick'em";

/** The browser tab's title for a page: "Standings · Sunday Crew · POW Pick'em", or the app's name alone. */
export function pageTitle(title?: string | null) {
  const clean = title?.replace(/\s+/g, " ").trim();
  return clean ? `${clean} · ${APP_TITLE}` : APP_TITLE;
}

/** The titles the mounted, focused screens have asked for, oldest first. The newest names the tab. */
const asked = new Map<symbol, string>();
/** The title to show for a set of requests: the most recent one, or the app's name when there are none. */
export const titleFor = (titles: Iterable<string>) => pageTitle([...titles].at(-1));
function show() {
  if (typeof document !== "undefined") document.title = titleFor(asked.values());
}

/**
 * Names the browser tab (and its history entry and bookmark) for the screen that calls it:
 * `usePageTitle("Settings")` → "Settings · POW Pick'em". Join the parts of a nested page with " · ", most
 * specific first: `usePageTitle(`Week 3 · ${league.name}`)`.
 *
 * Pass undefined (or nothing) while the screen has no title to give yet (its data is loading) or another
 * component names the page: the tab then reads "POW Pick'em" unless someone else asked for a title. The title
 * is taken back when the screen unmounts or loses focus, so nothing stale is left behind, and a screen kept
 * under another never overwrites the one in front. Call it once per screen, in the component that knows the
 * title, before any early return. Does nothing on iPhone.
 *
 * A page behind sign-in reads "Sign in" while the form stands in for it: the route file does that with
 * `useGatedPageTitle` (`lib/gatedTitle.ts`), so screens only name themselves.
 */
export function usePageTitle(title?: string | null) {
  const focused = useIsFocused();
  useEffect(() => {
    if (Platform.OS !== "web" || !focused || !title?.trim()) return;
    const id = Symbol();
    asked.set(id, title);
    show();
    return () => {
      asked.delete(id);
      show();
    };
  }, [title, focused]);
}
