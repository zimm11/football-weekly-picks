import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
const { claimHomeScreenOffer, detectPlatform } = await import("./homeScreen");
const { shouldOfferNotifications } = await import("./notificationsPrompt");

describe("detectPlatform", () => {
  it("tells iPhones, iPads posing as Macs, Android and everything else apart", () => {
    const nav = (userAgent: string, maxTouchPoints = 0) => ({ userAgent, maxTouchPoints });
    expect(detectPlatform(nav("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"))).toBe("ios");
    expect(detectPlatform(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5))).toBe("ios");
    expect(detectPlatform(nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"))).toBe("other");
    expect(detectPlatform(nav("Mozilla/5.0 (Linux; Android 15; Pixel 9)"))).toBe("android");
    expect(detectPlatform(undefined)).toBe("other");
  });
});

describe("claimHomeScreenOffer", () => {
  it("offers once per browser, and never without storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(claimHomeScreenOffer(storage)).toBe(true);
    expect(claimHomeScreenOffer(storage)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(claimHomeScreenOffer(broken)).toBe(false);
  });
});

describe("shouldOfferNotifications", () => {
  it("asks only a browser that could get notifications and hasn't been asked", () => {
    const base = { support: "supported", permission: "default", dismissed: false } as const;
    expect(shouldOfferNotifications(base)).toBe(true);
    expect(shouldOfferNotifications({ ...base, permission: "granted" })).toBe(false);
    expect(shouldOfferNotifications({ ...base, permission: "denied" })).toBe(false);
    expect(shouldOfferNotifications({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferNotifications({ ...base, support: "unsupported" })).toBe(false);
  });

  it("asks an iPhone browser tab, where the way to notifications is the home-screen app", () => {
    const tab = { support: "home-screen", permission: undefined, dismissed: false } as const;
    expect(shouldOfferNotifications(tab)).toBe(true);
    expect(shouldOfferNotifications({ ...tab, dismissed: true })).toBe(false);
  });
});
