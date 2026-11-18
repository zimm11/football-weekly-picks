import { expect, joinLeague, signOut, test } from "./fixtures";
import { emailCount, waitForEmail } from "./inbox";

test("emails other members about a new thread, and its link unsubscribes them", async ({
  page,
  browser,
  signedIn,
}) => {
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  await page.getByLabel("League name").fill("Mail league");
  await page.getByRole("button", { name: "Create league" }).click();
  const invite = await page.getByLabel("Invite link", { exact: true }).inputValue();
  const { context, page: player, account: reader } = await joinLeague(browser, invite, "Reader");
  try {
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
    expect(threadLink, "the email links to the thread").toBeTruthy();
    await player.goto(threadLink ?? "");
    await expect(player.getByText("Who's hosting Sunday?", { exact: true })).toBeVisible();

    // The footer link works signed out (it is often opened from another device). It asks before unsubscribing,
    // and its Sign in comes back to Settings, where the setting shows as off.
    const unsubscribe = email.links.find((href) => href.includes("/unsubscribe?token="));
    expect(unsubscribe, "the email carries an unsubscribe link").toBeTruthy();
    await signOut(player, "Reader");
    await player.goto(unsubscribe ?? "");
    // Opening the link changes nothing by itself (mail scanners open links): it asks first.
    await player.getByRole("button", { name: "Turn off new-thread emails" }).click();
    await expect(player.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
    await expect(player.getByText("You won't get new-thread emails any more.")).toBeVisible();
    // The page's own Sign in (the header has one too, after it in reading order).
    await player.getByRole("link", { name: "Sign in", exact: true }).last().click();
    await expect(player).toHaveURL(/\/login\?next=%2Faccount$/);
    await player.getByLabel("Email").fill(reader.email);
    await player.getByLabel("Password").fill(reader.password);
    await player.getByLabel("Password").press("Enter");
    await expect(player).toHaveURL(/\/account$/);
    await expect(player.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
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

// Signed in, the unsubscribe page refreshes the profile, which can happen while the app's first profile load is
// still in flight: that load must still finish signing the app in (refreshProfile in apps/mobile/src/lib/auth.tsx).
test("unsubscribing while the app is still loading the profile doesn't strand Settings on the splash", async ({
  page,
  browser,
  signedIn: _,
}) => {
  await page.getByLabel("League name").fill("Slow profile league");
  await page.getByRole("button", { name: "Create league" }).click();
  const invite = await page.getByLabel("Invite link", { exact: true }).inputValue();
  const { context, page: player, account: reader } = await joinLeague(browser, invite, "Reader");
  try {
    await page.getByRole("link", { name: "Messages", exact: true }).click();
    await page.getByRole("link", { name: "New thread" }).click();
    await page.getByLabel("Thread title").fill("Kickoff times");
    await page.getByLabel("Message", { exact: true }).fill("Thursday is early this week.");
    await page.getByRole("button", { name: "Create thread" }).click();
    const email = await waitForEmail(reader.email, /^Slow profile league: Kickoff times$/);
    const unsubscribe = email.links.find((href) => href.includes("/unsubscribe?token="));
    expect(unsubscribe, "the email carries an unsubscribe link").toBeTruthy();

    // On this visit the profile is slow to load: the first GET /api/me is held until the unsubscribe is answered.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    await player.route("**/api/me", async (route) => {
      if (first && route.request().method() === "GET") {
        first = false;
        await held;
      }
      await route.continue();
    });
    const loading = player.waitForRequest((req) => new URL(req.url()).pathname === "/api/me");
    await player.goto(unsubscribe ?? "");
    await loading;
    const answered = player.waitForResponse(
      (res) => res.request().method() === "POST" && new URL(res.url()).pathname === "/api/unsubscribe",
    );
    await player.getByRole("button", { name: "Turn off new-thread emails" }).click();
    expect((await answered).ok()).toBe(true);
    await expect(player.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();
    release();

    await player.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(player.getByRole("checkbox", { name: /New message threads/ })).not.toBeChecked();
  } finally {
    await context.close();
  }
});
