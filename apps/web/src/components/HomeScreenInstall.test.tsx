import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { HomeScreenInstall } from "./HomeScreenInstall";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window.navigator, "standalone");
});

function displayMode(matches: boolean) {
  const mode = Object.assign(new EventTarget(), { matches });
  vi.spyOn(window, "matchMedia").mockReturnValue(mode as MediaQueryList);
  return mode;
}

describe("HomeScreenInstall", () => {
  it("opens platform instructions in place and returns to the same screen", async () => {
    displayMode(false);
    const path = window.location.href;
    const screen = await render(<HomeScreenInstall />);
    await screen.getByRole("button", { name: "Add to home screen" }).click();
    await expect.element(screen.getByRole("dialog", { name: "Add it to your home screen" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "iPhone or iPad · Safari" })).toBeVisible();
    await expect.element(screen.getByRole("heading", { name: "Android · Chrome" })).toBeVisible();
    expect(window.location.href).toBe(path);
    await screen.getByRole("button", { name: "Close", exact: true }).click();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Add to home screen" })).toHaveFocus();
  });

  it("hides the prompt when launched as a standalone app", async () => {
    displayMode(true);
    const screen = await render(<HomeScreenInstall />);
    await expect
      .element(screen.getByRole("complementary", { name: "Home screen app" }))
      .not.toBeInTheDocument();
  });

  it("also recognizes iOS standalone mode", async () => {
    displayMode(false);
    Object.defineProperty(window.navigator, "standalone", { configurable: true, value: true });
    const screen = await render(<HomeScreenInstall />);
    await expect
      .element(screen.getByRole("complementary", { name: "Home screen app" }))
      .not.toBeInTheDocument();
  });

  it("responds when the browser changes display mode", async () => {
    const mode = displayMode(false);
    const screen = await render(<HomeScreenInstall />);
    await expect.element(screen.getByRole("button", { name: "Add to home screen" })).toBeVisible();
    mode.matches = true;
    mode.dispatchEvent(new Event("change"));
    await expect.element(screen.getByRole("button", { name: "Add to home screen" })).not.toBeInTheDocument();
  });
});
