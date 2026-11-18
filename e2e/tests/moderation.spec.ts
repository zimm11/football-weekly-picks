import type { Page } from "@playwright/test";
import { expect, joinLeague, test } from "./fixtures";

async function openThread(page: Page, title: string) {
  await page.getByRole("link", { name: /Messages/ }).click();
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test("a reported reply is removed by an admin, and blocking hides a player's messages", async ({
  page,
  browser,
  signedIn: _,
}) => {
  // Three players in their own browsers.
  test.slow();
  await page.getByLabel("League name").fill("Moderated league");
  await page.getByRole("button", { name: "Create league" }).click();
  const invite = await page.getByLabel("Invite link", { exact: true }).inputValue();
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page.getByRole("link", { name: "New thread" }).click();
  await page.getByLabel("Thread title").fill("Week 9 talk");
  await page.getByLabel("Message", { exact: true }).fill("Who had the Monday night total?");
  await page.getByRole("button", { name: "Create thread", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Week 9 talk" })).toBeVisible();

  const pat = await joinLeague(browser, invite, "Pat");
  const sam = await joinLeague(browser, invite, "Sam").catch(async (error) => {
    await pat.context.close();
    throw error;
  });
  try {
    await openThread(pat.page, "Week 9 talk");
    await pat.page
      .getByRole("textbox", { name: "Reply", exact: true })
      .fill("Buy my picks newsletter today!");
    await pat.page.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(pat.page.getByRole("region", { name: "Message 2 by Pat", exact: true })).toBeVisible();

    // Sam reports Pat's reply.
    await openThread(sam.page, "Week 9 talk");
    await sam.page.getByRole("button", { name: "Options for message 2 by Pat", exact: true }).click();
    await sam.page.getByRole("menuitem", { name: "Report message from Pat", exact: true }).click();
    await sam.page.getByRole("radio", { name: "Spam", exact: true }).click();
    await sam.page.getByRole("button", { name: "Send report", exact: true }).click();
    await expect(sam.page.getByText("We review reports within 24 hours.")).toBeVisible();
    await sam.page.getByRole("button", { name: "Done", exact: true }).click();

    // The admin removes it from the League tab's Reports card.
    await page.getByRole("link", { name: "League", exact: true }).click();
    const reports = page.getByRole("region", { name: "Reports", exact: true });
    await expect(reports).toContainText("Message from Pat: Spam");
    await expect(reports).toContainText("Buy my picks newsletter today!");
    await reports.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove message", exact: true }).click();
    await expect(reports).toContainText("No reports waiting.");

    await sam.page.reload();
    const removed = sam.page.getByRole("region", { name: "Message 2 by Pat", exact: true });
    await expect(removed).toContainText("Message removed");
    await expect(removed).not.toContainText("newsletter");

    // Sam blocks Pat: Pat's next reply is collapsed for Sam, and only for Sam.
    await sam.page.getByRole("button", { name: "Options for message 2 by Pat", exact: true }).click();
    await sam.page.getByRole("menuitem", { name: "Block Pat", exact: true }).click();
    await sam.page.getByRole("alertdialog").getByRole("button", { name: "Block Pat", exact: true }).click();
    await expect(sam.page.getByText("Pat is blocked.")).toBeVisible();
    await pat.page.getByRole("textbox", { name: "Reply", exact: true }).fill("Fine, good luck this week.");
    await pat.page.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect(pat.page.getByRole("region", { name: "Message 3 by Pat", exact: true })).toContainText(
      "good luck",
    );
    await sam.page.reload();
    const blocked = sam.page.getByRole("region", { name: "Message 3 by Pat", exact: true });
    await expect(blocked).toContainText("Message from a blocked player");
    await blocked.getByRole("button", { name: "Show message 3 by Pat", exact: true }).click();
    await expect(blocked).toContainText("Fine, good luck this week.");
    await page.goto(page.url().replace(/\/league$/, "/messages"));
    await page.getByRole("link", { name: /Week 9 talk/ }).click();
    await expect(page.getByRole("region", { name: "Message 3 by Pat", exact: true })).toContainText(
      "good luck",
    );

    // Settings lists the players Sam blocked; unblocking Pat shows Pat's messages again.
    await sam.page.goto("/account");
    await sam.page.getByRole("button", { name: "Unblock Pat", exact: true }).click();
    await expect(sam.page.getByText("Pat is unblocked.")).toBeVisible();
    await expect(sam.page.getByRole("heading", { name: "Blocked players" })).toHaveCount(0);
    await sam.page.goBack();
    await expect(sam.page.getByRole("region", { name: "Message 3 by Pat", exact: true })).toContainText(
      "Fine, good luck this week.",
    );
  } finally {
    await pat.context.close();
    await sam.context.close();
  }
});
