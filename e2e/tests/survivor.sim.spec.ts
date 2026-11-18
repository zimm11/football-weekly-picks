import type { APIRequestContext, Page } from "@playwright/test";
import { expect, joinLeague, openNewLeague, signUp, test } from "./fixtures";
import { type HarnessGame, leagueIdOf, resetHarness, runJobs, setClock, setFeedWeek } from "./harness";

/*
 * Survivor, create to winner, on the dev harness's scripted feed and clock. The pool plays the 2027 season's last
 * two weeks and the Wild Card round with nobody pressing anything after creating it: each week is imported and
 * opened by the feed, finalized when its games end, and the next one follows. Time moves with `setClock`, and the
 * Cron Trigger's work runs with `runJobs` (reads advance the pool by themselves too).
 */

test.beforeEach(async ({ request }) => {
  await resetHarness(request);
});
test.afterEach(async ({ request }) => {
  await resetHarness(request);
});

/** Sunday of a week, by the app's calendar estimate for the 2027 season (Week 1's Thursday: September 9). */
function sunday(week: number, hourUtc = 18) {
  return new Date(Date.UTC(2027, 8, 12 + 7 * (week - 1), hourUtc));
}
const game = (id: string, home: string, away: string, week: number, hour = 18): HarnessGame => ({
  externalId: id,
  homeTeam: home,
  awayTeam: away,
  kickoff: sunday(week, hour).toISOString(),
});
const final = (g: HarnessGame, home: number, away: number): HarnessGame => ({
  ...g,
  homeScore: home,
  awayScore: away,
  status: "final",
});

/** Starts a survivor league from Your leagues, choosing the start week; returns its id and invite link. */
async function createPool(page: Page, name: string, startWeek: string) {
  await openNewLeague(page);
  await page.getByRole("radio", { name: /Survivor/ }).click();
  await page.getByLabel("League name").fill(name);
  await page.getByLabel("Start week").selectOption({ label: startWeek });
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const inviteUrl = await page.getByLabel("Invite link", { exact: true }).inputValue();
  const leagueId = leagueIdOf(page.url());
  return { leagueId, inviteUrl };
}

async function pickTeam(page: Page, team: RegExp) {
  await page.getByRole("button", { name: team }).click();
  await page.getByRole("button", { name: "Save pick" }).click();
  await expect(page.getByText("Pick saved.")).toBeVisible();
}

/** Moves the clock, runs the cron's work once, and reloads the page so it reads the new time. */
async function advanceTo(request: APIRequestContext, leagueId: string, at: Date, pages: Page[]) {
  await setClock(request, at);
  await runJobs(request, [leagueId]);
  for (const page of pages) await page.reload();
}

test("a survivor pool runs itself from its start week through the Wild Card round to a winner", async ({
  page,
  browser,
  request,
}) => {
  // Three weeks across two players, each a feed change, a cron run and reloads.
  test.slow();
  // Late August 2027, before the season: forward of real time, as the harness needs.
  await setClock(request, "2027-08-20T12:00:00-04:00");
  const week17 = [game("e17-kc", "KC", "LV", 17), game("e17-buf", "BUF", "NYJ", 17, 21)];
  await setFeedWeek(request, 2027, 17, week17);
  await page.goto("/");
  await signUp(page, "Commish");
  const { leagueId, inviteUrl } = await createPool(page, "Last Stand", "Week 17");
  const { context, page: pat } = await joinLeague(browser, inviteUrl, "Pat");
  try {
    // The first read filled the start week from the feed and opened it.
    await page.goto(`/leagues/${leagueId}`);
    await expect(page.getByRole("heading", { name: "Week 17" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your status" })).toContainText("You're still in");
    await pickTeam(page, /^Chiefs, home/);
    await pat.reload();
    await pickTeam(pat, /^Bills, home/);

    // Before kickoff, Pat's pick is nobody else's business: the grid shows nothing for it.
    await page.goto(`/leagues/${leagueId}/standings`);
    await expect(page.getByText("2 of 2 alive")).toBeVisible();
    await expect(page.getByRole("row", { name: /Pat/ }).getByLabel("Week 17: nothing to show")).toBeVisible();

    // The games end; the cron finalizes Week 17 and opens Week 18 from the feed.
    await setFeedWeek(request, 2027, 17, [
      final(week17[0] as HarnessGame, 24, 10),
      final(week17[1] as HarnessGame, 27, 3),
    ]);
    const week18 = [
      game("e18-kc", "KC", "DEN", 18),
      game("e18-phi", "PHI", "DAL", 18),
      game("e18-gb", "GB", "CHI", 18, 21),
    ];
    await setFeedWeek(request, 2027, 18, week18);
    await advanceTo(request, leagueId, sunday(17, 40), [page]);
    // The recap, once: still in, nobody went out, two left.
    const recap = page.getByRole("dialog", { name: "Week 17 is final" });
    await expect(recap).toContainText("You're still in.");
    await expect(recap).toContainText("Nobody else went out.");
    await recap.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("row", { name: /Pat/ }).getByLabel("Week 17: Bills, won")).toBeVisible();

    // Week 18: the Chiefs were used in Week 17.
    await page.goto(`/leagues/${leagueId}`);
    await expect(page.getByRole("heading", { name: "Week 18" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Chiefs, home, used in week 17/ })).toBeDisabled();
    await pickTeam(page, /^Eagles, home/);
    await pat.goto(`/leagues/${leagueId}`);
    await pat
      .getByRole("dialog", { name: "Week 17 is final" })
      .getByRole("button", { name: "Close" })
      .click();
    await pickTeam(pat, /^Packers, home/);

    // Both win; more than one is left after Week 18, so the pool goes on into the playoffs.
    await setFeedWeek(request, 2027, 18, [
      final(week18[0] as HarnessGame, 20, 17),
      final(week18[1] as HarnessGame, 30, 20),
      final(week18[2] as HarnessGame, 21, 14),
    ]);
    const wildCard = [
      game("ewc-kc", "KC", "PIT", 19),
      game("ewc-buf", "BUF", "HOU", 19, 19),
      game("ewc-bal", "BAL", "CLE", 19, 20),
      game("ewc-sf", "SF", "SEA", 19, 21),
      game("ewc-gb", "GB", "DET", 19, 22),
      game("ewc-lar", "LAR", "TB", 19, 23),
    ];
    await setFeedWeek(request, 2027, 19, wildCard);
    await advanceTo(request, leagueId, sunday(18, 40), [page]);
    await page
      .getByRole("dialog", { name: "Week 18 is final" })
      .getByRole("button", { name: "Close" })
      .click();
    await expect(page.getByRole("heading", { name: "Wild Card" })).toBeVisible();
    // The used teams reset at the Wild Card round: the Chiefs are back.
    await pickTeam(page, /^Chiefs, home$/);
    await pat.goto(`/leagues/${leagueId}`);
    await pat
      .getByRole("dialog", { name: "Week 18 is final" })
      .getByRole("button", { name: "Close" })
      .click();
    await pickTeam(pat, /^Texans/);

    // The Chiefs win, the Texans lose: one player left, and the pool is over.
    await setFeedWeek(
      request,
      2027,
      19,
      wildCard.map((g) => final(g, 24, 17)),
    );
    await advanceTo(request, leagueId, sunday(19, 40), [page, pat]);
    const adminRecap = page.getByRole("dialog", { name: "Wild Card is final" });
    await expect(adminRecap).toContainText("You're the last one standing. You won the pool.");
    await adminRecap.getByRole("button", { name: "Close" }).click();
    await expect(pat.getByRole("dialog", { name: "Wild Card is final" })).toContainText(
      "You went out: Texans lost.",
    );
    await pat
      .getByRole("dialog", { name: "Wild Card is final" })
      .getByRole("button", { name: "Close" })
      .click();
    await expect(pat.getByRole("region", { name: "Your status" })).toContainText(
      "Out in Wild Card: Texans lost",
    );
    await pat.goto(`/leagues/${leagueId}/standings`);
    await expect(pat.getByText("1 of 2 alive")).toBeVisible();
    await expect(pat.getByRole("region", { name: "Winner" })).toContainText("Commish won the pool");
    await expect(pat.getByRole("row", { name: /Pat/ }).getByLabel("Wild Card: Texans, lost")).toBeVisible();

    // Nothing more is imported once the pool is over.
    await setFeedWeek(request, 2027, 20, [game("ediv", "KC", "BAL", 20)]);
    await advanceTo(request, leagueId, sunday(19, 48), [page]);
    await expect(page.getByRole("region", { name: "Your status" })).toContainText("You won the pool");
    await expect(page.getByRole("heading", { name: "No week is being played" })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("a survivor admin removes a cancelled game and enters a pick for a player", async ({
  page,
  browser,
  request,
}) => {
  await setClock(request, "2027-08-20T12:00:00-04:00");
  await setFeedWeek(request, 2027, 1, [game("o1-kc", "KC", "LV", 1), game("o1-min", "MIN", "CHI", 1)]);
  await page.goto("/");
  await signUp(page, "Commish");
  const { leagueId, inviteUrl } = await createPool(page, "Overrides", "Week 1");
  const { context, page: pat } = await joinLeague(browser, inviteUrl, "Pat");
  try {
    await pat.goto(`/leagues/${leagueId}`);
    await expect(pat.getByRole("heading", { name: "Week 1" })).toBeVisible();
    await pickTeam(pat, /^Vikings, home/);

    // The Vikings game is cancelled: the admin removes it, and Pat's pick on it goes with it.
    await page.goto(`/leagues/${leagueId}/league`);
    await page.getByRole("button", { name: "Games and scores" }).click();
    await page.getByRole("button", { name: "Options for Bears at Vikings" }).click();
    await page.getByRole("menuitem", { name: "Remove Bears at Vikings" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove game" }).click();
    await expect(page.getByText("Bears at Vikings was removed.")).toBeVisible();
    await pat.reload();
    await expect(pat.getByText("No pick yet")).toBeVisible();

    // The admin enters Pat's pick; Pat is told an admin entered it.
    await page.getByRole("button", { name: "Enter a pick for a player" }).click();
    await page.getByLabel("Player", { exact: true }).selectOption({ label: "Pat" });
    await page.getByLabel("Team", { exact: true }).selectOption({ label: "Chiefs (Raiders at Chiefs)" });
    await page.getByRole("button", { name: "Save pick for Pat" }).click();
    await expect(page.getByText("Pick saved for Pat.")).toBeVisible();
    await pat.reload();
    await expect(pat.getByText("Your pick: Chiefs")).toBeVisible();
    await expect(pat.getByText("A commissioner entered this pick for you.")).toBeVisible();
  } finally {
    await context.close();
  }
});
