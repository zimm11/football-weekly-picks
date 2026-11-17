import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { type HarnessGame, leagueIdOf, resetHarness, runJobs, setClock, setFeedWeek } from "./harness";

/*
 * Squares, create to winner, on the dev harness: the 2026 season's Super Bowl (scripted for 2027-02-14) and a
 * clock moved forward of real time. Nobody presses Lock and draw in the first journey: the board locks itself at
 * kickoff when it is read, then each quarter's score arrives from the feed through the cron's run (`runJobs`).
 */
const KICKOFF = "2027-02-14T23:30:00Z";
const minutesAfterKickoff = (n: number) => new Date(Date.parse(KICKOFF) + n * 60_000);
const superBowl = (game: Partial<HarnessGame> = {}): HarnessGame => ({
  externalId: "e2e-sb",
  homeTeam: "SEA",
  awayTeam: "BUF",
  kickoff: KICKOFF,
  spread: -1.5,
  status: "scheduled",
  period: 0,
  ...game,
});

test.beforeEach(async ({ request }) => {
  await resetHarness(request);
});
test.afterEach(async ({ request }) => {
  await resetHarness(request);
});

/**
 * From Your leagues: a squares league with a board on the Super Bowl (the default game), then its Board tab.
 * Returns the league's id.
 */
async function startBoard(page: Page) {
  await page.getByRole("radio", { name: "Squares" }).click();
  await page.getByLabel("League name").fill("Super Bowl Squares");
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "New board" })).toBeVisible();
  const leagueId = leagueIdOf(page.url());
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(page.getByText("Board created.")).toBeVisible();
  await page.getByRole("link", { name: "Board", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bills at Seahawks" })).toBeVisible();
  return leagueId;
}

test("a board locks itself at kickoff and pays four quarters, an empty square's included", async ({
  page,
  request,
  signedIn: _,
}) => {
  await setClock(request, "2027-02-10T17:00:00Z");
  await setFeedWeek(request, 2026, 22, [superBowl()]);
  await page.reload();
  const leagueId = await startBoard(page);

  // Numbers read "?" until the draw. Claim one square.
  await expect(page.getByLabel("Seahawks ?", { exact: true })).toHaveCount(10);
  // The square shows as yours at once (optimistically), so wait for the API's answer before moving the clock:
  // a claim still in flight when the clock passes kickoff would be refused.
  const saved = page.waitForResponse(
    (res) => res.request().method() === "PUT" && /\/squares\/0\/0$/.test(new URL(res.url()).pathname),
  );
  await page.getByRole("button", { name: "Open square, row 1, column 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Your square, row 1, column 1", exact: true })).toBeVisible();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByRole("region", { name: "Your squares" })).toContainText("1 of 10");

  // Kickoff, and nobody locked the board: reading it locks it and draws the numbers.
  await setClock(request, minutesAfterKickoff(1));
  await page.reload();
  const mine = page.getByRole("button", { name: /^Your square, Seahawks \d, Bills \d$/ });
  await expect(mine).toBeVisible();
  await expect(page.getByText("Underway", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim a random square" })).toHaveCount(0);
  const [, home, away] =
    /Seahawks (\d), Bills (\d)/.exec((await mine.getAttribute("aria-label")) ?? "") ?? [];
  const h = Number(home);
  const a = Number(away);

  // Each quarter settles in the feed and arrives on the next cron run. Q1 and Q3 hit our square (the same last
  // digits); halftime and the final, with overtime, hit open squares, so nobody wins those.
  const q1 = { home: h, away: a };
  const half = { home: h + 3, away: a + 7 };
  const q3 = { home: h + 10, away: a + 10 };
  const final = { home: h + 16, away: a + 10 };
  const steps: [number, Partial<HarnessGame>][] = [
    [20, { status: "in_progress", period: 2, periodScores: { q1 } }],
    [80, { status: "in_progress", period: 3, periodScores: { q1, half } }],
    [130, { status: "in_progress", period: 4, periodScores: { q1, half, q3 } }],
    [
      250,
      {
        status: "final",
        period: 5,
        homeScore: final.home,
        awayScore: final.away,
        periodScores: { q1, half, q3, final },
      },
    ],
  ];
  const results = page.getByRole("region", { name: "Quarter results" });
  for (const [minutes, game] of steps) {
    await setFeedWeek(request, 2026, 22, [superBowl(game)]);
    await setClock(request, minutesAfterKickoff(minutes));
    await runJobs(request, [leagueId]);
    if (minutes === 20) {
      await page.reload();
      await expect(results).toContainText(`Q1BUF ${a} · SEA ${h}You won`);
    }
  }
  await page.reload();
  await expect(page.getByText("Final", { exact: true }).first()).toBeVisible();
  await expect(results).toContainText(`Q1BUF ${a} · SEA ${h}You won`);
  await expect(results).toContainText(
    `HalftimeBUF ${half.away} · SEA ${half.home}No winner: an empty square`,
  );
  await expect(results).toContainText(`Q3BUF ${q3.away} · SEA ${q3.home}You won`);
  await expect(results).toContainText(`FinalBUF ${final.away} · SEA ${final.home}No winner: an empty square`);
  await expect(page.getByRole("button", { name: /^Your square, / })).toHaveAccessibleName(
    `Your square, Seahawks ${h}, Bills ${a}, won Q1 and Q3`,
  );
});

test("an admin's Lock and draw locks the board before kickoff", async ({ page, request, signedIn: _ }) => {
  await setClock(request, "2027-02-10T17:00:00Z");
  await setFeedWeek(request, 2026, 22, [superBowl()]);
  await page.reload();
  await startBoard(page);
  await page.getByRole("button", { name: "Claim a random square" }).click();
  await expect(page.getByRole("region", { name: "Your squares" })).toContainText("1 of 10");

  await page.getByRole("link", { name: "Manage board" }).click();
  await page.getByLabel("Guest's name").fill("Uncle Ray");
  await page
    .getByRole("button", { name: /^Open square/ })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /^Uncle Ray's square \(guest\)/ })).toBeVisible();
  await page.getByRole("button", { name: "Lock and draw" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("98 squares are still open");
  await dialog.getByRole("button", { name: "Lock and draw" }).click();
  await expect(page.getByText("The numbers are drawn.")).toBeVisible();
  await expect(page.getByLabel(/^Seahawks \d$/)).toHaveCount(10);
  await expect(page.getByText("Locked", { exact: true })).toBeVisible();

  // The admin deletes the board: it is gone from the league, squares and numbers with it.
  await page.getByRole("button", { name: "Delete board" }).click();
  const remove = page.getByRole("alertdialog");
  await expect(remove).toContainText("BUF at SEA");
  await remove.getByRole("button", { name: "Delete board" }).click();
  await expect(page.getByText("Board deleted.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No boards yet" })).toBeVisible();
});
