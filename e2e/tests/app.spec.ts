import { expect, signUp, test } from "./fixtures";

test("signed-out visitors can explore the landing page and public guide", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "POW Pick'em", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Beat the spread/ })).toBeVisible();
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
  await page.getByRole("link", { name: "For admins", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Create your league and invite the crew" }),
  ).toBeInViewport();
  await page.reload();
  await expect(page.getByRole("heading", { name: "How to play", exact: true })).toBeAttached();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Sign in", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("signed-in users can read the guide and return to their leagues", async ({ page, signedIn }) => {
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
  await page.getByRole("button", { name: signedIn.displayName }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

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

test("admins have equal authority and can step down while keeping one admin", async ({
  page,
  browser,
  signedIn: _,
}) => {
  await page.getByLabel("League name").fill("Shared administration");
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "Shared administration" })).toBeVisible();
  const leagueUrl = page.url();
  const inviteUrl = await page.getByLabel(/Invite link/).inputValue();
  const contexts = [];
  try {
    for (const name of ["Pat", "Sam"]) {
      const context = await browser.newContext();
      contexts.push(context);
      const player = await context.newPage();
      await player.goto(inviteUrl);
      await signUp(player, name);
      await player.getByRole("button", { name: "Join league" }).click();
      await expect(player.getByRole("heading", { name: "Shared administration" })).toBeVisible();
      await player.goto(leagueUrl);
      await expect(player.getByRole("button", { name: "Create week" })).toHaveCount(0);
      await expect(player.getByRole("button", { name: /Make .* an admin/ })).toHaveCount(0);

      await page.reload();
      await page.getByRole("button", { name: `Make ${name} an admin` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("button", { name: `Make ${name} an admin` })).toBeVisible();
      await page.getByRole("button", { name: `Make ${name} an admin` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Make admin", exact: true }).click();
      await expect(page.getByRole("button", { name: `Revoke admin access for ${name}` })).toBeVisible();
      await player.reload();
      await expect(player.getByRole("button", { name: "Create week" })).toBeVisible();
      await expect(player.getByRole("button", { name: "Revoke admin access for Commish" })).toBeEnabled();
      await expect(player.getByRole("button", { name: "Remove Commish", exact: true })).toBeEnabled();
    }
    const pat = contexts[0]?.pages()[0];
    if (!pat) throw new Error("Missing Pat's page");
    await pat.getByLabel("Import games and spreads from ESPN").uncheck();
    await pat.getByRole("button", { name: "Create week" }).click();
    await expect(pat.getByRole("heading", { name: /Week 1 · / })).toBeVisible();

    await pat.goto(leagueUrl);
    await pat.getByRole("button", { name: "Revoke admin access for Commish" }).click();
    await pat.getByRole("alertdialog").getByRole("button", { name: "Revoke admin", exact: true }).click();
    await expect(pat.getByRole("button", { name: "Make Commish an admin" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Create week" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Revoke admin access/ })).toHaveCount(0);
    await expect(page.getByLabel(/Invite link/)).toHaveCount(0);

    await pat.getByRole("button", { name: "Revoke admin access for Pat" }).click();
    await pat.getByRole("alertdialog").getByRole("button", { name: "Revoke admin", exact: true }).click();
    await expect(pat.getByLabel(/Invite link/)).toHaveCount(0);
    const sam = contexts[1]?.pages()[0];
    if (!sam) throw new Error("Missing Sam's page");
    await sam.reload();
    await expect(sam.getByRole("button", { name: "Revoke admin access for Sam" })).toBeDisabled();
    await sam.getByRole("button", { name: "Remove Commish", exact: true }).click();
    await sam.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
    await expect(sam.getByText("Commish", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("League not found");
  } finally {
    for (const context of contexts) await context.close();
  }
});

/** A `datetime-local` value a few days out, so every pick window is still open. */
function kickoffInDays(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T13:00`;
}

test("admins choose one season across tabs and manage existing weeks without duplicates", async ({
  page,
  signedIn: _,
}) => {
  await page.getByLabel("League name").fill("Season choices");
  await page.getByRole("button", { name: "Create league" }).click();
  const originalYear = await page.getByRole("combobox", { name: "Season", exact: true }).inputValue();
  await page.getByLabel("Import games and spreads from ESPN").uncheck();
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
  await page.getByLabel("Import games and spreads from ESPN").uncheck();
  await page.getByRole("button", { name: "Create week" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Week 1 · ${nextYear}`) })).toBeVisible();
  for (const tab of ["Standings", "Results", "League"]) {
    await page.getByRole("link", { name: tab, exact: true }).click();
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
  await page.getByLabel("League name").fill("Pick priorities");
  await page.getByRole("button", { name: "Create league" }).click();
  const originalYear = await page.getByRole("combobox", { name: "Season", exact: true }).inputValue();

  for (const days of [-3, 3]) {
    await page.getByLabel("Import games and spreads from ESPN").uncheck();
    await page.getByRole("button", { name: "Create week" }).click();
    await page.getByLabel("Away team").selectOption("KC");
    await page.getByLabel("Home team").selectOption("ATL");
    await page.getByLabel("Kickoff (your local time)").fill(kickoffInDays(days));
    await page.getByLabel("Home spread", { exact: true }).fill("3.5");
    await page.getByRole("button", { name: "Add game" }).click();
    await page.getByRole("button", { name: "Open week for picks" }).click();
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
  await page.getByRole("button", { name: "Use season" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No week is open" })).toBeVisible();
});

test("a league week from setup to results", async ({ page, browser, signedIn: _ }) => {
  // The admin starts a league, which lands on its League tab, and sets up a week by hand (no schedule import,
  // so the test stays offline).
  await page.getByLabel("League name").fill("E2E League");
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "E2E League" })).toBeVisible();
  const inviteUrl = await page.getByLabel(/Invite link/).inputValue();

  await page.getByLabel("Import games and spreads from ESPN").uncheck();
  await page.getByRole("button", { name: "Create week" }).click();
  await expect(page.getByRole("heading", { name: /Week 1 · / })).toBeVisible();

  await page.getByLabel("Away team").selectOption("KC");
  await page.getByLabel("Home team").selectOption("ATL");
  await page.getByLabel("Kickoff (your local time)").fill(kickoffInDays(3));
  await page.getByLabel("Home spread", { exact: true }).fill("3.5");
  await page.getByRole("button", { name: "Add game" }).click();
  await expect(page.getByRole("row", { name: /KC at ATL/ })).toBeVisible();

  await page.getByRole("button", { name: "Open week for picks" }).click();

  // Picks are made on their own screen. The admin takes the Chiefs as their POW; saving stays on the sheet.
  await page.getByRole("link", { name: "Make your own picks" }).click();
  await page.getByRole("button", { name: "Chiefs -3.5" }).click();
  await page.getByRole("button", { name: "POW: KC at ATL" }).click();
  await page.getByLabel(/Tiebreaker/).fill("44");
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Picks saved.")).toBeVisible();
  await expect(page.getByText("1 of 1 picked")).toBeVisible();

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
  await expect(player.getByText("Picks saved.")).toBeVisible();

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
  await expect(page.getByText("Winner: Commish")).toBeVisible();

  // Now the player can see everyone's picks, and the standings credit the winner.
  await player.reload();
  await expect(player.getByRole("heading", { name: "No week is open" })).toBeVisible();
  await player.getByRole("link", { name: "Results", exact: true }).click();
  await expect(player.getByText("Won by Commish")).toBeVisible();
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
