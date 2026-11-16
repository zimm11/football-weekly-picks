import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { claimHomeScreenOffer, detectPlatform, offerHomeScreen } from "../lib/homeScreen";
import { HomeScreenSheet, useHomeScreenHelp } from "./HomeScreenInstall";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window.navigator, "standalone");
  localStorage.clear();
});

function displayMode(matches: boolean) {
  const mode = Object.assign(new EventTarget(), { matches });
  vi.spyOn(window, "matchMedia").mockReturnValue(mode as MediaQueryList);
  return mode;
}

function userAgent(ua: string) {
  vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(ua);
}

/** Stands in for App: an account-menu button plus the sheet. */
function Harness() {
  const help = useHomeScreenHelp();
  return (
    <>
      {help.available && (
        <button type="button" onClick={help.open}>
          Add to home screen
        </button>
      )}
      {help.sheet}
    </>
  );
}

describe("detectPlatform", () => {
  it("tells iPhone, iPad, Android and computers apart", () => {
    expect(detectPlatform({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe("ios");
    expect(detectPlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe("ios");
    expect(detectPlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe("other");
    expect(detectPlatform({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe("android");
    expect(detectPlatform({ userAgent: DESKTOP_CHROME, maxTouchPoints: 0 })).toBe("other");
  });
});

describe("claimHomeScreenOffer", () => {
  it("succeeds only once per browser", () => {
    expect(claimHomeScreenOffer()).toBe(true);
    expect(claimHomeScreenOffer()).toBe(false);
  });

  it("never offers when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(claimHomeScreenOffer()).toBe(false);
  });
});

describe("HomeScreenSheet", () => {
  it("shows only the player's own platform steps", async () => {
    const screen = await render(<HomeScreenSheet open onOpenChange={() => {}} platform="ios" />);
    await expect.element(screen.getByRole("heading", { name: "iPhone or iPad · Safari" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "Android · Chrome" })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Not now" })).not.toBeInTheDocument();
    // Installing is only half of it on iPhone: the steps end by pointing at notifications.
    await expect.element(screen.getByText(/open Settings from the account menu/)).toBeVisible();
  });

  it("shows every platform when it can't tell", async () => {
    const screen = await render(<HomeScreenSheet open onOpenChange={() => {}} platform="other" />);
    await expect.element(screen.getByRole("heading", { name: "iPhone or iPad · Safari" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "Android · Chrome" })).toBeVisible();
  });
});

describe("useHomeScreenHelp", () => {
  it("opens on request over the current screen", async () => {
    displayMode(false);
    const path = window.location.href;
    const screen = await render(<Harness />);
    await screen.getByRole("button", { name: "Add to home screen" }).click();
    await expect.element(screen.getByRole("dialog", { name: "Add it to your home screen" })).toBeVisible();
    expect(window.location.href).toBe(path);
    await screen.getByRole("button", { name: "Close", exact: true }).click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("offers itself once on a phone after picks are saved", async () => {
    displayMode(false);
    userAgent(ANDROID);
    const screen = await render(<Harness />);
    offerHomeScreen();
    await expect
      .element(screen.getByRole("dialog", { name: "Add it to your home screen" }))
      .toHaveAccessibleDescription(/^Picks saved\./);
    await expect.element(screen.getByRole("heading", { name: "Android · Chrome" })).toBeVisible();
    await screen.getByRole("button", { name: "Not now" }).click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    offerHomeScreen();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("doesn't offer itself on a computer", async () => {
    displayMode(false);
    userAgent(DESKTOP_CHROME);
    const screen = await render(<Harness />);
    offerHomeScreen();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    expect(claimHomeScreenOffer()).toBe(true);
  });

  it("hides the menu item and never offers in the home-screen app", async () => {
    displayMode(false);
    userAgent(IPHONE);
    Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true });
    const screen = await render(<Harness />);
    await expect.element(screen.getByRole("button", { name: "Add to home screen" })).not.toBeInTheDocument();
    offerHomeScreen();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("responds when the browser changes display mode", async () => {
    const mode = displayMode(false);
    const screen = await render(<Harness />);
    await expect.element(screen.getByRole("button", { name: "Add to home screen" })).toBeVisible();
    mode.matches = true;
    mode.dispatchEvent(new Event("change"));
    await expect.element(screen.getByRole("button", { name: "Add to home screen" })).not.toBeInTheDocument();
  });
});
