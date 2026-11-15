import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { Splash } from "./Splash";

describe("Splash", () => {
  it("shows the brand while loading, as one status region", async () => {
    const screen = await render(<Splash />);
    const status = screen.getByRole("status", { name: "Opening POW Pick'em" });
    await expect.element(status).toBeVisible();
    await expect.element(status).toHaveTextContent("POWPick'em Getting your leagues ready…");
    await expect.element(screen.getByText("Welcome back")).not.toBeInTheDocument();
  });

  it("greets the player by first name once the profile has loaded", async () => {
    const screen = await render(<Splash name="Pat  Mahomes" />);
    await expect.element(screen.getByText("Welcome back, Pat")).toBeVisible();
  });
});
