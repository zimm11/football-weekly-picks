import { expect, joinLeague, test } from "./fixtures";

test("a player deletes their account from Settings and can sign up again with the same email", async ({
  page,
  browser,
  signedIn: _,
}) => {
  // Two players in their own browsers.
  test.slow();
  await page.getByLabel("League name").fill("Deletion league");
  await page.getByRole("button", { name: "Create league" }).click();
  const invite = await page.getByLabel("Invite link", { exact: true }).inputValue();

  const { context, page: player, account } = await joinLeague(browser, invite, "Pat");
  try {
    await expect(player.getByRole("heading", { name: "Deletion league" })).toBeVisible();
    await player.getByRole("link", { name: /Messages/ }).click();
    await player.getByRole("link", { name: "New thread" }).click();
    await player.getByLabel("Thread title").fill("Pat's picks");
    await player.getByLabel("Message", { exact: true }).fill("Taking the Lions this week.");
    await player.getByRole("button", { name: "Create thread", exact: true }).click();
    await expect(player.getByRole("heading", { name: "Pat's picks" })).toBeVisible();

    await player.goto("/account");
    await player.getByRole("button", { name: "Delete account", exact: true }).click();
    const sheet = player.getByRole("dialog");
    await expect(player.getByText(/you leave Deletion league/)).toBeVisible();
    await player.getByLabel("Password").fill("wrong password");
    await player.getByRole("button", { name: "Delete my account", exact: true }).click();
    await expect(player.getByText("That password isn't right.")).toBeVisible();
    await player.getByLabel("Password").fill(account.password);
    await player.getByRole("button", { name: "Delete my account", exact: true }).click();
    await expect(player.getByText("Your account was deleted.")).toBeVisible();
    await expect(player.getByRole("button", { name: "Create account" })).toBeVisible();
    await expect(sheet).toHaveCount(0);

    // The admin no longer sees Pat in the league; Pat's thread stays, without Pat's words.
    await page.reload();
    await page.getByRole("link", { name: "League", exact: true }).click();
    await expect(page.getByRole("region", { name: "Members" })).not.toContainText("Pat");
    await page.getByRole("link", { name: "Messages", exact: true }).click();
    await page.getByRole("link", { name: /Thread from a deleted player/ }).click();
    const opening = page.getByRole("region", { name: "Message 1 by Deleted player", exact: true });
    await expect(opening).toContainText("Deleted player's message");
    await expect(opening).not.toContainText("Lions");

    // The same email starts over as a new, empty account.
    await player.getByLabel("Email").fill(account.email);
    await player.getByLabel("Password").fill(account.password);
    await player.getByRole("button", { name: "Create account" }).click();
    await player.getByLabel("Display name").fill("Pat again");
    await player.getByRole("checkbox", { name: "I'm 18 or older and I agree to the Terms of use" }).click();
    await player.getByRole("button", { name: "Continue" }).click();
    await expect(player.getByRole("button", { name: "Pat again" })).toBeVisible();
    // Your leagues has loaded, and it is empty.
    await expect(player.getByRole("heading", { name: "Get ready for your first week" })).toBeVisible();
    await expect(player.getByText("Deletion league")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
