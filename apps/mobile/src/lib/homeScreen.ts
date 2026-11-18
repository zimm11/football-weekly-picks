import { Platform } from "react-native";

/*
 * Home-screen help for the browser build (AGENTS.md, "Home-screen help"). The native app is already on the
 * home screen, so on iOS and Android none of this shows: `homeScreenHelpAvailable` is false and offers are
 * ignored.
 */

/** Which set of home-screen steps applies to this browser. */
export type HomeScreenPlatform = "ios" | "android" | "other";

type NavigatorLike = Pick<Navigator, "userAgent" | "maxTouchPoints">;

export function detectPlatform(
  nav: NavigatorLike | undefined = typeof navigator === "undefined" ? undefined : navigator,
): HomeScreenPlatform {
  const ua = nav?.userAgent ?? "";
  // iPadOS Safari reports itself as a Mac; touch support gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav?.maxTouchPoints ?? 0) > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** iOS uses navigator.standalone; other browsers expose the app's display mode. */
export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    !!window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Whether a browser tab (not the installed web app, not the native app) should offer the steps. */
export function homeScreenHelpAvailable() {
  return Platform.OS === "web" && !isStandalone();
}

const OFFERED_KEY = "pow:home-screen-offered";

/**
 * True the first time it is called in this browser, then false forever after. Without storage it
 * returns false: better never to offer than to offer on every save.
 */
export function claimHomeScreenOffer(storage: Pick<Storage, "getItem" | "setItem"> | undefined = local()) {
  try {
    if (!storage || storage.getItem(OFFERED_KEY)) return false;
    storage.setItem(OFFERED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

function local(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** What the player just did that makes this a good moment to suggest the home screen. */
export type HomeScreenReason = "picks" | "pick" | "square";

/**
 * The offer sheet's lead-in: what just happened, then why the home screen helps. A squares board isn't played
 * week by week, so it doesn't say "next week".
 */
export function homeScreenOfferLead(reason: HomeScreenReason = "picks") {
  if (reason === "square") {
    return "Square claimed. Put POW Pick'em on your home screen so the board is one tap away.";
  }
  const saved = reason === "pick" ? "Pick saved." : "Picks saved.";
  return `${saved} Put POW Pick'em on your home screen so next week is one tap away.`;
}

const listeners = new Set<(reason: HomeScreenReason) => void>();

/**
 * A good moment to suggest the home screen: picks were just saved (the pick sheet, the default), a survivor
 * pick was ("pick"), or a square was claimed ("square"). The listener decides whether to.
 */
export function offerHomeScreen(reason: HomeScreenReason = "picks") {
  for (const listener of listeners) listener(reason);
}

export function onHomeScreenOffer(listener: (reason: HomeScreenReason) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
