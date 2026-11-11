import { expect, signUp, test } from "./fixtures";

test("signed-out visitors see the sign-in form", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Weekly Picks" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("a user can sign out and sign back in", async ({ page, signedIn }) => {
  await page.getByRole("button", { name: "Sign out" }).click();
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

/** A `datetime-local` value a few days out, so every pick window is still open. */
function kickoffInDays(days: number) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T13:00`;
}

test("a league week from setup to results", async ({ page, browser, signedIn: _ }) => {
  page.on("dialog", (dialog) => dialog.accept());

  // The admin starts a league and sets up a week by hand (no schedule import, so the test stays offline).
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

  // Picks are made on their own screen. The admin takes the Chiefs as their POW; saving returns to the league.
  await page.getByRole("link", { name: "Make your own picks" }).click();
  await page.getByRole("button", { name: "Chiefs -3.5" }).click();
  await page.getByRole("button", { name: "POW: KC at ATL" }).click();
  await page.getByLabel(/Tiebreaker/).fill("44");
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Week 1 picks saved: 1 of 1 games picked.")).toBeVisible();
  await expect(page.getByText("Open: all 1 picked")).toBeVisible();

  // A second person follows the invite link, signs up, joins and takes the Falcons.
  const context = await browser.newContext();
  const player = await context.newPage();
  await player.goto(inviteUrl);
  await expect(player.getByText("Sign in or create an account to join the league.")).toBeVisible();
  await signUp(player, "Pat");
  await player.getByRole("button", { name: "Join league" }).click();
  await expect(player.getByRole("heading", { name: "E2E League" })).toBeVisible();
  await expect(player.getByText("Open: you haven't picked yet")).toBeVisible();
  await player.getByRole("link", { name: "Week 1" }).click();
  await player.getByRole("button", { name: "Falcons +3.5" }).click();
  await player.getByRole("button", { name: "Save picks" }).click();
  await expect(player.getByText("Week 1 picks saved: 1 of 1 games picked.")).toBeVisible();

  // While the week is open the player sees only their own pick: the Chiefs button is not selected.
  await player.getByRole("link", { name: "Week 1" }).click();
  await expect(player.getByRole("button", { name: "Falcons +3.5" })).toHaveAttribute("aria-pressed", "true");
  await expect(player.getByRole("button", { name: "Chiefs -3.5" })).toHaveAttribute("aria-pressed", "false");
  await expect(player.getByRole("button", { name: "Chiefs -3.5" })).toBeEnabled();
  await expect(player.getByRole("table", { name: "Week results" })).toHaveCount(0);
  // Players have no way into the management screen.
  await expect(player.getByRole("link", { name: "Manage this week" })).toHaveCount(0);

  // The admin sees that both have picked and enters the final score.
  await page.getByRole("link", { name: "Manage Week 1" }).click();
  await expect(page.getByRole("row", { name: /Pat/ })).toContainText("1 of 1");
  await page.getByLabel("KC score in KC at ATL").fill("30");
  await page.getByLabel("ATL score in KC at ATL").fill("10");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();

  // With a result in, the game is closed to picks even though it hasn't kicked off.
  await player.reload();
  await expect(player.getByText("Final 30–10")).toBeVisible();
  await expect(player.getByRole("button", { name: "Chiefs -3.5" })).toBeDisabled();
  await expect(player.getByRole("button", { name: "Falcons +3.5" })).toBeDisabled();

  await page.getByRole("button", { name: "Close week" }).click();
  await expect(page.getByText("Winner: Commish")).toBeVisible();

  // Now the player can see everyone's picks, and the standings credit the winner.
  await player.reload();
  const results = player.getByRole("table", { name: "Week results" });
  await expect(results.getByRole("row", { name: /Commish/ })).toContainText("KC POW");
  await expect(results.getByRole("row", { name: /Pat/ })).toContainText("ATL");
  await player.getByRole("link", { name: /E2E League/ }).click();
  await expect(player.getByText("Won by Commish")).toBeVisible();
  const standings = player.getByRole("table", { name: "Season standings" });
  await expect(standings.getByRole("row").nth(1)).toContainText("Commish");
  await context.close();
});
