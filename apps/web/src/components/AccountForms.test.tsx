import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { EmailChangeForm, NotificationSettingsForm } from "./AccountForms";

describe("EmailChangeForm", () => {
  it("shows the current address and won't 'change' to the same one", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const screen = await render(<EmailChangeForm currentEmail="fan@example.com" onSubmit={onSubmit} />);
    await expect.element(screen.getByLabelText("Current email")).toHaveValue("fan@example.com");
    await screen.getByLabelText("New email").fill("FAN@example.com");
    await screen.getByRole("button", { name: "Change email" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("That's already your email.");
    await screen.getByLabelText("New email").fill("new@example.com");
    await screen.getByRole("button", { name: "Change email" }).click();
    expect(onSubmit).toHaveBeenCalledWith("new@example.com");
  });
});

describe("NotificationSettingsForm", () => {
  it("saves each switch on its own, showing the change straight away", async () => {
    let finish: () => void = () => {};
    const onChange = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const screen = await render(
      <NotificationSettingsForm settings={{ newThreads: true, pickReminders: true }} onChange={onChange} />,
    );
    const threads = screen.getByRole("checkbox", { name: /New message threads/ });
    await threads.click();
    expect(onChange).toHaveBeenCalledWith({ newThreads: false });
    await expect.element(threads).not.toBeChecked();
    await expect.element(threads).toBeDisabled();
    finish();
    // The parent didn't pass new settings (as when a save fails), so the box goes back.
    await expect.element(threads).toBeChecked();
    await expect.element(threads).toBeEnabled();
  });
});
