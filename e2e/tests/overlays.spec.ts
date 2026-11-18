import type { Page } from "@playwright/test";
import { expect, openNewLeague, test } from "./fixtures";

/**
 * The browser's own Back button (a phone's back gesture). Not `history.back()` from the page: the app's own
 * steps through history are navigation, never a request to close an overlay. Back may be held and put back in
 * place without a page load, so only the commit is awaited; each test then waits for what it expects.
 */
const pressBack = (page: Page) => page.goBack({ waitUntil: "commit" });

test("Back closes a sheet and stays on the page; the next Back leaves", async ({ page, signedIn }) => {
  await page.getByRole("button", { name: signedIn.displayName, exact: true }).click();
  await page.getByRole("menuitem", { name: "Name and picture" }).click();
  const change = page.getByRole("button", { name: "Change picture" });
  await change.click();
  const sheet = page.getByRole("dialog", { name: "Choose a profile picture" });
  await expect(sheet).toBeVisible();
  const url = page.url();

  await pressBack(page);
  await expect(sheet).toHaveCount(0);
  expect(page.url()).toBe(url);
  await expect(change).toBeFocused();

  // Closing it with its own ✕ leaves the history alone too: Back then goes where it always went.
  await change.click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Close Choose a profile picture" }).click();
  await expect(sheet).toHaveCount(0);
  await pressBack(page);
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
});

test("Back closes a menu and stays on the page", async ({ page, signedIn }) => {
  // A page reached in the app: Back from the page the browser loaded first leaves the app's document, which no
  // page can hold.
  const account = page.getByRole("button", { name: signedIn.displayName, exact: true });
  await account.click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await account.click();
  await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
  const url = page.url();

  await pressBack(page);
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(page.url()).toBe(url);
  await expect(account).toBeFocused();
  await pressBack(page);
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
});

test("over unsaved work, Back closes the menu, then cancels the confirm, then asks to leave", async ({
  page,
  signedIn: _,
}) => {
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Overlay league");
  await page.getByRole("button", { name: "Create league" }).click();
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page.getByRole("link", { name: "New thread" }).click();
  await page.getByLabel("Thread title").fill("Back test");
  await page.getByLabel("Message", { exact: true }).fill("Testing Back.");
  await page.getByRole("button", { name: "Create thread", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Back test" });
  await expect(heading).toBeVisible();
  const threadUrl = page.url();
  const reply = page.getByRole("textbox", { name: "Reply", exact: true });
  await reply.fill("An unsent reply.");
  const options = page.getByRole("button", { name: "Options for Back test", exact: true });
  const dialog = page.getByRole("alertdialog");

  await test.step("a menu: Back closes only the menu", async () => {
    await options.click();
    await expect(page.getByRole("menuitem", { name: "Delete thread", exact: true })).toBeVisible();
    await pressBack(page);
    await expect(page.getByRole("menu")).toHaveCount(0);
    expect(page.url()).toBe(threadUrl);
    await expect(options).toBeFocused();
    await expect(reply).toHaveValue("An unsent reply.");
  });

  await test.step("the confirm dialog: Back is Cancel", async () => {
    await options.click();
    await page.getByRole("menuitem", { name: "Delete thread", exact: true }).click();
    await expect(dialog).toContainText("This can't be undone.");
    await pressBack(page);
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(threadUrl);
    await expect(heading).toBeVisible();
    await expect(reply).toHaveValue("An unsent reply.");
  });

  await test.step("with nothing open, Back asks about the unsaved reply; Back on that question stays", async () => {
    await pressBack(page);
    await expect(dialog).toContainText("Leave without saving?");
    await pressBack(page);
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(threadUrl);
    await expect(reply).toHaveValue("An unsent reply.");
  });

  await test.step("asked again, Leave goes back to the board", async () => {
    await pressBack(page);
    await expect(dialog).toContainText("Leave without saving?");
    await dialog.getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Message board", exact: true })).toBeVisible();
    // The thread was never deleted.
    await expect(page.getByRole("link", { name: /Back test/ })).toBeVisible();
  });
});
