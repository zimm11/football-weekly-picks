import { expect, test } from "./fixtures";
import { harnessState, resetHarness, runJobs, setClock, setFeedWeek } from "./harness";

// The plumbing the simulated journeys stand on: the Worker's clock and feed move, and the app sees the clock.
test.beforeEach(async ({ request }) => {
  await resetHarness(request);
});
test.afterEach(async ({ request }) => {
  await resetHarness(request);
});

test("the dev harness moves the Worker's clock and scripts its feed", async ({ request }) => {
  const at = "2027-01-16T12:00:00-05:00";
  const moved = await setClock(request, at);
  expect(Math.abs(Date.parse(moved.now) - Date.parse(at))).toBeLessThan(5_000);

  const config = await (await request.get("/api/config")).json();
  expect(config.clockOffsetMs).toBe(moved.offsetMs);

  await setFeedWeek(request, 2027, 19, [
    { externalId: "e2e-1", homeTeam: "KC", awayTeam: "BUF", kickoff: "2027-01-16T21:30:00Z", spread: -2.5 },
  ]);
  expect((await harnessState(request)).weeks).toEqual(["2027:19"]);
  expect((await runJobs(request)).weeks).toEqual(["2027:19"]);
});
