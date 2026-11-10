import { test as base, expect } from "@playwright/test";

/** Signs up a fresh user per test (local Supabase has email confirmation off), so tests never share state. */
export const test = base.extend<{ signedIn: { email: string; password: string } }>({
  signedIn: async ({ page }, use, testInfo) => {
    const email = `e2e-${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    await page.goto("/");
    await page.getByLabel("Email").fill(email);
    const password = "password123";
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
    await use({ email, password });
  },
});

export { expect };
