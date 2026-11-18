import { expect, signUp, test } from "./fixtures";
import { type HarnessGame, leagueIdOf, resetHarness, runJobs, setClock, setFeedWeek } from "./harness";

// Playoff pick'em, create to champion, with nobody pressing Open or Finalize: the dev harness scripts the 2027
// postseason (January and February 2028) and moves the Worker's clock; the cron's work runs at each step.
// A Guillotine league: the player's Wild Card POW wins, they skip the Divisional round and are out of picking,
// they still guess the Super Bowl's total, and points decide the title.
test.beforeEach(async ({ request }) => {
  await resetHarness(request);
});
test.afterEach(async ({ request }) => {
  await resetHarness(request);
});

/** A round's games, every line home -3; with `final`, every home team wins by 7 (covers). */
const round = (games: [string, string, string, string][], final = false): HarnessGame[] =>
  games.map(([externalId, homeTeam, awayTeam, kickoff]) => ({
    externalId,
    homeTeam,
    awayTeam,
    kickoff,
    spread: -3,
    ...(final && { homeScore: 24, awayScore: 17, status: "final" as const }),
  }));
const WILD_CARD: [string, string, string, string][] = [
  ["e2e-wc1", "BUF", "MIA", "2028-01-15T21:30:00Z"],
  ["e2e-wc2", "PIT", "CLE", "2028-01-16T01:15:00Z"],
  ["e2e-wc3", "PHI", "WAS", "2028-01-16T18:00:00Z"],
  ["e2e-wc4", "DET", "CHI", "2028-01-16T21:30:00Z"],
  ["e2e-wc5", "SF", "SEA", "2028-01-17T01:15:00Z"],
  ["e2e-wc6", "KC", "DEN", "2028-01-18T01:15:00Z"],
];
const DIVISIONAL: [string, string, string, string][] = [
  ["e2e-dv1", "BUF", "PIT", "2028-01-22T21:30:00Z"],
  ["e2e-dv2", "PHI", "DET", "2028-01-23T01:15:00Z"],
  ["e2e-dv3", "KC", "SF", "2028-01-23T20:00:00Z"],
  ["e2e-dv4", "LAR", "GB", "2028-01-23T23:30:00Z"],
];
const CONFERENCE: [string, string, string, string][] = [
  ["e2e-cf1", "BUF", "KC", "2028-01-30T20:00:00Z"],
  ["e2e-cf2", "PHI", "LAR", "2028-01-30T23:30:00Z"],
];
const SUPER_BOWL: [string, string, string, string][] = [["e2e-sb", "PHI", "BUF", "2028-02-13T23:30:00Z"]];

test("a Guillotine playoff league runs from Wild Card to champion by itself", async ({ page, request }) => {
  test.slow();
  await setClock(request, "2028-01-10T15:00:00Z");
  await page.goto("/");
  await signUp(page, "Commish");
  await page.getByRole("radio", { name: "Playoff pick'em" }).click();
  await page.getByLabel("League name").fill("Bracket Busters");
  await page.getByRole("combobox", { name: "Format", exact: true }).selectOption("guillotine");
  await page.getByRole("button", { name: "Create league" }).click();
  await expect(page.getByRole("combobox", { name: "Season", exact: true })).toHaveValue("2027");
  const leagueUrl = page.url().replace(/\/league$/, "");
  const leagues = [leagueIdOf(leagueUrl)];

  // The feed lists the Wild Card round with real teams and lines: it is created and opens by itself.
  await setFeedWeek(request, 2027, 19, round(WILD_CARD));
  await runJobs(request, leagues);
  await page.goto(leagueUrl);
  await expect(page.getByRole("heading", { name: /^Wild Card/ })).toBeVisible();
  await expect(page.getByText("You're in")).toBeVisible();
  const homeTeams = page.getByRole("button", { name: /, home$/ });
  await expect(homeTeams).toHaveCount(6);
  for (const button of await homeTeams.all()) await button.click();
  await page.getByRole("button", { name: "POW: MIA at BUF" }).click();
  await page.getByRole("button", { name: "Save picks" }).click();
  await expect(page.getByText("Picks saved.")).toBeVisible();

  // The Wild Card results come in: final, and the Divisional round opens. The player skips it.
  await setFeedWeek(request, 2027, 19, round(WILD_CARD, true));
  await setFeedWeek(request, 2027, 20, round(DIVISIONAL));
  await setClock(request, "2028-01-18T06:00:00Z");
  await runJobs(request, leagues);
  await setFeedWeek(request, 2027, 20, round(DIVISIONAL, true));
  await setFeedWeek(request, 2027, 21, round(CONFERENCE));
  await setClock(request, "2028-01-24T06:00:00Z");
  await runJobs(request, leagues);
  await setFeedWeek(request, 2027, 21, round(CONFERENCE, true));
  await setFeedWeek(request, 2027, 22, round(SUPER_BOWL));
  await setClock(request, "2028-01-31T06:00:00Z");
  await runJobs(request, leagues);

  // Out of picking since the Divisional round, but the Super Bowl guess is still open. The Conference round's
  // recap comes first.
  await page.goto(leagueUrl);
  const conference = page.getByRole("dialog", { name: "Conference is final" });
  await conference.getByRole("button", { name: "Close", exact: true }).click();
  await expect(conference).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Super Bowl/ })).toBeVisible();
  await expect(page.getByText("You're out of picking")).toBeVisible();
  await expect(page.getByRole("button", { name: "Eagles -3, home" })).toBeDisabled();
  // The game hasn't kicked off, so it isn't "Locked": the status line says why they can't pick.
  await expect(page.getByText("Locked", { exact: true })).toHaveCount(0);
  // The Super Bowl has no POW.
  await expect(page.getByRole("button", { name: /^POW:/ })).toHaveCount(0);
  await page.getByLabel(/^Tiebreaker: total points scored in/).fill("41");
  // Nothing to save but the guess.
  await expect(page.getByRole("button", { name: "Save picks" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save guess" }).click();
  await expect(page.getByText("Guess saved.")).toBeVisible();

  // The Super Bowl is final: the champion heads the standings, with the status column beside the points.
  await setFeedWeek(request, 2027, 22, round(SUPER_BOWL, true));
  await setClock(request, "2028-02-14T06:00:00Z");
  await runJobs(request, leagues);
  await page.goto(`${leagueUrl}/standings`);
  const recap = page.getByRole("dialog", { name: "Super Bowl is final" });
  await expect(recap.getByText("You're the champion. Take a bow.")).toBeVisible();
  await recap.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("region", { name: "Champion" }).getByText("Commish")).toBeVisible();
  await expect(page.getByText("Out: Divisional")).toBeVisible();
  // Wild Card: six covers at 1 point each, plus 1 for the POW.
  await expect(
    page.getByRole("table", { name: "Playoff standings" }).getByText("7", { exact: true }),
  ).toBeVisible();
});
