import { expect, joinLeague, openNewLeague, signOut, signUp, test } from "./fixtures";
import { emailCount, waitForEmail } from "./inbox";

test("a new invite link retires the old one, and a removed player comes back through the new link", async ({
  page,
  browser,
  signedIn: _,
}) => {
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Invite only");
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "Invite only" })).toBeVisible();
  const invite = page.getByLabel("Invite link", { exact: true });
  const oldUrl = await invite.inputValue();

  const { context, page: player } = await joinLeague(browser, oldUrl, "Pat");
  try {
    await expect(player.getByRole("heading", { name: "Invite only" })).toBeVisible();
    const leagueUrl = player.url();
    // A member who opens the invite again is sent to the league rather than asked to join twice.
    await player.goto(oldUrl);
    await expect(player.getByRole("button", { name: "Join league" })).toHaveCount(0);
    await player.getByRole("link", { name: "Go to the league" }).click();
    await expect(player).toHaveURL(leagueUrl);
    await expect(player.getByRole("heading", { name: "Invite only" })).toBeVisible();

    // Removed: Pat is off the member list and the league is gone for them.
    await page.reload();
    await page.getByRole("button", { name: "Options for Pat" }).click();
    await page.getByRole("menuitem", { name: "Remove Pat", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByText("Pat removed.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Members" })).toContainText("Members (1)");
    await expect(page.getByRole("region", { name: "Members" })).not.toContainText("Pat");
    // Nothing a retry would change: the not-found screen, whose one way on is Your leagues.
    await player.reload();
    await expect(player.getByRole("alert").getByRole("heading", { name: "League not found" })).toBeVisible();
    await expect(player.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await player.getByRole("link", { name: "Your leagues" }).click();
    await expect(player.getByRole("heading", { name: "Get ready for your first week" })).toBeVisible();
    await expect(player.getByRole("link", { name: /Invite only/ })).toHaveCount(0);

    // A new link: the one already handed out stops working.
    await page.getByRole("button", { name: "Make a new link" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Make new link" }).click();
    await expect(page.getByText("New invite link created.")).toBeVisible();
    await expect(invite).not.toHaveValue(oldUrl);
    const newUrl = await invite.inputValue();
    await player.goto(oldUrl);
    const dead = player.getByRole("alert");
    await expect(dead.getByRole("heading", { name: "This invite link is no longer valid" })).toBeVisible();
    await expect(dead).toContainText("Ask the league commissioner for a new one.");
    await expect(player.getByRole("link", { name: "Your leagues" })).toBeVisible();
    await expect(player.getByRole("button", { name: "Join league" })).toHaveCount(0);

    // The new one lets the removed player back in.
    await player.goto(newUrl);
    await player.getByRole("button", { name: "Join league" }).click();
    await expect(player).toHaveURL(leagueUrl);
    await expect(player.getByRole("heading", { name: "Invite only" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "Members" })).toContainText("Members (2)");
    await expect(page.getByRole("region", { name: "Members" })).toContainText("Pat");
  } finally {
    await context.close();
  }
});

test("a new league starts with another league's members, who are told by email", async ({
  page,
  browser,
  signedIn,
}) => {
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Original crew");
  // Nobody to start with yet: the choice appears once the player runs a league.
  await expect(page.getByRole("combobox", { name: "Start with members from" })).toHaveCount(0);
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "Original crew" })).toBeVisible();
  const inviteUrl = await page.getByLabel("Invite link", { exact: true }).inputValue();

  const { context, page: player, account } = await joinLeague(browser, inviteUrl, "Pat");
  try {
    await expect(player.getByRole("heading", { name: "Original crew" })).toBeVisible();

    // A second league, of another type, with the first one's members.
    await page.getByRole("link", { name: "All leagues" }).click();
    await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
    await openNewLeague(page);
    await page.getByRole("radio", { name: "Squares" }).click();
    await page.getByLabel("League name").fill("Spin-off squares");
    const source = page.getByRole("combobox", { name: "Start with members from" });
    await expect(source).toHaveValue("");
    await source.selectOption({ label: "Original crew" });
    await page.getByRole("button", { name: "Create league" }).click();
    await expect(page.getByRole("heading", { name: "Spin-off squares" })).toBeVisible();
    const members = page.getByRole("region", { name: "Members" });
    await expect(members).toContainText("Members (2)");
    await expect(members).toContainText("Pat");
    // Copied players join as players: the creator is the only commissioner.
    await expect(members.getByText("Commissioner", { exact: true })).toHaveCount(1);

    // Pat is told once by email, with a link to the league; the creator isn't emailed.
    const email = await waitForEmail(
      account.email,
      /^Spin-off squares: You've been added to Spin-off squares$/,
    );
    expect(email.text).toContain("started with the members of Original crew");
    expect(email.links.some((href) => href.includes("/unsubscribe?token="))).toBe(true);
    expect(await emailCount(signedIn.email)).toBe(0);
    const leagueLink = email.links.find((href) => /^\/leagues\/[^/]+$/.test(new URL(href).pathname));
    expect(leagueLink, "the email links to the new league").toBeTruthy();
    await player.goto(leagueLink ?? "");
    await expect(player.getByRole("heading", { name: "Spin-off squares" })).toBeVisible();

    // Both leagues are on Pat's list, each with its type; neither names Pat a commissioner.
    await player.getByRole("link", { name: "All leagues" }).click();
    await expect(player.getByRole("link", { name: /Spin-off squares/ })).toContainText("Squares");
    await expect(player.getByRole("link", { name: /Original crew/ })).toContainText("Weekly pick'em");
    await expect(player.getByText("Commissioner", { exact: true })).toHaveCount(0);
    // And Pat can leave the league they were added to.
    await player.getByRole("link", { name: /Spin-off squares/ }).click();
    await player.getByRole("link", { name: "League", exact: true }).click();
    await player.getByRole("button", { name: "Leave league" }).click();
    await player.getByRole("alertdialog").getByRole("button", { name: "Leave league" }).click();
    await expect(player.getByRole("heading", { name: "Your leagues" })).toBeVisible();
    await expect(player.getByRole("link", { name: /Original crew/ })).toBeVisible();
    await expect(player.getByRole("link", { name: /Spin-off squares/ })).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("a thread link opened signed out opens the thread after signing in, and only for members", async ({
  page,
  browser,
  signedIn,
}) => {
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Linked league");
  await page.getByRole("button", { name: "Create league" }).click();
  await page.getByRole("link", { name: "Messages", exact: true }).click();
  await page.getByRole("link", { name: "New thread" }).click();
  await page.getByLabel("Thread title").fill("Read this first");
  await page.getByLabel("Message", { exact: true }).fill("Picks lock at kickoff, no exceptions.");
  await page.getByRole("button", { name: "Create thread", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Read this first" })).toBeVisible();
  const threadUrl = page.url();
  expect(new URL(threadUrl).pathname).toMatch(/^\/leagues\/[^/]+\/messages\/[^/]+$/);

  await signOut(page, signedIn.displayName);

  // Signed out, the link asks for a sign-in where it is, then shows what it pointed at.
  await page.goto(threadUrl);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByText("Picks lock at kickoff, no exceptions.")).toHaveCount(0);
  await page.getByLabel("Email").fill(signedIn.email);
  await page.getByLabel("Password").fill(signedIn.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Read this first" })).toBeVisible();
  await expect(page.getByText("Picks lock at kickoff, no exceptions.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(threadUrl);

  // Someone outside the league who was sent the link signs up from it and sees nothing of the league.
  const context = await browser.newContext();
  try {
    const outsider = await context.newPage();
    await outsider.goto(threadUrl);
    await signUp(outsider, "Outsider");
    await expect(outsider.getByRole("alert")).toContainText("League not found");
    await expect(outsider.getByText("Read this first")).toHaveCount(0);
    await expect(outsider.getByText("Linked league")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("a player changes their display name, and their league shows the new one", async ({
  page,
  signedIn,
}) => {
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Name change");
  await page.getByRole("button", { name: "Create league" }).click();
  const members = page.getByRole("region", { name: "Members" });
  await expect(members).toContainText(`${signedIn.displayName} (you)`);

  await page.getByRole("button", { name: signedIn.displayName, exact: true }).click();
  await page.getByRole("menuitem", { name: "Name and picture" }).click();
  await expect(page.getByRole("heading", { name: "Name and picture" })).toBeVisible();
  const name = page.getByLabel("Display name");
  await expect(name).toHaveValue(signedIn.displayName);
  // A name is required.
  await name.fill("   ");
  await expect(page.getByRole("button", { name: "Save name" })).toBeDisabled();
  await name.fill("Coach Riley");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Name saved.")).toBeVisible();

  // Saving goes back to the league, which shows the new name, as does the account menu.
  await expect(members).toContainText("Coach Riley (you)");
  await expect(members).not.toContainText(signedIn.displayName);
  await expect(page.getByRole("button", { name: "Coach Riley", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Coach Riley", exact: true })).toBeVisible();
  await expect(members).toContainText("Coach Riley (you)");
});

test("league tabs are links that switch without reloading the league", async ({ page, signedIn: _ }) => {
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Tab hopping");
  await page.getByRole("button", { name: "Create league" }).click();
  const name = page.getByRole("heading", { name: "Tab hopping", exact: true });
  await expect(name).toBeVisible();
  const leagueUrl = page.url().replace(/\/league$/, "");
  const tabs = page.getByRole("navigation", { name: "League" });
  for (const [tab, path] of [
    ["Picks", ""],
    ["Results", "/results"],
    ["Standings", "/standings"],
    ["Messages", "/messages"],
    ["League", "/league"],
  ]) {
    await expect(tabs.getByRole("link", { name: tab, exact: true })).toHaveAttribute(
      "href",
      new URL(leagueUrl).pathname + path,
    );
  }

  // Once the league is on screen, a tab change keeps it there: the "Loading league" placeholder never comes
  // back. Watched in the page, so a placeholder that flashes for a frame is caught too.
  await page.evaluate(`(() => {
    window.loadingSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[aria-label="Loading league"]')) window.loadingSeen = true;
    }).observe(document.body, { childList: true, subtree: true });
  })()`);
  for (const tab of ["Picks", "Results", "Standings", "Messages", "League"]) {
    await tabs.getByRole("link", { name: tab, exact: true }).click();
    await expect(tabs.getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(name).toBeVisible();
  }
  expect(await page.evaluate("window.loadingSeen")).toBe(false);

  // From a computer's keyboard, Tab moves along the tabs and Enter opens one. (Checked on the desktop project:
  // WebKit's Tab skips links unless the system setting says otherwise.)
  if (test.info().project.name !== "chromium") return;
  await tabs.getByRole("link", { name: "Standings", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(tabs.getByRole("link", { name: "Messages", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`${leagueUrl}/messages`);
  await expect(tabs.getByRole("link", { name: "Messages", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(name).toBeVisible();
});
