import type { PushDevice } from "@picks/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_ERROR } from "./api";
import { disablePush, reconcilePushAccount, savePush } from "./push";

const ME = "player-1";
const OTHER = "player-2";
const OWNER_KEY = "pow:push-owner";
const device: PushDevice = { id: "device", newThreads: true, pickReminders: false };

beforeEach(() => localStorage.removeItem(OWNER_KEY));
afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.removeItem(OWNER_KEY);
  await caches.delete("pow-push-rotation");
});

function browserSubscription(endpoint = "https://web.push.apple.com/test") {
  const unsubscribe = vi.fn(async () => true);
  const sub = { endpoint, unsubscribe } as unknown as PushSubscription & { unsubscribe: typeof unsubscribe };
  vi.spyOn(navigator.serviceWorker, "getRegistration").mockResolvedValue({
    pushManager: { getSubscription: async () => sub },
  } as unknown as ServiceWorkerRegistration);
  return { unsubscribe, sub };
}
const ownedBy = (userId: string) =>
  localStorage.setItem(OWNER_KEY, JSON.stringify({ userId, newThreads: false, pickReminders: true }));
const unknown = async () => ({ device: null });

describe("reconcilePushAccount", () => {
  it("keeps this account's existing subscription without requesting permission", async () => {
    const { unsubscribe, sub } = browserSubscription();
    const lookup = vi.fn(async () => ({ device }));
    const save = vi.fn();
    await reconcilePushAccount(ME, { lookup, save });
    expect(lookup).toHaveBeenCalledWith(sub.endpoint);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("registers a replaced subscription again for the player who turned notifications on here", async () => {
    const { unsubscribe, sub } = browserSubscription("https://web.push.apple.com/new");
    ownedBy(ME);
    // What the service worker leaves behind on `pushsubscriptionchange`.
    await (await caches.open("pow-push-rotation")).put(
      "/push-rotation",
      new Response(JSON.stringify({ oldEndpoint: "https://web.push.apple.com/old" })),
    );
    const save = vi.fn(async () => device);
    await reconcilePushAccount(ME, { lookup: unknown, save });
    expect(save).toHaveBeenCalledWith(
      sub,
      { newThreads: false, pickReminders: true },
      ME,
      "https://web.push.apple.com/old",
    );
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(await caches.has("pow-push-rotation")).toBe(false);
  });

  it("disconnects another account's subscription on a shared browser", async () => {
    const { unsubscribe } = browserSubscription();
    ownedBy(OTHER);
    const save = vi.fn();
    await reconcilePushAccount(ME, { lookup: unknown, save });
    expect(save).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it("disconnects an unknown subscription when browser storage has been cleared", async () => {
    const { unsubscribe } = browserSubscription();
    await reconcilePushAccount(ME, { lookup: unknown, save: vi.fn() });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("disconnects the subscription when the server won't take it for this player", async () => {
    const { unsubscribe } = browserSubscription();
    ownedBy(ME);
    const save = vi.fn(async () => {
      throw new Error("This browser is subscribed to another account.");
    });
    await reconcilePushAccount(ME, { lookup: unknown, save });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("leaves everything alone while offline", async () => {
    const { unsubscribe } = browserSubscription();
    ownedBy(ME);
    const offline = async () => {
      throw new Error(CONNECTION_ERROR);
    };
    await reconcilePushAccount(ME, { lookup: offline, save: vi.fn() });
    await reconcilePushAccount(ME, { lookup: unknown, save: offline });
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem(OWNER_KEY)).not.toBeNull();
  });

  it("treats a browser that refuses service workers as having no subscription", async () => {
    vi.spyOn(navigator.serviceWorker, "getRegistration").mockRejectedValue(new Error("insecure"));
    const lookup = vi.fn(unknown);
    await reconcilePushAccount(ME, { lookup });
    await disablePush();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("never touches the service worker API in an iPhone browser tab, where push can't work", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    );
    const getRegistration = vi.spyOn(navigator.serviceWorker, "getRegistration");
    const lookup = vi.fn(unknown);
    await reconcilePushAccount(ME, { lookup });
    await disablePush();
    expect(getRegistration).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not silently ignore a failed unsubscribe during an account switch", async () => {
    const { unsubscribe } = browserSubscription();
    unsubscribe.mockResolvedValue(false);
    await expect(reconcilePushAccount(ME, { lookup: unknown })).rejects.toThrow("Couldn't disconnect");
  });
});

describe("savePush and disablePush", () => {
  it("remember who turned notifications on here, until they are turned off", async () => {
    const sub = {
      endpoint: "https://web.push.apple.com/test",
      toJSON: () => ({ keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription;
    const fetch = vi
      .spyOn(window, "fetch")
      .mockImplementation(async (input) =>
        String(input).includes("/api/config")
          ? Response.json({ supabaseUrl: "http://localhost:1", supabasePublishableKey: "test" })
          : Response.json({ device }),
      );
    await savePush(sub, { newThreads: true, pickReminders: false }, ME);
    expect(JSON.parse(localStorage.getItem(OWNER_KEY) ?? "null")).toEqual({
      userId: ME,
      newThreads: true,
      pickReminders: false,
    });
    await disablePush(sub);
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
    expect(fetch).toHaveBeenCalled();
  });
});
