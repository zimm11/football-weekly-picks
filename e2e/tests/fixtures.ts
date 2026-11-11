import { test as base, expect, type Page } from "@playwright/test";

const PASSWORD = "password123";

/** Creates an account from the sign-in form on the current page and chooses a display name. */
export async function signUp(page: Page, displayName: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Display name").fill(displayName);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("button", { name: displayName })).toBeVisible();
  return { email, password: PASSWORD, displayName };
}

/** Signs up a fresh user per test (local Supabase has email confirmation off), so tests never share state. */
export const test = base.extend<{ signedIn: { email: string; password: string; displayName: string } }>({
  signedIn: async ({ page }, use) => {
    await page.goto("/");
    await use(await signUp(page, "Commish"));
  },
});

export { expect };
