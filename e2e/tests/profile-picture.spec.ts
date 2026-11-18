import { expect, test } from "./fixtures";

test("a player can choose a profile logo and switch back to initials", async ({ page, signedIn }) => {
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Name and picture" }).click();
  await page.getByRole("button", { name: "Change picture" }).click();
  await page.getByRole("button", { name: "Fantasy", exact: true }).click();
  await page.getByRole("button", { name: "Ruby dragon" }).click();
  await expect(page.getByRole("button", { name: "Change picture" })).toBeVisible();
  await expect(page.getByText("Profile picture updated.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Ruby dragon", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Change picture" }).click();
  await expect(page.getByRole("button", { name: "Ruby dragon", pressed: true })).toBeVisible();
  await page.getByRole("button", { name: "Use my initials" }).click();
  await expect(page.getByText("Your initials", { exact: true })).toBeVisible();
});
