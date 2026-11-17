import { type APIRequestContext, expect } from "@playwright/test";

/*
 * Drives the Worker's dev harness (apps/api/src/devHarness.ts): a scripted schedule feed and a movable clock, so a
 * journey can run a week, round, board or pool with nobody pressing Open or Finalize. Use it only from
 * `*.sim.spec.ts` files, which the "simulated" project runs one at a time: the clock and feed are shared by the
 * whole Worker.
 *
 * - Reset in `beforeEach` (and `afterEach`), so every journey starts on real time and an empty feed.
 * - Move the clock only forward of the real time. Rows the database stamps itself (sign-ups, joins) use real
 *   time, so a clock in the past would put them after the moments the app compares them with. Play a future
 *   season (for example 2027) and script its weeks.
 * - The app reads the clock once per page load: reload (or navigate) after `setClock`.
 * - `runJobs` runs the Cron Trigger's work once at the harness's time; reads also advance a league by
 *   themselves (advanceLeagueOnRead, at most once a minute per league, so move the clock a minute or more
 *   between steps that rely on a read).
 */

/** One scripted game: kickoff as an ISO string; the rest as the provider's `ProviderGame`. */
export type HarnessGame = {
  externalId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  spread?: number | null;
  homeScore?: number | null;
  awayScore?: number | null;
  status?: "scheduled" | "in_progress" | "final";
  period?: number;
  periodScores?: Partial<Record<"q1" | "half" | "q3" | "final", { home: number; away: number }>>;
};

type State = { now: string; offsetMs: number; weeks: string[] };

async function send(
  request: APIRequestContext,
  method: "get" | "put" | "post" | "delete",
  path: string,
  data?: object,
) {
  const res = await request[method](`/api/dev/${path}`, data ? { data } : undefined);
  if (res.status() === 404) {
    throw new Error(
      "The dev harness is off. Stop any running `pnpm worker:dev` and let Playwright start it (it sets DEV_HARNESS=1).",
    );
  }
  expect(res.ok(), `${method.toUpperCase()} /api/dev/${path}: ${await res.text()}`).toBe(true);
  return (await res.json()) as State;
}

/** Real time and an empty feed. */
export const resetHarness = (request: APIRequestContext) => send(request, "delete", "harness");

/** Moves the Worker's clock to `at`; it keeps running from there. Reload the page afterwards. */
export const setClock = (request: APIRequestContext, at: Date | string) =>
  send(request, "put", "clock", { now: typeof at === "string" ? at : at.toISOString() });

/** Replaces the slate the feed reports for one week (1–18, 19–22 for the postseason). */
export const setFeedWeek = (request: APIRequestContext, year: number, week: number, games: HarnessGame[]) =>
  send(request, "put", `feed/${year}/${week}`, { games });

/** Runs the scheduled jobs (automation, then email and push) once, at the harness's time. */
export const runJobs = (request: APIRequestContext) => send(request, "post", "jobs");

export const harnessState = (request: APIRequestContext) => send(request, "get", "state");
