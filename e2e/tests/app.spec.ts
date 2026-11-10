import { expect, test } from "./fixtures";

test("signed-out visitors see the sign-in form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Weekly Picks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a user can sign out and sign back in", async ({ page, signedIn }) => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill(signedIn.email);
  await page.getByLabel("Password").fill(signedIn.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(`Signed in as ${signedIn.email}`)).toBeVisible();
});

// PLACEHOLDER flow: proves web → API → Postgres → web round-trips. Replace with real journeys.
test("items persist across reloads and are private to each user", async ({ page, signedIn: _ }) => {
  await page.getByLabel("New item").fill("my first item");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("listitem")).toHaveText(["my first item"]);

  await page.reload();
  await expect(page.getByRole("listitem")).toHaveText(["my first item"]);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Email").fill(`other-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("No items yet.")).toBeVisible();
});

test("the API rejects unauthenticated requests", async ({ request }) => {
  expect((await request.get("/api/examples")).status()).toBe(401);
});
