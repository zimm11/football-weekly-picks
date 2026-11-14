import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { FeedbackForm } from "./FeedbackForm";

describe("FeedbackForm", () => {
  it("sends the kind and the trimmed message, then clears the form", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const screen = await render(<FeedbackForm onSubmit={onSubmit} onCancel={() => {}} />);
    await screen.getByRole("combobox", { name: "What kind of feedback?" }).selectOptions("Feature request");
    const message = screen.getByRole("textbox", { name: "What would you like the app to do?" });
    await message.fill("  Show playoff weeks  ");
    await screen.getByRole("button", { name: "Send feedback" }).click();
    expect(onSubmit).toHaveBeenCalledWith({ kind: "feature", message: "Show playoff weeks" });
    await expect.element(message).toHaveValue("");
  });

  it("won't send an empty message", async () => {
    const screen = await render(<FeedbackForm onSubmit={vi.fn()} onCancel={() => {}} />);
    await expect.element(screen.getByRole("button", { name: "Send feedback" })).toBeDisabled();
    await screen
      .getByRole("textbox", { name: "What happened, and what did you expect instead?" })
      .fill("   ");
    await expect.element(screen.getByRole("button", { name: "Send feedback" })).toBeDisabled();
  });

  it("keeps the message and shows the error when sending fails", async () => {
    const onSubmit = vi.fn().mockResolvedValue("Try again tomorrow.");
    const screen = await render(<FeedbackForm onSubmit={onSubmit} onCancel={() => {}} />);
    const message = screen.getByRole("textbox", { name: "What happened, and what did you expect instead?" });
    await message.fill("The save button does nothing");
    await screen.getByRole("button", { name: "Send feedback" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Try again tomorrow.");
    await expect.element(message).toHaveValue("The save button does nothing");
  });
});
