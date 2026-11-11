import { expect, signUp, test } from "./fixtures";

test("members create threads, reply, and guard unsaved messages", async ({ page, signedIn }) => {
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  await page.getByLabel("League name").fill("Message league");
  await page.getByRole("button", { name: "Create league" }).click();
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page.getByRole("link", { name: "New thread" }).click();
  await page.getByLabel("Thread title").fill("Week discussion");
  await page.getByLabel("Message", { exact: true }).fill("Who is your POW?");
  await page.getByRole("link", { name: "Message board" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Create thread" }).click();
  await expect(page.getByRole("heading", { name: "Week discussion" })).toBeVisible();
  await expect(page.getByText("Who is your POW?", { exact: true })).toBeVisible();
  await page.getByLabel("Reply", { exact: true }).fill("I'm picking the Eagles.");
  await page.getByRole("button", { name: "Post reply" }).click();
  await expect(page.getByText("I'm picking the Eagles.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("I'm picking the Eagles.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Message board" }).click();
  await expect(page.getByRole("link", { name: /Week discussion/ })).toContainText("1 reply");
  await expect(page.getByText("Unread", { exact: true })).not.toBeVisible();
});

test("new threads and replies show unread indicators until opened", async ({ page, browser, signedIn }) => {
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  await page.getByLabel("League name").fill("Unread league");
  await page.getByRole("button", { name: "Create league" }).click();
  const invite = await page.getByLabel(/Invite link/).inputValue();
  const context = await browser.newContext();
  try {
    const player = await context.newPage();
    await player.goto(invite);
    await signUp(player, "Reader");
    await player.getByRole("button", { name: "Join league" }).click();
    await expect(player.getByRole("heading", { name: "Unread league" })).toBeVisible();
    await page.getByRole("link", { name: "Messages", exact: true }).click();
    await page.getByRole("link", { name: "New thread" }).click();
    await page.getByLabel("Thread title").fill("League news");
    await page.getByLabel("Message", { exact: true }).fill("Welcome everyone.");
    await page.getByRole("button", { name: "Create thread" }).click();
    await expect(page.getByRole("heading", { name: "League news" })).toBeVisible();
    await player.reload();
    await expect(player.getByRole("img", { name: "1 unread threads" })).toBeVisible();
    await player.getByRole("link", { name: /Messages/ }).click();
    await expect(player.getByRole("link", { name: /League news/ })).toContainText("Unread");
    await player.getByRole("link", { name: /League news/ }).click();
    await expect(player.getByText("Welcome everyone.", { exact: true })).toBeVisible();
    await expect(player.getByRole("img", { name: "1 unread threads" })).not.toBeVisible();
    await player.getByRole("link", { name: "Message board" }).click();
    await page.getByLabel("Reply", { exact: true }).fill("One more update.");
    await page.getByRole("button", { name: "Post reply" }).click();
    await expect(page.getByText("One more update.", { exact: true })).toBeVisible();
    await player.reload();
    await expect(player.getByRole("link", { name: /League news/ })).toContainText("Unread");
    await player.getByRole("link", { name: /League news/ }).click();
    await expect(player.getByText("One more update.", { exact: true })).toBeVisible();
    await expect(player.getByRole("img", { name: "1 unread threads" })).not.toBeVisible();
  } finally {
    await context.close();
  }
});
