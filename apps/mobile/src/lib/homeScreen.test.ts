import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
const { claimHomeScreenOffer, detectPlatform, homeScreenOfferLead, offerHomeScreen, onHomeScreenOffer } =
  await import("./homeScreen");
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

describe("the home-screen offer", () => {
  it("opens with what the player just did", () => {
    // The pick sheet's wording is what the E2E tests read: keep it as it is.
    expect(homeScreenOfferLead()).toBe(
      "Picks saved. Put POW Pick'em on your home screen so next week is one tap away.",
    );
    expect(homeScreenOfferLead("picks")).toBe(homeScreenOfferLead());
    expect(homeScreenOfferLead("pick")).toBe(
      "Pick saved. Put POW Pick'em on your home screen so next week is one tap away.",
    );
    // A square isn't a weekly thing.
    expect(homeScreenOfferLead("square")).toBe(
      "Square claimed. Put POW Pick'em on your home screen so the board is one tap away.",
    );
    expect(homeScreenOfferLead("square")).not.toMatch(/next week|Picks? saved/);
  });

  it("tells its listener why it is offering", () => {
    const seen: string[] = [];
    const stop = onHomeScreenOffer((reason) => seen.push(reason));
    offerHomeScreen();
    offerHomeScreen("pick");
    offerHomeScreen("square");
    stop();
    offerHomeScreen("square");
    expect(seen).toEqual(["picks", "pick", "square"]);
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
