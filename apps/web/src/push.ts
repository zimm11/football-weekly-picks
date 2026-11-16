import type { PushDevice, PushPreferences } from "@picks/shared";
import { api, unwrap } from "./api";

export type PushSupport = "supported" | "home-screen" | "unsupported";

export function pushSupport(): PushSupport {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios && !standalone) return "home-screen";
  return window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
    ? "supported"
    : "unsupported";
}

/** Register ahead of the button tap so the permission request itself stays inside the user gesture. */
export async function preparePush() {
  const registration = await navigator.serviceWorker.register("/push-sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  return registration;
}

export async function savePush(subscription: PushSubscription, preferences: PushPreferences) {
  const value = subscription.toJSON();
  if (!value.keys?.p256dh || !value.keys.auth)
    throw new Error("This browser couldn't create a notification subscription.");
  const result = await unwrap<{ device: PushDevice }>(
    api.push.device.$put({
      json: {
        endpoint: subscription.endpoint,
        keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
        ...preferences,
      },
    }),
  );
  return result.device;
}

/**
 * This browser's push subscription, if it has one. Some browsers expose service workers but refuse to use
 * them (private windows, blocked site data); they can't hold a subscription, so that reads as none rather
 * than as an error that would block signing in or out.
 */
async function currentSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return (await registration?.pushManager?.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Explicit sign-out must disconnect this browser, even if the API is temporarily unavailable. */
export async function disablePush(subscription?: PushSubscription | null) {
  const current = subscription ?? (await currentSubscription());
  if (!current) return;
  const results = await Promise.allSettled([
    unwrap(api.push.device.$delete({ json: { endpoint: current.endpoint } })),
    current.unsubscribe().then((ok) => {
      if (!ok) throw new Error("Couldn't disable browser notifications.");
    }),
  ]);
  if (results.every((r) => r.status === "rejected"))
    throw new Error("Couldn't turn off notifications. Check your connection and try again.");
}

/** Never carry another player's device subscription across an account switch on a shared browser. */
export async function reconcilePushAccount(
  lookup = (endpoint: string) =>
    unwrap<{ device: PushDevice | null }>(api.push.device.$post({ json: { endpoint } })),
) {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const { device } = await lookup(subscription.endpoint);
  if (!device && !(await subscription.unsubscribe()))
    throw new Error("Couldn't disconnect the previous account's notifications. Reload and try again.");
}
