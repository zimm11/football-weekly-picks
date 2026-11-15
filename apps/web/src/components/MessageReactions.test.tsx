import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MessageReactions } from "./MessageReactions";

describe("MessageReactions", () => {
  it("shows only the emoji a message already has, with counts and your selections", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <MessageReactions reactions={[{ emoji: "👍", count: 2, reacted: true }]} onChange={onChange} />,
    );
    const like = screen.getByRole("button", { name: "Like, 2 reactions", exact: true });
    await expect.element(like).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByRole("button", { name: /Laugh/ })).not.toBeInTheDocument();
    await expect.element(screen.getByRole("menuitemcheckbox")).not.toBeInTheDocument();
    await like.click();
    expect(onChange).toHaveBeenCalledWith("👍", false);
  });

  it("offers every emoji from the React button and marks the ones you chose", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    const screen = await render(
      <MessageReactions reactions={[{ emoji: "👍", count: 2, reacted: true }]} onChange={onChange} />,
    );
    await screen.getByRole("button", { name: "Add reaction" }).click();
    await expect.element(screen.getByRole("menuitemcheckbox")).toHaveLength(7);
    await expect.element(screen.getByRole("menuitemcheckbox", { name: "Like" })).toBeChecked();
    await screen.getByRole("menuitemcheckbox", { name: "Laugh" }).click();
    expect(onChange).toHaveBeenCalledWith("😂", true);
    await expect.element(screen.getByRole("menuitemcheckbox")).not.toBeInTheDocument();
  });

  it("disables reactions while saving to prevent duplicate requests", async () => {
    let finish: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const screen = await render(
      <MessageReactions reactions={[{ emoji: "😂", count: 1, reacted: false }]} onChange={() => pending} />,
    );
    await screen.getByRole("button", { name: "Add reaction" }).click();
    await screen.getByRole("menuitemcheckbox", { name: "Like" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Like, 0 reactions", exact: true }))
      .toHaveTextContent("👍Saving…");
    await expect
      .element(screen.getByRole("button", { name: "Laugh, 1 reactions", exact: true }))
      .toBeDisabled();
    await expect.element(screen.getByRole("button", { name: "Add reaction" })).toBeDisabled();
    finish();
    await expect.element(screen.getByRole("button", { name: "Add reaction" })).toBeEnabled();
    await expect.element(screen.getByRole("button", { name: /Like/ })).not.toBeInTheDocument();
  });
});
