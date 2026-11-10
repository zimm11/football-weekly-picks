import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SignInForm } from "./SignInForm";

const credentials = { email: "fan@example.com", password: "hunter22" };

async function fillAndSubmit(button: "Sign in" | "Create account", onSubmit = vi.fn()) {
  const screen = await render(<SignInForm onSubmit={onSubmit} />);
  await screen.getByLabelText("Email").fill(credentials.email);
  await screen.getByLabelText("Password").fill(credentials.password);
  await screen.getByRole("button", { name: button }).click();
  return { screen, onSubmit };
}

describe("SignInForm", () => {
  it("submits credentials in sign-in mode", async () => {
    const { onSubmit } = await fillAndSubmit("Sign in", vi.fn().mockResolvedValue(undefined));
    expect(onSubmit).toHaveBeenCalledWith("sign-in", credentials);
  });

  it("submits credentials in sign-up mode", async () => {
    const { onSubmit } = await fillAndSubmit("Create account", vi.fn().mockResolvedValue(undefined));
    expect(onSubmit).toHaveBeenCalledWith("sign-up", credentials);
  });

  it("shows the error returned by onSubmit", async () => {
    const { screen } = await fillAndSubmit("Sign in", vi.fn().mockResolvedValue("Invalid login credentials"));
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Invalid login credentials");
  });
});
