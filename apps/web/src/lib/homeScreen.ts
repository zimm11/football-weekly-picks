/** Which set of home-screen steps applies to this browser. */
export type HomeScreenPlatform = "ios" | "android" | "other";

type NavigatorLike = Pick<Navigator, "userAgent" | "maxTouchPoints">;

export function detectPlatform(nav: NavigatorLike = navigator): HomeScreenPlatform {
  const ua = nav.userAgent;
  // iPadOS Safari reports itself as a Mac; touch support gives it away.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** iOS uses navigator.standalone; other browsers expose the app's display mode. */
export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

const OFFERED_KEY = "pow:home-screen-offered";

/**
 * True the first time it is called in this browser, then false forever after. Without storage it
 * returns false: better never to offer than to offer on every save.
 */
export function claimHomeScreenOffer(): boolean {
  try {
    if (localStorage.getItem(OFFERED_KEY)) return false;
    localStorage.setItem(OFFERED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();

/** A good moment to suggest the home screen (picks were just saved). The listener decides whether to. */
export function offerHomeScreen() {
  for (const listener of listeners) listener();
}

export function onHomeScreenOffer(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
