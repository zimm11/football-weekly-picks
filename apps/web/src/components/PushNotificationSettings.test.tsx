import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { PushNotificationSettings } from "./PushNotificationSettings";

const props = {
  support: "supported" as const,
  configured: true,
  enabled: false,
  denied: false,
  preferences: { newThreads: true, pickReminders: true },
  onEnable: vi.fn(async () => {}),
  onDisable: vi.fn(async () => {}),
  onSave: vi.fn(async () => {}),
};

describe("push settings", () => {
  it("asks for permission only after the player presses Enable", async () => {
    const enable = vi.fn(async () => {});
    const screen = await render(<PushNotificationSettings {...props} onEnable={enable} />);
    expect(enable).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Enable notifications", exact: true }).click();
    expect(enable).toHaveBeenCalledOnce();
  });
  it("saves preferences only after Save, and disables the form while saving", async () => {
    let resolve!: () => void;
    const save = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const screen = await render(<PushNotificationSettings {...props} enabled onSave={save} />);
    await expect.element(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled();
    await screen.getByRole("checkbox", { name: "New league threads" }).click();
    expect(save).not.toHaveBeenCalled();
    await screen.getByRole("button", { name: "Save preferences" }).click();
    expect(save).toHaveBeenCalledWith({ newThreads: false, pickReminders: true });
    await expect.element(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    resolve();
  });
  it("explains iPhone home-screen installation without offering an unusable permission button", async () => {
    const screen = await render(<PushNotificationSettings {...props} support="home-screen" />);
    await expect.element(screen.getByRole("heading", { name: "iPhone or iPad · Safari" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "Android · Chrome" })).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Enable notifications" }))
      .not.toBeInTheDocument();
  });
  it("explains denied permissions and unavailable configuration", async () => {
    const screen = await render(<PushNotificationSettings {...props} denied />);
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent("Notifications are blocked on this device.");
    await expect.element(screen.getByRole("button", { name: "Enable notifications" })).toBeDisabled();
    // How to unblock them stays folded away until asked for.
    const steps = screen.getByText(/Settings → Notifications → POW Pick'em/);
    await expect.element(steps).not.toBeVisible();
    await screen.getByText("How to turn them back on").click();
    await expect.element(steps).toBeVisible();
    await screen.unmount();
    const off = await render(<PushNotificationSettings {...props} configured={false} />);
    await expect.element(off.getByText(/Notifications aren't available yet/)).toBeVisible();
  });
  it("keeps an actionable error beside the control when subscribing fails", async () => {
    const screen = await render(
      <PushNotificationSettings
        {...props}
        onEnable={async () => {
          throw new Error("Permission was declined.");
        }}
      />,
    );
    await screen.getByRole("button", { name: "Enable notifications" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Permission was declined.");
  });
  it("turns off only this device", async () => {
    const disable = vi.fn(async () => {});
    const screen = await render(<PushNotificationSettings {...props} enabled onDisable={disable} />);
    await screen.getByRole("button", { name: "Turn off on this device" }).click();
    expect(disable).toHaveBeenCalledOnce();
  });
});
