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
  // Text matching can find the still-filled textarea before the request finishes.
  // Wait for the successful submission to clear it before reloading.
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("");
  await expect(page.getByText("I'm picking the Eagles.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("I'm picking the Eagles.", { exact: true })).toBeVisible();
  const reactions = page.getByRole("group", { name: "Message reactions" });
  // Nobody has reacted yet, so the emoji are behind the React button rather than on the message.
  await expect(reactions.first().getByRole("button", { name: /Like/ })).toHaveCount(0);
  await reactions.first().getByRole("button", { name: "Add reaction" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Like" }).click();
  await expect(
    reactions.first().getByRole("button", { name: "Like, 1 reactions", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await reactions.last().getByRole("button", { name: "Add reaction" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Laugh" }).click();
  await expect(
    reactions.last().getByRole("button", { name: "Laugh, 1 reactions", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await reactions.first().getByRole("button", { name: "Like, 1 reactions", exact: true }).click();
  await expect(reactions.first().getByRole("button", { name: /Like/ })).toHaveCount(0);
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
    await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveValue("");
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

test("admins pin announcements and members quote replies", async ({ page, browser, signedIn }) => {
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  await page.getByLabel("League name").fill("Announcement league");
  await page.getByRole("button", { name: "Create league" }).click();
  const invite = await page.getByLabel(/Invite link/).inputValue();
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page.getByRole("link", { name: "New thread" }).click();
  await page.getByLabel("Thread title").fill("Weekly reminder");
  await page.getByLabel("Message", { exact: true }).fill("Remember your Monday POW.");
  await page.getByRole("button", { name: "Create thread", exact: true }).click();
  await page.getByRole("button", { name: "Options for Weekly reminder" }).click();
  await page.getByRole("menuitem", { name: "Pin announcement" }).click();
  await expect(page.getByText("Pinned announcement")).toBeVisible();
  await page.getByRole("link", { name: "Message board" }).click();
  await page.getByRole("link", { name: "New thread" }).click();
  await page.getByLabel("Thread title").fill("Newer conversation");
  await page.getByLabel("Message", { exact: true }).fill("Any bold predictions?");
  await page.getByRole("button", { name: "Create thread", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Newer conversation" })).toBeVisible();
  await page.getByRole("link", { name: "Message board" }).click();
  const threads = page.getByRole("link").filter({ hasText: /Weekly reminder|Newer conversation/ });
  await expect(threads.first()).toContainText("Pinned announcement");
  await expect(threads.first()).toContainText("Weekly reminder");

  const context = await browser.newContext();
  try {
    const player = await context.newPage();
    await player.goto(invite);
    await signUp(player, "Reader");
    await player.getByRole("button", { name: "Join league" }).click();
    await expect(player.getByRole("heading", { name: "Announcement league" })).toBeVisible();
    await player.getByRole("link", { name: /Messages/ }).click();
    await player.getByRole("link", { name: /Weekly reminder/ }).click();
    await expect(player.getByText("Pinned announcement", { exact: true })).toBeVisible();
    await expect(player.getByRole("button", { name: "Options for Weekly reminder" })).toHaveCount(0);
    await player.getByRole("button", { name: "Quote message 1 by Commish", exact: true }).click();
    const preview = player.getByRole("region", { name: "Reply quote preview" });
    await expect(preview).toContainText("Remember your Monday POW.");
    const reply = player.getByRole("textbox", { name: "Reply", exact: true });
    await expect(reply).toBeFocused();
    await reply.fill("Thanks for the reminder!");
    await player.getByRole("button", { name: "Remove quote", exact: true }).click();
    await expect(preview).toHaveCount(0);
    await expect(reply).toHaveValue("Thanks for the reminder!");
    await player.getByRole("button", { name: "Quote message 1 by Commish", exact: true }).click();
    await player.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(reply).toHaveValue("");
    await expect(preview).toHaveCount(0);
    await player.reload();
    const posted = player.getByRole("region", { name: "Message 2 by Reader", exact: true });
    await expect(posted).toContainText("Commish wrote:");
    await expect(posted).toContainText("Remember your Monday POW.");
    await expect(posted).toContainText("Thanks for the reminder!");
    await posted.getByRole("link", { name: "View original", exact: true }).click();
    await expect(player.getByRole("region", { name: "Message 1 by Commish", exact: true })).toBeFocused();
  } finally {
    await context.close();
  }
  await page.getByRole("link", { name: /Weekly reminder/ }).click();
  await page.getByRole("button", { name: "Options for Weekly reminder" }).click();
  await page.getByRole("menuitem", { name: "Unpin announcement" }).click();
  await expect(page.getByText("Pinned announcement")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Pinned announcement", { exact: true })).toHaveCount(0);
});

test("admins confirm thread deletion, keep drafts on failure, and return to the board", async ({
  page,
  signedIn,
}) => {
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  await page.getByLabel("League name").fill("Moderated league");
  await page.getByRole("button", { name: "Create league" }).click();
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page.getByRole("link", { name: "New thread" }).click();
  await page.getByLabel("Thread title").fill("Old discussion");
  await page.getByLabel("Message", { exact: true }).fill("An old conversation.");
  await page.getByRole("button", { name: "Create thread", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Old discussion" })).toBeVisible();
  const threadUrl = page.url();
  const reply = page.getByRole("textbox", { name: "Reply", exact: true });
  await reply.fill("A posted reply.");
  await page.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(reply).toHaveValue("");
  await expect(page.getByText("A posted reply.", { exact: true })).toBeVisible();
  await reply.fill("An unsent reply.");
  const options = page.getByRole("button", { name: "Options for Old discussion", exact: true });
  const dialog = page.getByRole("alertdialog");
  await options.click();
  await page.getByRole("menuitem", { name: "Delete thread", exact: true }).click();
  await expect(dialog).toContainText("This can't be undone.");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reply).toHaveValue("An unsent reply.");
  await expect(page).toHaveURL(threadUrl);

  const endpoint = `**/api${new URL(threadUrl).pathname}`;
  await page.route(endpoint, async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({ status: 503, json: { error: "Please try deleting again." } });
    } else await route.continue();
  });
  await options.click();
  await page.getByRole("menuitem", { name: "Delete thread", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete thread", exact: true }).click();
  await expect(page.getByText("Please try deleting again.", { exact: true })).toBeVisible();
  await expect(reply).toHaveValue("An unsent reply.");
  await expect(options).toBeEnabled();
  await page.unroute(endpoint);

  await options.click();
  await page.getByRole("menuitem", { name: "Delete thread", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete thread", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Message board", exact: true })).toBeVisible();
  await expect(page.getByText("Thread deleted.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Old discussion/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("No threads yet. Start the conversation.")).toBeVisible();
  await page.goto(threadUrl);
  await expect(page.getByRole("alert")).toContainText("Thread not found.");
  await expect(page.getByRole("textbox", { name: "Reply", exact: true })).toHaveCount(0);
});
