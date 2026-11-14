import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MessageReactions } from "./MessageReactions";

describe("MessageReactions", () => {
  it("shows counts and selections and requests adding or removing the chosen emoji", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <MessageReactions reactions={[{ emoji: "👍", count: 2, reacted: true }]} onChange={onChange} />,
    );
    const like = screen.getByRole("button", { name: "Like, 2 reactions", exact: true });
    await expect.element(like).toHaveAttribute("aria-pressed", "true");
    await like.click();
    expect(onChange).toHaveBeenCalledWith("👍", false);
    await screen.getByRole("button", { name: "Laugh, 0 reactions", exact: true }).click();
    expect(onChange).toHaveBeenCalledWith("😂", true);
  });

  it("disables reactions while saving to prevent duplicate requests", async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const screen = await render(<MessageReactions reactions={[]} onChange={() => pending} />);
    await screen.getByRole("button", { name: "Like, 0 reactions", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Like, 0 reactions", exact: true }))
      .toHaveTextContent("👍Saving…");
    await expect
      .element(screen.getByRole("button", { name: "Laugh, 0 reactions", exact: true }))
      .toBeDisabled();
    finish();
    await expect
      .element(screen.getByRole("button", { name: "Like, 0 reactions", exact: true }))
      .toBeEnabled();
  });
});
