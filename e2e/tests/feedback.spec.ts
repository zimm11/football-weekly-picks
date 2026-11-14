import { expect, test } from "./fixtures";

test("players send feedback and the operator can resolve and reopen it", async ({ page, signedIn }) => {
  const message = `Feature request from ${signedIn.email}`;
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await expect(page.getByRole("menuitem", { name: "Operator", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Send feedback" }).click();
  await page.getByRole("combobox", { name: "What kind of feedback?" }).selectOption("feature");
  const input = page.getByRole("textbox", { name: "What would you like the app to do?" });
  await input.fill(message);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(input).toHaveValue(message);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByText("Thanks. Your feedback was sent.")).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  await page.goto("/operator");
  await expect(page.getByText("Page not found.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  // The local env explicitly grants the seeded operator access. Each test only changes its own report.
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operator", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "App totals" })).toContainText("Accounts");
  await expect(page.getByRole("table", { name: "Activity by week" })).toBeVisible();
  const report = page
    .getByRole("list", { name: "Open feedback" })
    .getByRole("listitem")
    .filter({ hasText: message });
  await expect(report).toContainText(signedIn.email);
  await report.getByRole("button", { name: "Mark done" }).click();
  await expect(report).toHaveCount(0);
  await page.getByText(/^Done \(/).click();
  const done = page
    .getByRole("list", { name: "Finished feedback" })
    .getByRole("listitem")
    .filter({ hasText: message });
  await done.getByRole("button", { name: "Reopen" }).click();
  await expect(report).toBeVisible();
  await page.reload();
  await expect(report).toBeVisible();
});

test("feedback ignores an unsafe return destination", async ({ page, signedIn }) => {
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  await page.goto("/feedback?from=%2F%5Cexample.com");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});
