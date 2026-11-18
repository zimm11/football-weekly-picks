import type { Page } from "@playwright/test";
import { expect, signOut, test } from "./fixtures";
import { waitForEmail } from "./inbox";

/**
 * Waits for the password-reset email to `to` in the local test inbox and returns the link it carries. The repo's
 * template (supabase/templates/recovery.html) links straight to the app, `/reset-password#token_hash=…`, which
 * the app verifies itself in whichever browser opens it. The subject is matched loosely: a stack that hasn't
 * loaded the templates sends GoTrue's own ("Reset your password") instead of "Reset your POW Pick'em password".
 */
async function resetLinkFor(to: string): Promise<string> {
  const email = await waitForEmail(to, /^Reset your (POW Pick'em )?password$/);
  const link = email.links.find(
    (href) => href.includes("/reset-password") || href.includes("/auth/v1/verify"),
  );
  if (!link) throw new Error("The reset email has no reset link.");
  return link;
}

/** What a reset link says once it has expired or been used (apps/mobile/src/lib/authErrors.ts). */
const EXPIRED = "That link has expired or was already used. Ask for a new one.";

/** Signs out from the account menu, then signs in with `password`. */
async function signInAgain(page: Page, account: { email: string; displayName: string }, password: string) {
  await signOut(page, account.displayName);
  // Signed out, Your leagues is the home page, whose form opens on Create account: switch it to Sign in.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("a reset link works in another browser than the one that asked for it, and only once", async ({
  page,
  browser,
  signedIn,
}) => {
  await signOut(page, signedIn.displayName);

  // The home page's form opens on Create account; Forgot password? is on its Sign in side.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email").fill(signedIn.email);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByLabel("Email")).toHaveValue(signedIn.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status").filter({ hasText: "a reset link is on its way" })).toBeVisible();
  const link = await resetLinkFor(signedIn.email);

  // The player opens the email on another device: a browser that never saw the request.
  const phone = await browser.newContext();
  try {
    const other = await phone.newPage();
    await other.goto(link);
    await expect(other).toHaveURL(/\/reset-password/);
    await expect(other.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
    const newPassword = "brand-new-pass9";
    await other.getByLabel("New password", { exact: true }).fill(newPassword);
    await other.getByLabel("Confirm new password").fill(newPassword);
    await other.getByRole("button", { name: "Save password" }).click();
    await expect(other.getByText("Password updated.")).toBeVisible();
    await expect(other.getByRole("heading", { name: "Your leagues" })).toBeVisible();
    await expect(other.getByRole("button", { name: signedIn.displayName, exact: true })).toBeVisible();

    // Supabase tells the player their password changed.
    await waitForEmail(signedIn.email, /^Your (POW Pick'em )?password was changed$/);

    // The same link a second time has been used: it says so, and offers a new one.
    const again = await (await browser.newContext()).newPage();
    try {
      await again.goto(link);
      await expect(again.getByRole("heading", { name: "Reset your password" })).toBeVisible();
      await expect(again.getByRole("alert")).toContainText(EXPIRED);
      await expect(again.getByRole("button", { name: "Send reset link" })).toBeVisible();
    } finally {
      await again.context().close();
    }

    // Back on the first browser: the old password no longer works; the new one does, and Enter signs in.
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByLabel("Email")).toHaveValue(signedIn.email);
    await page.getByLabel("Password").fill(signedIn.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("That email and password don't match.");
    await page.getByLabel("Password").fill(newPassword);
    await page.getByLabel("Password").press("Enter");
    await expect(page.getByRole("button", { name: signedIn.displayName, exact: true })).toBeVisible();
  } finally {
    await phone.close();
  }
});

test("an expired reset link explains itself and offers a new one", async ({ page }) => {
  await page.goto(
    "/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
  );
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(EXPIRED);
  await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
});

test("a signed-in player can change their password from the account menu", async ({ page, signedIn }) => {
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Change password" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  // Cancel goes back without changing anything.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();

  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Change password" }).click();
  const newPassword = "another-pass7";
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password").fill("another-pass8");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("alert")).toContainText("The passwords don't match.");
  await page.getByLabel("Confirm new password").fill(newPassword);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText("Password updated.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();

  await signInAgain(page, signedIn, signedIn.password);
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Password").fill(newPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
});
