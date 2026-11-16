import type { PushDevice, PushPreferences } from "@picks/shared";
import { api, isConnectionError, unwrap } from "./api";

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

/**
 * Who turned notifications on in this browser, and with which preferences. Kept so a subscription the browser
 * replaced on its own can be registered again for the same player, and only for them (see
 * `reconcilePushAccount`). No storage means no record, and an unknown subscription is then disconnected.
 */
const OWNER_KEY = "pow:push-owner";
type PushOwner = PushPreferences & { userId: string };

function readOwner(): PushOwner | null {
  try {
    const value = JSON.parse(localStorage.getItem(OWNER_KEY) ?? "null") as PushOwner | null;
    return typeof value?.userId === "string" ? value : null;
  } catch {
    return null;
  }
}

function writeOwner(owner: PushOwner | null) {
  try {
    if (owner) localStorage.setItem(OWNER_KEY, JSON.stringify(owner));
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Without storage, a replaced subscription is disconnected instead of registered again.
  }
}

/**
 * Saves this browser's subscription for the signed-in player. `oldEndpoint` names a subscription the browser
 * replaced, so the server swaps that row out (keeping its preferences) instead of leaving a dead one.
 */
export async function savePush(
  subscription: PushSubscription,
  preferences: PushPreferences,
  userId: string,
  oldEndpoint?: string,
) {
  const value = subscription.toJSON();
  if (!value.keys?.p256dh || !value.keys.auth)
    throw new Error("This browser couldn't create a notification subscription.");
  const result = await unwrap<{ device: PushDevice }>(
    api.push.device.$put({
      json: {
        endpoint: subscription.endpoint,
        keys: { p256dh: value.keys.p256dh, auth: value.keys.auth },
        ...preferences,
        ...(oldEndpoint && oldEndpoint !== subscription.endpoint ? { oldEndpoint } : {}),
      },
    }),
  );
  writeOwner({ userId, newThreads: result.device.newThreads, pickReminders: result.device.pickReminders });
  return result.device;
}

/**
 * Where the service worker leaves the endpoint it replaced on `pushsubscriptionchange` (see `push-sw.js`).
 * It has no sign-in to tell the server itself, so the app does: right away if it is open, else when it next
 * opens.
 */
const ROTATION_CACHE = "pow-push-rotation";
const ROTATION_PATH = "/push-rotation";

async function takeRotation(): Promise<string | undefined> {
  try {
    if (!(await caches.has(ROTATION_CACHE))) return undefined;
    const cache = await caches.open(ROTATION_CACHE);
    const record = (await (await cache.match(ROTATION_PATH))?.json()) as
      | { oldEndpoint?: unknown }
      | undefined;
    await caches.delete(ROTATION_CACHE);
    return typeof record?.oldEndpoint === "string" ? record.oldEndpoint : undefined;
  } catch {
    return undefined;
  }
}

/**
 * This browser's push subscription, if it has one. Where push can't work (an iPhone browser tab, a browser
 * without push) there can't be one, so the service worker API isn't touched at all: every sign-in and sign-out
 * asks. Some browsers expose service workers but refuse to use them (private windows, blocked site data); that
 * reads as none too, rather than as an error that would block signing in or out.
 */
async function currentSubscription() {
  if (pushSupport() !== "supported") return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    return (await registration?.pushManager?.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Explicit sign-out must disconnect this browser, even if the API is temporarily unavailable. */
export async function disablePush(subscription?: PushSubscription | null) {
  writeOwner(null);
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

type ReconcileDeps = {
  lookup: (endpoint: string) => Promise<{ device: PushDevice | null }>;
  save: typeof savePush;
};
const defaultDeps: ReconcileDeps = {
  lookup: (endpoint) => unwrap<{ device: PushDevice | null }>(api.push.device.$post({ json: { endpoint } })),
  save: savePush,
};

/**
 * Brings this browser's subscription in line with the signed-in player. Runs on every app open (alongside
 * loading the app, never ahead of it) and when the service worker reports a replaced subscription.
 *
 * - The server has it for this player: nothing to do.
 * - It doesn't, but this player turned notifications on in this browser (the browser replaced the
 *   subscription, or the server dropped it after a failed send): it is registered again with their
 *   preferences, replacing the old endpoint if the service worker recorded one.
 * - Otherwise it was another account's (a shared browser) or nobody's we know of: it is disconnected, so
 *   nobody gets another account's notifications. The server also refuses to move one account's endpoint to
 *   another.
 *
 * Being offline leaves everything for next time. Throws only when a subscription that must be disconnected
 * can't be.
 */
export async function reconcilePushAccount(userId: string, deps: Partial<ReconcileDeps> = {}) {
  const { lookup, save } = { ...defaultDeps, ...deps };
  const subscription = await currentSubscription();
  if (!subscription) return;
  let device: PushDevice | null;
  try {
    ({ device } = await lookup(subscription.endpoint));
  } catch {
    return;
  }
  const oldEndpoint = await takeRotation();
  if (device) return;
  const owner = readOwner();
  if (owner?.userId === userId) {
    try {
      await save(
        subscription,
        { newThreads: owner.newThreads, pickReminders: owner.pickReminders },
        userId,
        oldEndpoint,
      );
      return;
    } catch (err) {
      if (isConnectionError(err)) return;
      // The server won't take it for this player, so it isn't theirs: disconnect it below.
    }
  }
  writeOwner(null);
  if (!(await subscription.unsubscribe()))
    throw new Error("Couldn't disconnect the previous account's notifications. Reload and try again.");
}

/** Runs `onChange` when the service worker reports that the browser replaced this device's subscription. */
export function onPushSubscriptionChange(onChange: () => void): () => void {
  if (pushSupport() !== "supported") return () => {};
  const listener = (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type === "push-subscription-changed") onChange();
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
