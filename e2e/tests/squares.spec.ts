import type { Page } from "@playwright/test";
import { dismissHomeScreenOffer, expect, joinLeague, kickoffInDays, openNewLeague, test } from "./fixtures";
import { emailCount, waitForEmail } from "./inbox";

/*
 * Squares on real time, with no feed and no moved clock: a board on a game typed in by hand, which the
 * commissioner locks, draws and scores. It runs on the desktop and phone projects (the 10 by 10 grid fits a
 * phone's width). The boards that lock themselves at kickoff and take their scores from the feed are
 * squares.sim.spec.ts.
 */

/** What the home-screen sheet says after a first square ("… so the board is one tap away."). */
const HOME_SCREEN_OFFER = /^Square claimed\. .* so the board is one tap away\.$/;

/** Taps a square and waits for the API to answer: the cell changes at once, before the claim is really saved. */
async function tapSquare(page: Page, name: string, method: "PUT" | "DELETE") {
  const answered = page.waitForResponse(
    (res) => res.request().method() === method && /\/squares\/\d\/\d$/.test(new URL(res.url()).pathname),
  );
  await page.getByRole("button", { name, exact: true }).click();
  expect((await answered).ok()).toBe(true);
}

test("players claim squares up to the limit on a typed-in board, and a typed score names the winner", async ({
  page,
  browser,
  signedIn,
}) => {
  // Two players, a draw and a score, each with reloads.
  test.slow();
  await openNewLeague(page);
  await page.getByRole("radio", { name: "Squares" }).click();
  await page.getByLabel("League name").fill("Office squares");
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "Office squares" })).toBeVisible();
  const leagueUrl = page.url().replace(/\/league$/, "");
  const inviteUrl = await page.getByLabel("Invite link", { exact: true }).inputValue();
  // A squares league has a Board, and no Picks, Results or Standings.
  const tabs = page.getByRole("navigation", { name: "League" }).getByRole("link");
  await expect(tabs).toHaveText(["Boards", "Messages", "League"]);

  // The feed lists no Super Bowl here, so the commissioner types the game in, two squares a player.
  await page.getByRole("link", { name: "Boards", exact: true }).click();
  await page.getByRole("link", { name: "New board", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New board" })).toBeVisible();
  await page.getByRole("radio", { name: "Type it in" }).click();
  await page.getByLabel("Away team (down the side)").selectOption("BUF");
  await page.getByLabel("Home team (across the top)").selectOption("SEA");
  await page.getByLabel(/^Kickoff \(.* time\)$/).fill(kickoffInDays(3));
  await page.getByLabel("Squares per player").fill("2");
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(page.getByText("Board created.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bills at Seahawks" })).toBeVisible();
  await tapSquare(page, "Open square, row 2, column 2", "PUT");
  await expect(page.getByRole("button", { name: "Your square, row 2, column 2", exact: true })).toBeVisible();
  // A first square suggests the home screen on a phone, as a first save of picks does.
  await dismissHomeScreenOffer(page, HOME_SCREEN_OFFER);

  const { context, page: player, account } = await joinLeague(browser, inviteUrl, "Pat");
  try {
    await player.getByRole("link", { name: /^Open BUF at SEA/ }).click();
    // A player lands on the board: open, the numbers not drawn, and nothing to manage it with.
    await expect(player.getByRole("heading", { name: "Bills at Seahawks" })).toBeVisible();
    await expect(player.getByText("Open", { exact: true })).toBeVisible();
    await expect(player.getByLabel("Seahawks ?", { exact: true })).toHaveCount(10);
    await expect(player.getByLabel("Bills ?", { exact: true })).toHaveCount(10);
    await expect(player.getByRole("link", { name: "Manage board" })).toHaveCount(0);
    const mine = player.getByRole("region", { name: "Your squares" });
    await expect(mine).toContainText("0 of 2");
    await expect(mine).toContainText("1 of 100 squares claimed");

    // A square in each corner of the top row: the whole grid is in reach on a phone too.
    await tapSquare(player, "Open square, row 1, column 1", "PUT");
    await expect(mine).toContainText("1 of 2");
    await dismissHomeScreenOffer(player, HOME_SCREEN_OFFER);
    await tapSquare(player, "Open square, row 1, column 10", "PUT");
    await expect(mine).toContainText("2 of 2");
    await expect(mine).toContainText("3 of 100 squares claimed");
    // At the limit: another square is refused, and so is a random one.
    await player.getByRole("button", { name: "Open square, row 5, column 5", exact: true }).click();
    await expect(player.getByText("You can hold 2 squares on this board.")).toBeVisible();
    await expect(player.getByRole("button", { name: "Claim a random square" })).toBeDisabled();
    await expect(mine).toContainText("2 of 2");
    // A square that is someone else's shows whose it is and can't be taken.
    await player.getByRole("button", { name: "Commish's square, row 2, column 2", exact: true }).click();
    const sheet = player.getByRole("dialog", { name: "Commish's square" });
    await expect(sheet).toContainText("Drawn when the board locks");
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
    // Tapping your own square gives it back, until the board locks.
    await tapSquare(player, "Your square, row 1, column 10", "DELETE");
    await expect(
      player.getByRole("button", { name: "Open square, row 1, column 10", exact: true }),
    ).toBeVisible();
    await expect(mine).toContainText("1 of 2");
    // A squares league has no standings: the path is the not-found screen, and so is the admin's for a player.
    await player.goto(`${leagueUrl}/standings`);
    await expect(player.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await player.goto(leagueUrl);
    await player.getByRole("link", { name: /^Open BUF at SEA/ }).click();
    await expect(player.getByRole("heading", { name: "Bills at Seahawks" })).toBeVisible();

    // The commissioner locks the board and the numbers are drawn, once.
    await page.getByRole("link", { name: "Manage board" }).click();
    await expect(page.getByRole("heading", { name: "Manage board" })).toBeVisible();
    await page.getByRole("button", { name: "Lock and draw" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("98 squares are still open");
    await dialog.getByRole("button", { name: "Lock and draw" }).click();
    await expect(page.getByText("The numbers are drawn.")).toBeVisible();
    await expect(page.getByText("Locked", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lock and draw" })).toHaveCount(0);

    // The other player is told by email, in words that name no square and no team; the one who drew isn't.
    const email = await waitForEmail(account.email, /^Office squares: The numbers are drawn$/);
    expect(email.text).not.toMatch(/Bills|Seahawks|BUF|SEA\b/);
    expect(email.links.some((href) => /\/boards\/[^/]+$/.test(new URL(href).pathname))).toBe(true);
    expect(await emailCount(signedIn.email)).toBe(0);

    // The player's square has its numbers now, and the board takes no more claims.
    await player.reload();
    await expect(player.getByText("Locked", { exact: true })).toBeVisible();
    await expect(player.getByLabel(/^Seahawks \d$/)).toHaveCount(10);
    await expect(player.getByLabel(/^Bills \d$/)).toHaveCount(10);
    await expect(player.getByRole("button", { name: "Claim a random square" })).toHaveCount(0);
    const square = player.getByRole("button", { name: /^Your square, / });
    await expect(square).toHaveAccessibleName(/^Your square, Seahawks \d, Bills \d$/);
    const [, home, away] =
      /Seahawks (\d), Bills (\d)/.exec((await square.getAttribute("aria-label")) ?? "") ?? [];
    // Locked: a tap opens the square's sheet instead of giving it back.
    await square.click();
    const own = player.getByRole("dialog", { name: "Pat's square" });
    await expect(own).toContainText(`Seahawks ${home}, Bills ${away}`);
    await expect(own).toContainText("Nothing yet");
    await own.getByRole("button", { name: "Close" }).click();
    await expect(mine).toContainText("1 of 2");

    // A typed-in game has no feed: the commissioner types the first quarter's score, which ends on Pat's digits.
    await page.getByLabel("BUF Q1 score").fill(`1${away}`);
    await page.getByLabel("SEA Q1 score").fill(`2${home}`);
    await page.getByRole("button", { name: "Save the Q1 score" }).click();
    await expect(page.getByText("Score saved.")).toBeVisible();
    await expect(page.getByText("Typed by a commissioner")).toBeVisible();

    await player.reload();
    const results = player.getByRole("region", { name: "Quarter results" });
    await expect(results).toContainText(`Q1BUF 1${away} · SEA 2${home}You won`);
    await expect(results).toContainText("HalftimeTo come");
    await expect(square).toHaveAccessibleName(`Your square, Seahawks ${home}, Bills ${away}, won Q1`);
    await page.getByRole("link", { name: "View board" }).click();
    await expect(page.getByRole("region", { name: "Quarter results" })).toContainText(
      `Q1BUF 1${away} · SEA 2${home}Pat won`,
    );
  } finally {
    await context.close();
  }
});

test("players choose among boards and commissioners create them on a separate screen", async ({
  page,
  signedIn: _,
}) => {
  await openNewLeague(page);
  await page.getByRole("radio", { name: "Squares" }).click();
  await page.getByLabel("League name").fill("Multiple boards");
  await page.getByRole("button", { name: "Create league" }).click();
  await page.getByRole("link", { name: "Boards", exact: true }).click();
  for (const home of ["SEA", "KC"]) {
    await expect(page.getByRole("button", { name: "Create board", exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "New board", exact: true }).click();
    await page.getByRole("radio", { name: "Type it in" }).click();
    await page.getByLabel("Away team (down the side)").selectOption("BUF");
    await page.getByLabel("Home team (across the top)").selectOption(home);
    await page.getByLabel(/^Kickoff \(.* time\)$/).fill(kickoffInDays(3));
    await page.getByRole("button", { name: "Create board" }).click();
    // The new board's own screen (its id, not "/boards/new", where All boards is offered too).
    await expect(page).toHaveURL(/\/boards\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: "All boards", exact: true }).click();
  }
  await expect(page.getByLabel("Board", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Open BUF at/ })).toHaveCount(2);
  await page.getByRole("link", { name: /^Open BUF at KC/ }).click();
  await expect(page.getByRole("heading", { name: "Bills at Chiefs" })).toBeVisible();
  await page.getByRole("link", { name: "All boards", exact: true }).click();
  await page.getByRole("link", { name: /^Open BUF at SEA/ }).click();
  await expect(page.getByRole("heading", { name: "Bills at Seahawks" })).toBeVisible();
});
