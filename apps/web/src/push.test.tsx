import { afterEach, describe, expect, it, vi } from "vitest";
import { disablePush, reconcilePushAccount } from "./push";

afterEach(() => vi.restoreAllMocks());
function browserSubscription() {
  const unsubscribe = vi.fn(async () => true);
  const sub = { endpoint: "https://web.push.apple.com/test", unsubscribe };
  vi.spyOn(navigator.serviceWorker, "getRegistration").mockResolvedValue({
    pushManager: { getSubscription: async () => sub },
  } as unknown as ServiceWorkerRegistration);
  return { unsubscribe, sub };
}
describe("shared-browser push subscriptions", () => {
  it("keeps this account's existing subscription without requesting permission", async () => {
    const { unsubscribe, sub } = browserSubscription();
    const lookup = vi.fn(async () => ({ device: { id: "device", newThreads: true, pickReminders: true } }));
    await reconcilePushAccount(lookup);
    expect(lookup).toHaveBeenCalledWith(sub.endpoint);
    expect(unsubscribe).not.toHaveBeenCalled();
  });
  it("invalidates a previous account's subscription even when browser storage has been cleared", async () => {
    const { unsubscribe } = browserSubscription();
    await reconcilePushAccount(async () => ({ device: null }));
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("treats a browser that refuses service workers as having no subscription", async () => {
    vi.spyOn(navigator.serviceWorker, "getRegistration").mockRejectedValue(new Error("insecure"));
    const lookup = vi.fn(async () => ({ device: null }));
    await reconcilePushAccount(lookup);
    await disablePush();
    expect(lookup).not.toHaveBeenCalled();
  });
  it("never touches the service worker API in an iPhone browser tab, where push can't work", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
    );
    const getRegistration = vi.spyOn(navigator.serviceWorker, "getRegistration");
    const lookup = vi.fn(async () => ({ device: null }));
    await reconcilePushAccount(lookup);
    await disablePush();
    expect(getRegistration).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
  it("does not silently ignore a failed unsubscribe during an account switch", async () => {
    const { unsubscribe } = browserSubscription();
    unsubscribe.mockResolvedValue(false);
    await expect(reconcilePushAccount(async () => ({ device: null }))).rejects.toThrow("Couldn't disconnect");
  });
});
