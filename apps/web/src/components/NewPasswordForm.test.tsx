import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { NewPasswordForm } from "./NewPasswordForm";

async function fill(
  onSubmit: (password: string) => Promise<string | undefined>,
  password: string,
  confirm: string,
) {
  const screen = await render(<NewPasswordForm onSubmit={onSubmit} />);
  await screen.getByLabelText("New password", { exact: true }).fill(password);
  await screen.getByLabelText("Confirm new password").fill(confirm);
  await screen.getByRole("button", { name: "Save password" }).click();
  return screen;
}

describe("NewPasswordForm", () => {
  it("submits the new password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    await fill(onSubmit, "touchdown7", "touchdown7");
    expect(onSubmit).toHaveBeenCalledWith("touchdown7");
  });

  it("refuses passwords that don't match", async () => {
    const onSubmit = vi.fn();
    const screen = await fill(onSubmit, "touchdown7", "touchdown8");
    await expect.element(screen.getByRole("alert")).toHaveTextContent("The passwords don't match.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the error returned by onSubmit", async () => {
    const screen = await fill(vi.fn().mockResolvedValue("Password is too weak"), "touchdown7", "touchdown7");
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Password is too weak");
  });
});
