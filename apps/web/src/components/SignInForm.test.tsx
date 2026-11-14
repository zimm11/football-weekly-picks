import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { SignInForm } from "./SignInForm";

const credentials = { email: "fan@example.com", password: "hunter22" };

async function fillAndSubmit(button: "Sign in" | "Create account", onSubmit = vi.fn()) {
  const screen = await render(<SignInForm onSubmit={onSubmit} onResetRequest={vi.fn()} />);
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

  it("requests a reset link for the email already typed", async () => {
    const onResetRequest = vi.fn().mockResolvedValue(undefined);
    const screen = await render(<SignInForm onSubmit={vi.fn()} onResetRequest={onResetRequest} />);
    await screen.getByLabelText("Email").fill(credentials.email);
    await screen.getByRole("button", { name: "Forgot password?" }).click();
    await expect.element(screen.getByLabelText("Password")).not.toBeInTheDocument();
    await expect.element(screen.getByLabelText("Email")).toHaveValue(credentials.email);
    await screen.getByRole("button", { name: "Send reset link" }).click();
    expect(onResetRequest).toHaveBeenCalledWith(credentials.email);
    await expect
      .element(screen.getByRole("status"))
      .toHaveTextContent(
        `If there's an account for ${credentials.email}, a reset link is on its way. Check your inbox.`,
      );

    await screen.getByRole("button", { name: "Back to sign in" }).click();
    await expect.element(screen.getByLabelText("Password")).toBeVisible();
  });

  it("shows a reset failure and an expired-link message", async () => {
    const screen = await render(
      <SignInForm
        onSubmit={vi.fn()}
        onResetRequest={vi.fn().mockResolvedValue("Too many requests")}
        startForgot
        initialError="That reset link has expired."
      />,
    );
    await expect.element(screen.getByRole("alert")).toHaveTextContent("That reset link has expired.");
    await screen.getByLabelText("Email").fill(credentials.email);
    await screen.getByRole("button", { name: "Send reset link" }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Too many requests");
  });
});
