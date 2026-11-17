import { expect, test } from "@playwright/test";
import { signUp } from "./fixtures";
import { type HarnessGame, resetHarness, runJobs, setClock, setFeedWeek } from "./harness";

// Automatic weekly pick'em, start to recap, with nobody pressing Open or Finalize: the dev harness scripts Week 3
// of 2027 (Thursday Sep 23 and Monday Sep 27, Eastern) and moves the Worker's clock; the cron's work runs at each
// step (runJobs).
test.beforeEach(async ({ request }) => {
  await resetHarness(request);
});
test.afterEach(async ({ request }) => {
  await resetHarness(request);
});

const week3 = (final = false): HarnessGame[] => [
  {
    externalId: "e2e-auto-thu",
    homeTeam: "DAL",
    awayTeam: "NYG",
    kickoff: "2027-09-24T00:15:00Z",
    spread: -3,
    ...(final && { homeScore: 27, awayScore: 20, status: "final" as const }),
  },
  {
    externalId: "e2e-auto-mon",
    homeTeam: "KC",
    awayTeam: "BUF",
    kickoff: "2027-09-28T00:15:00Z",
    spread: 2.5,
    ...(final && { homeScore: 20, awayScore: 27, status: "final" as const }),
  },
];

test("an Automatic weekly league opens, scores and finalizes its week by itself", async ({
  page,
  request,
}) => {
  test.slow();
  // Saturday, Sep 18 2027: the Tuesday after, Week 3 opens.
  await setClock(request, "2027-09-18T12:00:00Z");
  await setFeedWeek(request, 2027, 3, week3());
  await page.goto("/");
  await signUp(page, "Commish");

  // Automatic is preselected for a weekly league.
  await page.getByLabel("League name").fill("Runs Itself");
  await expect(page.getByRole("radio", { name: "Automatic" })).toBeChecked();
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("heading", { name: "Start the 2027 season" })).toBeVisible();
  await page.getByRole("combobox", { name: "Start week", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Start season" }).click();
  await expect(page.getByText("Week 3 opens by itself on Tuesday at 9 AM Eastern")).toBeVisible();
  const leagueUrl = page.url().replace(/\/league$/, "");

  // Tuesday 9 AM Eastern: the week opens by itself.
  await setClock(request, "2027-09-21T13:01:00Z");
  await runJobs(request);
  await page.goto(leagueUrl);
  await expect(page.getByRole("heading", { name: /^Week 3/ })).toBeVisible();
  await page.getByRole("button", { name: "Cowboys -3, home" }).click();
  await page.getByRole("button", { name: "Bills -2.5" }).click();
  await page.getByRole("button", { name: "POW: BUF at KC" }).click();
  await page.getByLabel(/^Tiebreaker: total points scored in/).fill("45");
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Picks saved.")).toBeVisible();

  // The results arrive from the feed after Monday night's game, and the week finalizes by itself.
  await setFeedWeek(request, 2027, 3, week3(true));
  await setClock(request, "2027-09-28T06:00:00Z");
  await runJobs(request);
  await page.goto(leagueUrl);
  const recap = page.getByRole("dialog", { name: "Week 3 is final" });
  await expect(recap).toBeVisible();
  // Thursday night: the Cowboys covered (3). Monday night: the Bills covered as the POW (3 + 5).
  await expect(recap.getByText("11", { exact: true })).toBeVisible();
  await recap.getByRole("button", { name: "Close" }).click();
  await page.goto(`${leagueUrl}/results`);
  await expect(page.getByRole("link", { name: "Week 3 results" })).toBeVisible();
});
