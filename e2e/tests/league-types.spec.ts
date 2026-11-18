import { expect, kickoffInDays, openNewLeague, test } from "./fixtures";

/*
 * Playoff pick'em and Survivor on real time, on the desktop and phone projects: what a new league of each type
 * looks like before the feed brings anything (the local Worker's scripted feed is empty here), and a playoff
 * round set up by hand. The rounds and pools that run themselves are playoff.sim.spec.ts and survivor.sim.spec.ts.
 */

test("a Playoff pick'em league waits for the Wild Card round, and a round set up by hand can be picked", async ({
  page,
  signedIn: _,
}) => {
  await openNewLeague(page);
  await page.getByRole("radio", { name: "Playoff pick'em" }).click();
  await page.getByLabel("League name").fill("Bracket night");
  await expect(page.getByRole("combobox", { name: "Format", exact: true })).toHaveValue("traditional");
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "Bracket night", exact: true })).toBeVisible();
  // The season selector names the playoffs, and the tabs are weekly pick'em's.
  await expect(page.getByRole("combobox", { name: "Season", exact: true })).toContainText(/\d{4} playoffs/);
  const tabs = page.getByRole("navigation", { name: "League" }).getByRole("link");
  await expect(tabs).toHaveText(["Picks", "Results", "Standings", "Messages", "League"]);
  const tab = (name: string) => tabs.and(page.getByRole("link", { name, exact: true }));

  // Before the feed lists the Wild Card round there is nothing to pick, and the Picks tab says what opens it.
  await tab("Picks").click();
  await expect(page.getByRole("heading", { name: "No round is open" })).toBeVisible();
  await expect(
    page.getByText("The Wild Card round opens by itself once its games and lines are posted"),
  ).toBeVisible();

  // The commissioner's fallback when the schedule doesn't come through: a round set up by hand. The Super Bowl,
  // whose one game is typed in; a line on every game opens it.
  await tab("League").click();
  const rounds = page.getByRole("region", { name: "Rounds" });
  await expect(rounds).toContainText("No round yet.");
  await rounds.getByRole("combobox", { name: "Round", exact: true }).selectOption({ label: "Super Bowl" });
  await rounds.getByRole("checkbox", { name: "Auto-fill games and spreads" }).uncheck();
  await rounds.getByRole("button", { name: "Create round" }).click();
  await expect(page.getByRole("heading", { name: /^Super Bowl · / })).toBeVisible();
  await expect(
    page.getByText("No games yet. Use Auto-fill games and spreads above, or add games below."),
  ).toBeVisible();
  await page.getByLabel("Away team").selectOption("BUF");
  await page.getByLabel("Home team").selectOption("PHI");
  await page.getByLabel(/^Kickoff \(.* time\)$/).fill(kickoffInDays(3));
  await page.getByLabel("Home spread", { exact: true }).fill("-3");
  await page.getByRole("button", { name: "Add game" }).click();
  await expect(page.getByText("Accepting picks", { exact: true })).toBeVisible();
  // The Super Bowl round is worth 4.
  await expect(page.getByLabel("Points for BUF at PHI")).toHaveValue("4");

  // The Super Bowl has no Pick of the Week: one pick and the total guess.
  await page.getByRole("link", { name: "Make your own picks" }).click();
  await expect(page.getByRole("heading", { name: /^Super Bowl/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^POW:/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Eagles -3, home" }).click();
  await page.getByLabel("Tiebreaker: total points scored in BUF at PHI").fill("47");
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Picks saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Eagles -3, home" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Tiebreaker: total points scored in BUF at PHI")).toHaveValue("47");
});

test("a Survivor pool waits for its start week, and has no Results tab", async ({ page, signedIn: _ }) => {
  await openNewLeague(page);
  await page.getByRole("radio", { name: "Survivor" }).click();
  await page.getByLabel("League name").fill("Last one in");
  await expect(page.getByRole("combobox", { name: "Lives", exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "Last one in", exact: true })).toBeVisible();
  const leagueUrl = page.url().replace(/\/league$/, "");
  const tabs = page.getByRole("navigation", { name: "League" }).getByRole("link");
  await expect(tabs).toHaveText(["Pick", "Standings", "Messages", "League"]);
  const tab = (name: string) => tabs.and(page.getByRole("link", { name, exact: true }));
  // The commissioner can change the pool's settings until its start week kicks off.
  const settings = page.getByRole("region", { name: "Start season" });
  await expect(settings.getByRole("heading", { name: "Survivor pool" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Save pool settings" })).toBeDisabled();
  const startWeek = await settings.getByRole("combobox", { name: "Start week", exact: true }).inputValue();

  // The Pick tab: everyone starts in, and the start week opens once its games are on the schedule.
  await tab("Pick").click();
  await expect(page.getByRole("heading", { name: "Your pick" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your status" })).toContainText("You're still in");
  await expect(page.getByRole("heading", { name: "No week is being played" })).toBeVisible();
  await expect(
    page.getByText(
      `The pool starts with Week ${startWeek}. It opens as soon as its games are on the pro football schedule.`,
    ),
  ).toBeVisible();

  // A survivor pool has no Results tab: its path is the not-found screen.
  await page.goto(`${leagueUrl}/results`);
  await expect(page.getByRole("alert").getByRole("heading", { name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Your leagues" }).click();
  await expect(page.getByRole("link", { name: /Last one in/ })).toContainText("Survivor");
});
