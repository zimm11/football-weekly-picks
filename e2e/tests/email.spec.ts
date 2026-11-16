import { expect, signUp, test } from "./fixtures";
import { emailCount, waitForEmail } from "./inbox";

test("emails other members about a new thread, and its link unsubscribes them", async ({
  page,
  browser,
  signedIn,
}) => {
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  await page.getByLabel("League name").fill("Mail league");
  await page.getByRole("button", { name: "Create league" }).click();
  const invite = await page.getByLabel(/Invite link/).inputValue();
  const context = await browser.newContext();
  try {
    const player = await context.newPage();
    await player.goto(invite);
    const reader = await signUp(player, "Reader");
    await player.getByRole("button", { name: "Join league" }).click();
    await expect(player.getByRole("heading", { name: "Mail league" })).toBeVisible();

    await page.getByRole("link", { name: "Messages", exact: true }).click();
    await page.getByRole("link", { name: "New thread" }).click();
    await page.getByLabel("Thread title").fill("Bye week plans");
    await page.getByLabel("Message", { exact: true }).fill("Who's hosting Sunday?");
    await page.getByRole("button", { name: "Create thread" }).click();
    await expect(page.getByRole("heading", { name: "Bye week plans" })).toBeVisible();

    const email = await waitForEmail(reader.email, /^Mail league: Bye week plans$/);
    expect(email.text).toContain("Commish started a new thread");
    expect(email.text).toContain("Who's hosting Sunday?");
    expect(await emailCount(signedIn.email)).toBe(0);

    // The thread link opens the thread.
    const threadLink = email.links.find((href) => href.includes("/messages/"));
    await player.goto(threadLink ?? "");
    await expect(player.getByText("Who's hosting Sunday?", { exact: true })).toBeVisible();

    // The footer link asks before unsubscribing, then the setting shows as off.
    const unsubscribe = email.links.find((href) => href.includes("/unsubscribe?token="));
    await player.goto(unsubscribe ?? "");
    await player.getByRole("button", { name: "Turn off new-thread emails" }).click();
    await expect(player.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
    await player.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(player.getByRole("checkbox", { name: /New message threads/ })).not.toBeChecked();
    await expect(player.getByRole("checkbox", { name: /Pick reminders/ })).toBeChecked();
    await player.getByRole("checkbox", { name: /New message threads/ }).check();
    await expect(player.getByText("Email settings saved.")).toBeVisible();
    await player.reload();
    await expect(player.getByRole("checkbox", { name: /New message threads/ })).toBeChecked();
  } finally {
    await context.close();
  }
});
