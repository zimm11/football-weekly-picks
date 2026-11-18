import type { Page } from "@playwright/test";
import {
  dismissHomeScreenOffer,
  expect,
  joinLeague,
  kickoffInDays,
  openNewLeague,
  signOut,
  signUp,
  test,
} from "./fixtures";

/** Opens a member's "⋯" menu on the League tab and chooses one of its actions. */
async function memberAction(page: Page, member: string, action: string) {
  await page.getByRole("button", { name: `Options for ${member}` }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

test("the browser can't leave this machine, so no test touches production", async ({ browser, page }) => {
  await expect(page.goto("https://www.pow-pickem.com/")).rejects.toThrow();
  const context = await browser.newContext();
  try {
    await expect((await context.newPage()).goto("https://www.pow-pickem.com/join/x")).rejects.toThrow();
  } finally {
    await context.close();
  }
  // Local servers are still reachable.
  await expect((await page.goto("/"))?.ok()).toBe(true);
});

test("signed-out visitors can explore the landing page and public guide", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "POW Pick'em", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Beat the spread/ })).toBeVisible();
  // The other games are a quieter strip under the weekly pitch, each opening its own How to play tab.
  await page.getByRole("link", { name: "How Survivor works" }).click();
  await expect(page).toHaveURL(/\/how-to-play\?section=survivor$/);
  await expect(page.getByRole("tab", { name: "Survivor" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Survivor", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The pick rules" })).not.toBeAttached();
  await page.getByRole("tab", { name: "Weekly pick'em" }).click();
  await expect(page).toHaveURL(/\/how-to-play\?section=weekly$/);
  await expect(page.getByRole("heading", { name: "The pick rules" })).toBeVisible();
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email")).toBeInViewport();
  await expect(page.getByLabel("Password")).toBeInViewport();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "How to play" })
    .click();
  await expect(page).toHaveURL(/\/how-to-play$/);
  await expect(page.getByRole("heading", { name: "The pick rules" })).toBeVisible();
  await page.getByRole("link", { name: "For commissioners", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set up a draft week" })).toBeInViewport();
  // What every league shares sits under the tabs, whichever game is chosen.
  await expect(page.getByRole("heading", { name: "Start a league of your own" })).toBeAttached();
  await page.reload();
  await expect(page.getByRole("heading", { name: "How to play", exact: true })).toBeAttached();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("signed-out visitors can read the Privacy policy and the Terms of use", async ({ page }) => {
  // The App Store listing links straight to both pages.
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy policy", exact: true })).toBeVisible();
  await expect(page.getByText(/^Last updated /)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Deleting your account" })).toBeVisible();
  await page.getByRole("link", { name: "Terms of use", exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { name: "Terms of use", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Who can use it" })).toBeVisible();
  // And the sign-in form links to them before an account exists.
  await page.goto("/login");
  await page.getByRole("link", { name: "Privacy policy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy policy", exact: true })).toBeVisible();
});

test("signed-in users can read the guide and return to their leagues", async ({
  page,
  signedIn,
  isMobile,
}) => {
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  if (isMobile) {
    // An iPhone browser tab: the device card already shows the install steps.
    await expect(page.getByRole("heading", { name: "iPhone or iPad · Safari" })).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Show me how" }).click();
    const steps = page.getByRole("dialog", { name: "Add it to your home screen" });
    await expect(steps).toBeVisible();
    await expect(page).toHaveURL(/\/account$/);
    await steps.getByRole("button", { name: "Close", exact: true }).click();
    await expect(steps).toHaveCount(0);
  }
  await page.getByRole("link", { name: "How to play", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How to play", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  await page.getByRole("link", { name: "For players", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Press Save picks" })).toBeVisible();
  await page.getByRole("link", { name: "Go to your leagues" }).first().click();
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
});

test("a user can sign out and sign back in", async ({ page, signedIn }) => {
  // Sign out lives in the account menu, under the player's name.
  await signOut(page, signedIn.displayName);

  await page.getByLabel("Email").fill(signedIn.email);
  await page.getByLabel("Password").fill(signedIn.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The display name chosen at sign-up is remembered.
  await expect(page.getByRole("button", { name: signedIn.displayName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your leagues" })).toBeVisible();
});

test("the API rejects unauthenticated requests", async ({ request }) => {
  expect((await request.get("/api/leagues")).status()).toBe(401);
});

test("a player can leave a league, but its only admin can't", async ({ page, browser, signedIn: _ }) => {
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Leaving soon");
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "Leaving soon" })).toBeVisible();
  const inviteUrl = await page.getByLabel("Invite link", { exact: true }).inputValue();
  await expect(page.getByRole("button", { name: "Leave league" })).toBeDisabled();

  const { context, page: player } = await joinLeague(browser, inviteUrl, "Pat");
  try {
    await expect(player.getByRole("heading", { name: "Leaving soon" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "Members" })).toContainText("Pat");

    await player.getByRole("link", { name: "League", exact: true }).click();
    await player.getByRole("button", { name: "Leave league" }).click();
    await player.getByRole("alertdialog").getByRole("button", { name: "Leave league" }).click();
    await expect(player.getByText("You left Leaving soon.")).toBeVisible();
    await expect(player.getByRole("heading", { name: "Your leagues" })).toBeVisible();
    await expect(player.getByRole("link", { name: /Leaving soon/ })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("region", { name: "Members" })).toContainText("Commish");
    await expect(page.getByRole("region", { name: "Members" })).not.toContainText("Pat");
  } finally {
    await context.close();
  }
});

test("admins have equal authority and can step down while keeping one admin", async ({
  page,
  browser,
  signedIn: _,
}) => {
  // Three players, several reloads and a menu per admin action: this runs close to the default 30s.
  test.slow();
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Shared administration");
  await page.getByRole("radio", { name: "Hands-on" }).click();
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "Shared administration" })).toBeVisible();
  const leagueUrl = page.url();
  const inviteUrl = await page.getByLabel("Invite link", { exact: true }).inputValue();
  const contexts = [];
  try {
    for (const name of ["Pat", "Sam"]) {
      const { context, page: player } = await joinLeague(browser, inviteUrl, name);
      contexts.push(context);
      await expect(player.getByRole("heading", { name: "Shared administration" })).toBeVisible();
      await player.goto(leagueUrl);
      // A player's League tab: the members, and nothing to run the league with (their own row has no menu).
      await expect(player.getByRole("region", { name: "Members" })).toContainText(name);
      await expect(player.getByRole("button", { name: "Create week" })).toHaveCount(0);
      await expect(player.getByRole("button", { name: `Options for ${name}` })).toHaveCount(0);
      await expect(player.getByLabel("Invite link", { exact: true })).toHaveCount(0);

      await page.reload();
      await memberAction(page, name, `Make ${name} a commissioner`);
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
      await memberAction(page, name, `Make ${name} a commissioner`);
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Make commissioner", exact: true })
        .click();
      await page.getByRole("button", { name: `Options for ${name}` }).click();
      await expect(
        page.getByRole("menuitem", { name: `Revoke commissioner access for ${name}` }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await player.reload();
      await expect(player.getByRole("button", { name: "Create week" })).toBeVisible();
      await player.getByRole("button", { name: "Options for Commish" }).click();
      await expect(
        player.getByRole("menuitem", { name: "Revoke commissioner access for Commish" }),
      ).toBeEnabled();
      await expect(player.getByRole("menuitem", { name: "Remove Commish", exact: true })).toBeEnabled();
      await player.keyboard.press("Escape");
    }
    const pat = contexts[0]?.pages()[0];
    if (!pat) throw new Error("Missing Pat's page");
    await pat.getByLabel("Auto-fill games and spreads").uncheck();
    await pat.getByRole("button", { name: "Create week" }).click();
    await expect(pat.getByRole("heading", { name: /Week 1 · / })).toBeVisible();

    await pat.goto(leagueUrl);
    await memberAction(pat, "Commish", "Revoke commissioner access for Commish");
    await pat
      .getByRole("alertdialog")
      .getByRole("button", { name: "Revoke commissioner", exact: true })
      .click();
    await pat.getByRole("button", { name: "Options for Commish" }).click();
    await expect(pat.getByRole("menuitem", { name: "Make Commish a commissioner" })).toBeVisible();
    await pat.keyboard.press("Escape");
    await page.reload();
    // Back to a player: the members are still listed, without the commissioner's tools.
    await expect(page.getByRole("region", { name: "Members" })).toContainText("Commish");
    await expect(page.getByRole("button", { name: "Create week" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Options for Commish" })).toHaveCount(0);
    await expect(page.getByLabel("Invite link", { exact: true })).toHaveCount(0);

    await memberAction(pat, "Pat", "Revoke commissioner access for Pat");
    await pat
      .getByRole("alertdialog")
      .getByRole("button", { name: "Revoke commissioner", exact: true })
      .click();
    await expect(pat.getByLabel("Invite link", { exact: true })).toHaveCount(0);
    const sam = contexts[1]?.pages()[0];
    if (!sam) throw new Error("Missing Sam's page");
    await sam.reload();
    await sam.getByRole("button", { name: "Options for Sam" }).click();
    await expect(sam.getByRole("menuitem", { name: "Revoke commissioner access for Sam" })).toBeDisabled();
    await sam.keyboard.press("Escape");
    await memberAction(sam, "Commish", "Remove Commish");
    await sam.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(sam.getByText("Commish", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("alert").getByRole("heading", { name: "League not found" })).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
  }
});

test("admins choose one season across tabs and manage existing weeks without duplicates", async ({
  page,
  signedIn: _,
}) => {
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Season choices");
  await page.getByRole("radio", { name: "Hands-on" }).click();
  await page.getByRole("button", { name: "Create league" }).click();
  const originalYear = await page.getByRole("combobox", { name: "Season", exact: true }).inputValue();
  await page.getByLabel("Auto-fill games and spreads").uncheck();
  await page.getByRole("button", { name: "Create week" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Week 1 · ${originalYear}`) })).toBeVisible();
  await page.getByRole("link", { name: "League", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Week", exact: true })).toHaveValue("2");
  await page.getByRole("combobox", { name: "Week", exact: true }).selectOption("1");
  await expect(page.getByRole("link", { name: "Manage week", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create week" })).toHaveCount(0);

  await page.getByRole("combobox", { name: "Season", exact: true }).selectOption("new");
  const nextYear = String(Number(originalYear) + 1);
  await page.getByLabel("New season year").fill(nextYear);
  await page.getByRole("button", { name: "Use season" }).click();
  await expect(page.getByRole("combobox", { name: "Week", exact: true })).toHaveValue("1");
  await page.getByLabel("Auto-fill games and spreads").uncheck();
  await page.getByRole("button", { name: "Create week" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Week 1 · ${nextYear}`) })).toBeVisible();
  for (const tab of ["Standings", "Results", "League"]) {
    await page.getByRole("link", { name: tab, exact: true }).click();
    await expect(page.getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("combobox", { name: "Season", exact: true })).toHaveValue(nextYear);
  }
  await page.getByRole("combobox", { name: "Season", exact: true }).selectOption(originalYear);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Season", exact: true })).toHaveValue(originalYear);
  await expect(page.getByRole("combobox", { name: "Week", exact: true })).toHaveValue("2");
});

test("upcoming picks take priority over unfinished past weeks and season changes guard unsaved picks", async ({
  page,
  signedIn: _,
}) => {
  await openNewLeague(page);
  await page.getByLabel("League name").fill("Pick priorities");
  await page.getByRole("radio", { name: "Hands-on" }).click();
  await page.getByRole("button", { name: "Create league" }).click();
  const originalYear = await page.getByRole("combobox", { name: "Season", exact: true }).inputValue();

  for (const [week, days] of [
    [1, -3],
    [2, 3],
  ] as const) {
    // The League tab can show the league as it was remembered for a moment: wait for the week it suggests now.
    await expect(page.getByRole("combobox", { name: "Week", exact: true })).toHaveValue(String(week));
    await page.getByLabel("Auto-fill games and spreads").uncheck();
    await page.getByRole("button", { name: "Create week" }).click();
    await page.getByLabel("Away team").selectOption("KC");
    await page.getByLabel("Home team").selectOption("ATL");
    await page.getByLabel(/^Kickoff \(.* time\)$/).fill(kickoffInDays(days));
    await page.getByLabel("Home spread", { exact: true }).fill("3.5");
    await page.getByRole("button", { name: "Add game" }).click();
    await page.getByRole("button", { name: "Open week for picks" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("link", { name: "League", exact: true }).click();
  }
  await page.getByRole("link", { name: "Picks", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Week 2 · / })).toBeVisible();
  await page.getByRole("button", { name: "Chiefs -3.5" }).click();
  await page.getByRole("combobox", { name: "Season", exact: true }).selectOption("new");
  await page.getByLabel("New season year").fill(String(Number(originalYear) + 1));
  await page.getByRole("button", { name: "Use season" }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Chiefs -3.5" })).toHaveAttribute("aria-pressed", "true");

  // The browser's back button (a phone's back gesture) asks too, and staying keeps the sheet as it was.
  const picksUrl = page.url();
  await page.evaluate("window.history.back()");
  await expect(page.getByRole("alertdialog")).toContainText("Leave without saving?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  expect(page.url()).toBe(picksUrl);
  await expect(page.getByRole("button", { name: "Chiefs -3.5" })).toHaveAttribute("aria-pressed", "true");
  // So does signing out from the account menu.
  await page.getByRole("button", { name: "Commish" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Chiefs -3.5" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Use season" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No week is open" })).toBeVisible();
});

test("a league week from setup to results", async ({ page, browser, signedIn: _ }) => {
  // A whole week across two players runs close to the default 30s.
  test.slow();
  // The admin starts a league, which lands on its League tab, and sets up a week by hand (no schedule import,
  // so the test stays offline).
  await openNewLeague(page);
  await page.getByLabel("League name").fill("E2E League");
  await page.getByRole("radio", { name: "Hands-on" }).click();
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "E2E League" })).toBeVisible();
  const inviteUrl = await page.getByLabel("Invite link", { exact: true }).inputValue();

  await page.getByLabel("Auto-fill games and spreads").uncheck();
  await page.getByRole("button", { name: "Create week" }).click();
  await expect(page.getByRole("heading", { name: /Week 1 · / })).toBeVisible();

  await page.getByLabel("Away team").selectOption("KC");
  await page.getByLabel("Home team").selectOption("ATL");
  await page.getByLabel(/^Kickoff \(.* time\)$/).fill(kickoffInDays(3));
  await page.getByLabel("Home spread", { exact: true }).fill("3.5");
  await page.getByRole("button", { name: "Add game" }).click();
  await expect(page.getByRole("row", { name: /KC at ATL/ })).toBeVisible();

  await page.getByRole("button", { name: "Open week for picks" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

  // Picks are made on their own screen. The admin takes the Chiefs as their POW; saving stays on the sheet.
  await page.getByRole("link", { name: "Make your own picks" }).click();
  await page.getByRole("button", { name: "Chiefs -3.5" }).click();
  await page.getByRole("button", { name: "POW: KC at ATL" }).click();
  await page.getByLabel(/Tiebreaker/).fill("45");
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Picks saved.", { exact: true })).toBeVisible();
  await dismissHomeScreenOffer(page);
  await expect(page.getByText("1 of 1 picked")).toBeVisible();
  // The home screen is suggested once per browser: a second save doesn't bring it back.
  await page.getByLabel(/Tiebreaker/).fill("44");
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Picks saved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Add it to your home screen" })).toHaveCount(0);

  // A second person follows the invite link, signs up, joins and takes the Falcons.
  const context = await browser.newContext();
  const player = await context.newPage();
  await player.goto(inviteUrl);
  await expect(player.getByText("Sign in or create an account to join the league.")).toBeVisible();
  await signUp(player, "Pat");
  await player.getByRole("button", { name: "Join league" }).click();
  await expect(player.getByRole("heading", { name: "E2E League" })).toBeVisible();
  // The league opens on the Picks tab, which is the open week's pick sheet.
  await expect(player.getByRole("link", { name: "Picks", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(player.getByText("0 of 1 picked")).toBeVisible();
  await player.getByRole("button", { name: "Falcons +3.5" }).click();
  await player.getByRole("button", { name: "Save picks" }).click();
  await expect(player.getByText("Picks saved.", { exact: true })).toBeVisible();
  await dismissHomeScreenOffer(player);

  // While the week is open the player sees only their own pick: the Chiefs button is not selected.
  await player.reload();
  await expect(player.getByRole("button", { name: "Falcons +3.5" })).toHaveAttribute("aria-pressed", "true");
  await expect(player.getByRole("button", { name: "Chiefs -3.5" })).toHaveAttribute("aria-pressed", "false");
  await expect(player.getByRole("button", { name: "Chiefs -3.5" })).toBeEnabled();
  await expect(player.getByRole("table", { name: "Week results" })).toHaveCount(0);
  // Players have no way into the management screen.
  await expect(player.getByRole("link", { name: "Manage week" })).toHaveCount(0);

  // The admin sees that both have picked and enters the final score.
  await page.getByRole("link", { name: "Manage week" }).click();
  await expect(page.getByRole("row", { name: /Pat/ })).toContainText("1 of 1");
  // The game hasn't kicked off, so its score boxes wait behind "Enter score".
  await page.getByRole("button", { name: "Enter score for KC at ATL" }).click();
  await page.getByLabel("KC score in KC at ATL").fill("30");
  await page.getByLabel("ATL score in KC at ATL").fill("10");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ready to finalize" })).toBeVisible();

  // With a result in, the game is closed to picks even though it hasn't kicked off.
  await player.reload();
  await expect(player.getByText("Final 30–10")).toBeVisible();
  await expect(player.getByRole("button", { name: "Chiefs -3.5" })).toBeDisabled();
  await expect(player.getByRole("button", { name: "Falcons +3.5" })).toBeDisabled();

  await page.getByRole("button", { name: "Finalize week" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Finalize week" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Winner: Commish");
  await page.getByRole("alertdialog").getByRole("button", { name: "Write message" }).click();
  // The dialog is gone before the draft is typed: while it closes it can take the focus back.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const announcementResults = page.getByRole("region", { name: "Final results", exact: true });
  await expect(announcementResults).toContainText("Commish");
  await expect(announcementResults).toContainText("Pat");
  await expect(announcementResults).toContainText("Winner");
  await expect(announcementResults).toContainText("Tiebreaker guess: 44");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Congratulations Commish! Great POW pick this week.");
  await page.getByRole("link", { name: "See all picks and game scores" }).click();
  await expect(page.getByRole("table", { name: "Week results" })).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Congratulations Commish! Great POW pick this week.",
  );
  await page.getByRole("button", { name: "Create thread" }).click();
  await expect(page.getByRole("heading", { name: "Post a league message" })).not.toBeVisible();
  await expect(page.getByText("Winner: Commish")).toBeVisible();

  // The admin closed the week, so the recap isn't sprung on them as well.
  await page.getByRole("link", { name: "Picks", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No week is open" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The player's next visit opens with the recap, which names them the Low Point Loser. It shows once.
  await player.reload();
  const recap = player.getByRole("dialog", { name: "Week 1 is final" });
  await expect(recap).toContainText("You're this week's Low Point Loser");
  await expect(recap.getByRole("region", { name: "Week awards" })).toContainText("Commish");
  await recap.getByRole("button", { name: "Close" }).click();
  await expect(recap).toHaveCount(0);
  await player.reload();
  await expect(player.getByRole("heading", { name: "No week is open" })).toBeVisible();
  await expect(player.getByRole("dialog")).toHaveCount(0);

  // Now the player can see everyone's picks, and the standings credit the winner.
  await player.getByRole("link", { name: "Results", exact: true }).click();
  await expect(player.getByText("Won by Commish")).toBeVisible();
  await expect(player.getByText("LPL: Pat")).toBeVisible();
  await player.getByRole("link", { name: /Week 1/ }).click();
  const results = player.getByRole("table", { name: "Week results" });
  await expect(results.getByRole("row", { name: /Commish/ })).toContainText("KC POW");
  await expect(results.getByRole("row", { name: /Pat/ })).toContainText("ATL");
  await player.getByRole("link", { name: "Standings" }).click();
  const standings = player.getByRole("table", { name: "Season standings" });
  await expect(standings.getByRole("row").nth(1)).toContainText("Commish");
  // The player's own season sits above the table, and the week-by-week grid marks the winner.
  await expect(player.getByRole("region", { name: "Your season stats" })).toContainText("2nd");
  await expect(
    player.getByRole("table", { name: "Points by week" }).getByRole("row", { name: /Commish/ }),
  ).toContainText("won the week");
  await context.close();
});
