import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  NotificationsPrompt,
  NotificationsPromptView,
  shouldOfferNotifications,
} from "./NotificationsPrompt";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("shouldOfferNotifications", () => {
  it("asks only a device that could get notifications and hasn't been asked", () => {
    const base = { support: "supported", permission: "default", dismissed: false } as const;
    expect(shouldOfferNotifications(base)).toBe(true);
    // Once the browser has asked, Settings is the place to change it.
    expect(shouldOfferNotifications({ ...base, permission: "granted" })).toBe(false);
    expect(shouldOfferNotifications({ ...base, permission: "denied" })).toBe(false);
    expect(shouldOfferNotifications({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferNotifications({ ...base, support: "unsupported" })).toBe(false);
  });

  it("asks an iPhone browser tab, where the way to notifications is the home-screen app", () => {
    expect(
      shouldOfferNotifications({ support: "home-screen", permission: undefined, dismissed: false }),
    ).toBe(true);
    expect(shouldOfferNotifications({ support: "home-screen", permission: undefined, dismissed: true })).toBe(
      false,
    );
  });
});

describe("NotificationsPrompt", () => {
  it("points at Settings and can be put off", async () => {
    const onDismiss = vi.fn();
    const screen = await render(<NotificationsPromptView onDismiss={onDismiss} />);
    await expect.element(screen.getByRole("link", { name: "Turn on" })).toHaveAttribute("href", "/account");
    await screen.getByRole("button", { name: "Not now" }).click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("stays away for good once put off", async () => {
    vi.spyOn(Notification, "permission", "get").mockReturnValue("default");
    const first = await render(<NotificationsPrompt />);
    await first.getByRole("button", { name: "Not now" }).click();
    await expect.element(first.getByRole("region", { name: "Pick reminders" })).not.toBeInTheDocument();
    await first.unmount();
    const again = await render(<NotificationsPrompt />);
    await expect.element(again.getByRole("region", { name: "Pick reminders" })).not.toBeInTheDocument();
  });
});
