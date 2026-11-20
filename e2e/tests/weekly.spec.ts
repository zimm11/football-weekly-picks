import type { Page } from "@playwright/test";
import { dismissHomeScreenOffer, expect, joinLeague, kickoffInDays, openNewLeague, test } from "./fixtures";

type NewGame = { away: string; home: string; days: number; spread: string };

/**
 * From Your leagues: a Hands-on league whose Week 1 holds `games` (typed in, so the test stays offline), opened
 * for picks. The last game is made the tiebreaker by hand: left alone it would be the last Monday game, which
 * depends on the day the test runs. Ends on the week's management screen and returns the league's invite link.
 */
async function openWeek(page: Page, league: string, games: NewGame[]) {
  await openNewLeague(page);
  await page.getByLabel("League name").fill(league);
  await page.getByRole("radio", { name: "Hands-on" }).click();
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: league })).toBeVisible();
  const inviteUrl = await page.getByLabel("Invite link", { exact: true }).inputValue();
  await page.getByLabel("Auto-fill games and spreads").uncheck();
  // A new league suggests the coming week by the calendar: this test is written for Week 1.
  await page.getByRole("combobox", { name: "Week", exact: true }).selectOption("1");
  await page.getByRole("button", { name: "Create week" }).click();
  await expect(page.getByRole("heading", { name: /Week 1 · / })).toBeVisible();
  for (const game of games) {
    await page.getByLabel("Away team").selectOption(game.away);
    await page.getByLabel("Home team").selectOption(game.home);
    await page.getByLabel(/^Kickoff \(.* time\)$/).fill(kickoffInDays(game.days));
    await page.getByLabel("Home spread", { exact: true }).fill(game.spread);
    await page.getByRole("button", { name: "Add game" }).click();
    await expect(page.getByRole("row", { name: new RegExp(`${game.away} at ${game.home}`) })).toBeVisible();
  }
  const last = games.at(-1);
  const tiebreaker = page.getByRole("radio", {
    name: `Use ${last?.away} at ${last?.home} as the tiebreaker game`,
  });
  await tiebreaker.click();
  await expect(tiebreaker).toBeChecked();
  await page.getByRole("button", { name: "Open week for picks" }).click();
  // Opening offers a message-board thread; these journeys don't post one.
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Week opened for picks.")).toBeVisible();
  return inviteUrl;
}

/** Types a game's final score on the management screen and saves it. */
async function enterScore(page: Page, game: { away: string; home: string }, away: string, home: string) {
  const name = `${game.away} at ${game.home}`;
  await page.getByLabel(`${game.away} score in ${name}`).fill(away);
  await page.getByLabel(`${game.home} score in ${name}`).fill(home);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
}

/** Finalizes the open week from its management screen, declining the announcement thread. */
async function finalizeWeek(page: Page) {
  // Once every score is in, Finalize and Auto-fill trade places: wait for that, or the click can land on the
  // wrong one as they swap.
  await expect(page.getByRole("heading", { name: "Ready to finalize" })).toBeVisible();
  await page.getByRole("button", { name: "Finalize week" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Finalize week" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Post a league message?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  // The dialog keeps its words while it fades out: wait for it to go, so text queries see only the page.
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Week results" })).toBeVisible();
}

test("a game that has kicked off is locked on the pick sheet, and the rest can still be picked", async ({
  page,
  signedIn: _,
}) => {
  const kickedOff = { away: "KC", home: "ATL", days: -1, spread: "3.5" };
  const upcoming = { away: "DAL", home: "PHI", days: 3, spread: "-2.5" };
  await openWeek(page, "Lock rules", [kickedOff, upcoming]);
  await page.getByRole("link", { name: "Make your own picks" }).click();

  // Yesterday's game was locked before the sheet opened: it folds behind one line, so the game still to pick
  // starts on the first screen, phone included.
  const fold = page.getByRole("button", { name: "1 game locked", exact: true });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Eagles -2.5, home" })).toBeInViewport();
  await expect(page.getByText("Locked", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0 of 2 picked")).toBeVisible();

  // Shown, it is one compact row: the matchup, Locked, and no pick.
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  const locked = page.getByRole("button", { name: "KC at ATL, locked, no pick", exact: true });
  await expect(locked).toHaveAttribute("aria-expanded", "false");
  await expect(locked).toContainText("No pick");
  await expect(page.getByText("Locked", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Chiefs -3.5" })).toHaveCount(0);
  // Opened, it is the game's card, where neither side nor its POW can be chosen; Stats & news is still there.
  await locked.click();
  await expect(locked).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Chiefs -3.5" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Falcons +3.5, home" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "POW: KC at ATL" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Matchup: KC at ATL" })).toBeVisible();
  await locked.click();
  await expect(locked).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Chiefs -3.5" })).toHaveCount(0);

  // The game still to come takes a pick, and the POW once it has one.
  const eagles = page.getByRole("button", { name: "Eagles -2.5, home" });
  const pow = page.getByRole("button", { name: "POW: DAL at PHI" });
  await expect(pow).toBeDisabled();
  await eagles.click();
  await expect(eagles).toHaveAttribute("aria-pressed", "true");
  await pow.click();
  await expect(pow).toHaveAttribute("aria-pressed", "true");
  // The tiebreaker game hasn't kicked off, so the guess is open too.
  await page.getByLabel("Tiebreaker: total points scored in DAL at PHI").fill("41");
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Picks saved.", { exact: true })).toBeVisible();
  await dismissHomeScreenOffer(page);
  // The status says what was saved and what the lock cost.
  const status = page.getByLabel("Pick status");
  await expect(status).toContainText("You're set for the week");
  await expect(status).toContainText("1 of 2 saved; 1 game locked without a pick. POW: DAL at PHI.");

  // Until its own kickoff the pick can change and the POW can come off again.
  await page.getByRole("button", { name: "Cowboys +2.5" }).click();
  await pow.click();
  await expect(pow).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Picks saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Cowboys +2.5" })).toHaveAttribute("aria-pressed", "true");
  await expect(eagles).toHaveAttribute("aria-pressed", "false");
  await expect(pow).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByLabel("Tiebreaker: total points scored in DAL at PHI")).toHaveValue("41");
  await page.getByRole("button", { name: "1 game locked", exact: true }).click();
  await page.getByRole("button", { name: "KC at ATL, locked, no pick", exact: true }).click();
  await expect(page.getByRole("button", { name: "Chiefs -3.5" })).toBeDisabled();
});

test("a commissioner follows a week's results so far, then reopens the final week to correct a score, and the corrected week is recapped again", async ({
  page,
  browser,
  signedIn: _,
}) => {
  // Two players, results so far, and the week closed twice.
  test.slow();
  const game = { away: "KC", home: "ATL", days: 3, spread: "3.5" };
  const later = { away: "DAL", home: "PHI", days: 3, spread: "-2.5" };
  const inviteUrl = await openWeek(page, "Second look", [game, later]);
  await page.getByRole("link", { name: "Make your own picks" }).click();
  await page.getByRole("button", { name: "Chiefs -3.5" }).click();
  await page.getByRole("button", { name: "POW: KC at ATL" }).click();
  await page.getByRole("button", { name: "Eagles -2.5, home" }).click();
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Picks saved.", { exact: true })).toBeVisible();
  await dismissHomeScreenOffer(page);

  const { context, page: player } = await joinLeague(browser, inviteUrl, "Pat");
  try {
    await player.getByRole("button", { name: "Falcons +3.5, home" }).click();
    await player.getByRole("button", { name: "Eagles -2.5, home" }).click();
    await player.getByRole("button", { name: "Save picks" }).click();
    await expect(player.getByText("Picks saved.", { exact: true })).toBeVisible();
    await dismissHomeScreenOffer(player);

    // The first score has the Chiefs covering. A game with a score is locked, though neither has kicked off.
    await page.getByRole("link", { name: "Manage week" }).click();
    await expect(page.getByRole("row", { name: /Pat/ })).toContainText("2 of 2");
    await page.getByRole("button", { name: "Enter score for KC at ATL" }).click();
    await enterScore(page, game, "30", "10");
    await expect(page.getByRole("link", { name: "See results so far" })).toBeVisible();

    // While the week is open the commissioner sees the results so far, from the Results tab: everyone's pick
    // on the scored game, and nothing on the game still to play.
    await page.getByRole("link", { name: "Results", exact: true }).click();
    await page.getByRole("link", { name: "Week 1 results so far, commissioners only" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Week 1 · Results so far" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Summary so far" })).toBeVisible();
    const soFar = page.getByRole("table", { name: "Results so far" });
    const commishRow = soFar.getByRole("row", { name: /Commish/ });
    const patRow = soFar.getByRole("row", { name: /Pat/ });
    await expect(commishRow).toContainText("KC POW");
    await expect(patRow).toContainText("ATL");
    // Both took the Eagles, but that game hasn't kicked off: each cell is held back, not drawn as a pick.
    await expect(soFar.getByLabel("DAL at PHI, hidden until kickoff.", { exact: true })).toHaveCount(2);
    await expect(commishRow).not.toContainText("PHI");
    await expect(patRow).not.toContainText("PHI");
    // Nothing is claimed before the week is final.
    await expect(soFar.getByLabel("Won the week")).toHaveCount(0);
    await expect(soFar.getByText("LPL", { exact: true })).toHaveCount(0);
    const progressUrl = page.url();

    // The player has no such row, and the page's address gives them only the rule.
    const leagueUrl = player.url();
    await player.getByRole("link", { name: "Results", exact: true }).click();
    await expect(player.getByText("No week has closed yet.")).toBeVisible();
    await expect(player.getByRole("link", { name: /results so far/ })).toHaveCount(0);
    await player.goto(progressUrl);
    await expect(player.getByRole("heading", { name: "Results so far", exact: true })).toBeVisible();
    await expect(
      player.getByText("Only league commissioners see a week's results before it is final."),
    ).toBeVisible();
    await expect(player.getByRole("link", { name: "Go to the week" })).toBeVisible();
    await expect(player.getByRole("table", { name: "Results so far" })).toHaveCount(0);

    // The commissioner turns on Show players the results so far: the player gets the same page, from their own
    // Results tab, with the game still to play held back for them too.
    await page.getByRole("link", { name: "League", exact: true }).click();
    await page.getByRole("checkbox", { name: "Show players the results so far" }).click();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("League settings saved.", { exact: true })).toBeVisible();
    await player.goto(leagueUrl);
    await expect(player.getByRole("link", { name: "See everyone's results so far" })).toBeVisible();
    await player.getByRole("link", { name: "Results", exact: true }).click();
    await player.getByRole("link", { name: "Week 1 results so far", exact: true }).click();
    await expect(player.getByText("Everyone in the league sees this.")).toBeVisible();
    const shared = player.getByRole("table", { name: "Results so far" });
    await expect(shared.getByRole("row", { name: /Commish/ })).toContainText("KC POW");
    await expect(shared.getByRole("row", { name: /Pat/ })).toContainText("ATL");
    await expect(shared.getByLabel("DAL at PHI, hidden until kickoff.", { exact: true })).toHaveCount(2);
    await expect(player.getByRole("link", { name: "Manage week" })).toHaveCount(0);
    await player.goto(leagueUrl);
    await page.goto(progressUrl);

    // The second game is scored too, and the commissioner wins the week; Pat's recap says so.
    await page.getByRole("link", { name: "Manage week", exact: true }).click();
    await page.getByRole("button", { name: "Enter score for DAL at PHI" }).click();
    await enterScore(page, later, "17", "20");
    await finalizeWeek(page);

    await player.reload();
    const recap = player.getByRole("dialog", { name: "Week 1 is final" });
    await expect(recap).toContainText("You're this week's Low Point Loser");
    await recap.getByRole("button", { name: "Close" }).click();
    await expect(recap).toHaveCount(0);
    await player.getByRole("link", { name: "Results", exact: true }).click();
    await expect(player.getByText("Won by Commish")).toBeVisible();
    await player.getByRole("link", { name: /Week 1/ }).click();
    await expect(player.getByRole("table", { name: "Week results" })).toBeVisible();
    const weekUrl = player.url();

    // Reopened: it is an open week again, off the list of closed weeks, and the scored games stay closed to picks.
    await page.getByRole("button", { name: "Reopen week" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Reopen week" }).click();
    await expect(page.getByText("Week reopened.")).toBeVisible();
    await player.reload();
    // Every game is scored, so nothing is left to pick and nothing is folded: the row says how Pat's pick did.
    // The row is a scoreboard: each side's score beside its team, and "Final".
    await expect(player.getByRole("button", { name: /^KC at ATL, final 30–10,/ })).toContainText("Final");
    const scored = player.getByRole("button", {
      name: "KC at ATL, final 30–10, your pick: Falcons (+3.5), lost",
      exact: true,
    });
    await expect(scored).toContainText("Lost");
    await scored.click();
    await expect(player.getByRole("button", { name: "Falcons +3.5, home" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(player.getByRole("button", { name: "Chiefs -3.5" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(player.getByRole("button", { name: "Chiefs -3.5" })).toBeDisabled();
    await expect(player.getByRole("table", { name: "Week results" })).toHaveCount(0);
    await player.getByRole("link", { name: "Results", exact: true }).click();
    await expect(player.getByText("No week has closed yet.")).toBeVisible();

    // The corrected score has the Falcons covering. Closing again turns the result over.
    await enterScore(page, game, "10", "30");
    await finalizeWeek(page);
    await expect(page.getByRole("table", { name: "Week results" }).getByRole("row").first()).toContainText(
      "Pat",
    );

    // Pat saw the first recap; the corrected week is recapped once more, with the new finish.
    await player.getByRole("link", { name: "Picks", exact: true }).click();
    const corrected = player.getByRole("dialog", { name: "Week 1 is final" });
    await expect(corrected).toContainText("You won the week. Take a bow.");
    await corrected.getByRole("button", { name: "Close" }).click();
    await expect(corrected).toHaveCount(0);
    await player.reload();
    await expect(player.getByRole("heading", { name: "No week is open" })).toBeVisible();
    await expect(player.getByRole("dialog")).toHaveCount(0);
    await player.goto(weekUrl);
    const results = player.getByRole("table", { name: "Week results" });
    await expect(results.getByRole("row").first()).toContainText("Pat");
    await expect(results.getByRole("row", { name: /Commish/ })).toContainText("LPL");
    await player.getByRole("link", { name: "Standings", exact: true }).click();
    await expect(
      player.getByRole("table", { name: "Season standings" }).getByRole("row").nth(1),
    ).toContainText("Pat");
  } finally {
    await context.close();
  }
});

test("a commissioner's kickoff change locks and unlocks a game on the pick sheet, and the save bar follows", async ({
  page,
  signedIn: _,
}) => {
  const chiefs = { away: "KC", home: "ATL", days: 3, spread: "3.5" };
  const cowboys = { away: "DAL", home: "PHI", days: 3, spread: "-2.5" };
  await openWeek(page, "Moving kickoffs", [chiefs, cowboys]);
  // Each step opens the screen by its address (a fresh page load), so the step reads only what was saved.
  const manageUrl = page.url();
  const picksUrl = manageUrl.replace(/\/manage$/, "");
  await page.goto(picksUrl);

  await test.step("Save picks waits for a change, and goes back to waiting once saved", async () => {
    const save = page.getByRole("button", { name: "Save picks" });
    await expect(page.getByText("0 of 2 picked")).toBeVisible();
    await expect(save).toBeDisabled();
    await page.getByRole("button", { name: "Chiefs -3.5" }).click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByText("Picks saved.", { exact: true })).toBeVisible();
    await dismissHomeScreenOffer(page);
    await expect(save).toBeDisabled();
  });

  await test.step("both kickoffs moved to yesterday: every game locks and the save bar goes", async () => {
    await page.goto(manageUrl);
    await page.getByLabel("Kickoff for KC at ATL").fill(kickoffInDays(-1));
    await page.getByLabel("Kickoff for DAL at PHI").fill(kickoffInDays(-1));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await page.goto(picksUrl);
    // Nothing is left to pick, so nothing folds: the sheet is the week's scoreboard, one row a game.
    await expect(page.getByRole("button", { name: /^\d+ games? locked$/ })).toHaveCount(0);
    await expect(page.getByText("Locked", { exact: true })).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "DAL at PHI, locked, no pick", exact: true }),
    ).toBeVisible();
    const chiefsRow = page.getByRole("button", {
      name: "KC at ATL, locked, your pick: Chiefs (-3.5)",
      exact: true,
    });
    await chiefsRow.click();
    await expect(chiefsRow).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Chiefs -3.5" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Chiefs -3.5" })).toHaveAttribute("aria-pressed", "true");
    // Nothing can change, so there is nothing to save.
    await expect(page.getByRole("button", { name: "Save picks" })).toHaveCount(0);
    await expect(page.getByRole("progressbar", { name: "Games picked" })).toHaveCount(0);
  });

  await test.step("one kickoff moved back to the weekend: that game opens again", async () => {
    await page.goto(manageUrl);
    await page.getByLabel("Kickoff for KC at ATL").fill(kickoffInDays(2));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await page.goto(picksUrl);
    await page.getByRole("button", { name: "1 game locked", exact: true }).click();
    await expect(page.getByText("Locked", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Falcons +3.5, home" })).toBeEnabled();
    await page.getByRole("button", { name: "DAL at PHI, locked, no pick", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cowboys +2.5" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save picks" })).toBeDisabled();
    await page.getByRole("button", { name: "Falcons +3.5, home" }).click();
    await page.getByRole("button", { name: "Save picks" }).click();
    await expect(page.getByText("Picks saved.", { exact: true })).toBeVisible();
  });
});
