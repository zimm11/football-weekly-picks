# Testing

The checklist to run before saying a change is done is in `AGENTS.md`. This doc is how to write the tests.

## Layers

Add or update tests at the lowest layer that can catch the bug. E2E covers critical user journeys only.

| Layer    | Tool                                       | Location                                               | Covers                                                                 |
| -------- | ------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| Unit     | Vitest (Node)                              | `packages/*/src/**/*.test.ts`                          | Pure logic and Zod schemas                                             |
| API      | Vitest + `app.request()`                   | `apps/api/test/`                                       | Routes, auth, DB behavior. DB suites skip unless `DATABASE_URL` is set |
| App      | Vitest (Node)                              | `apps/mobile/src/**/*.test.ts`                         | The app's pure helpers and API/session adapters. No network            |
| E2E      | Playwright Test (Chromium + mobile WebKit) | `e2e/tests/`                                           | Real user flows across the Expo web build → Worker API → Supabase      |
| Script   | Node test runner                           | `scripts/*.test.mjs`, `packages/db/scripts/*.test.mjs` | Deploy and database tooling, credential redaction, headers, these docs |
| Contract | Vitest (Node, live network)                | `apps/api/test/contract/*.contract.ts`                 | ESPN's real responses against the app's URLs, schemas, parsers         |

`pnpm test` runs unit, API, app and script tests; `pnpm test:all` adds E2E. `pnpm test:contract` is separate and needs the network.

## Conventions

- Query by role, label, or text (`getByRole("button", { name: "Eagles" })`), never by CSS class. Add `aria-label`s so elements are reachable this way.
- Keep components presentational (data and callbacks in via props), and put logic worth testing in pure functions in `apps/mobile/src/lib/` with a Node test beside them.
- Time-dependent logic takes a `now` parameter, so tests pass a fixed date rather than mocking timers. In the API, read time from the `now` dep; in the app, from `now()` in `apps/mobile/src/lib/clock.ts`, never `new Date()`. That keeps the local `CLOCK_OVERRIDE` (README, "Simulating a different date and time") working.
- The API's deps are injected (`AppDeps` in `apps/api/src/context.ts`), so tests pass their own provider (`nfl`), clock (`now`), `random`, `email`, `push` and `background`.
- Tests that cover account deletion wrap their token verifier with `refuseDeletedAccounts`, as both entrypoints do.
- Content tests use the placeholder `forbiddenword`; never write offensive words into the repo.

## E2E

- Needs `pnpm db:start`. Playwright starts `pnpm worker:dev` itself or reuses one already listening (`reuseExistingServer`; `WORKER_PORT` picks another port; `EXPO_WEB_OUT=<dir>` builds into another folder, so parallel runs don't collide). Stop a hand-started `pnpm worker:dev` first, or the suite tests a stale build, and stop `pnpm dev`, whose API runs the scheduled jobs every minute on the same database.
- If the password-reset test fails after `pnpm db:reset` (the test inbox shows Auth's default "Reset your password" email, not the repo's template), restart the stack (`pnpm db:stop`, `pnpm db:start`) before suspecting the app.
- Tests sign up a fresh user per test (the `signedIn` fixture), so they never share state. Tests delete only rows they created; never truncate.
- All local email lands in the test inbox; tests read it through `e2e/tests/inbox.ts`.
- E2E allows only local database and auth services, and its browsers reach only loopback hosts (`launchOptions.proxy` in `e2e/playwright.config.ts`), so a link to the live site fails the test rather than creating a production account. Traces and screenshots are disabled because they can capture credentials.

## Simulated journeys (the dev harness)

A journey that needs the feed or time to move by itself (a week, round, board or pool that runs itself) is a `*.sim.spec.ts` file driving the dev harness through `e2e/tests/harness.ts` (`resetHarness`, `setClock`, `setFeedWeek`, `runJobs(request, [leagueId])`).

- Playwright starts the Worker with `DEV_HARNESS=1`, which replaces ESPN with the scripted feed (an unscripted week has no games) and shifts the Worker's clock. It serves `/api/dev/*` outside the API.
- The `simulated` project runs these files one at a time after the parallel projects, since the clock and feed are shared by the whole Worker (`--project=simulated --no-deps` runs them alone).
- Reset the harness before and after each test, move the clock only forward of real time (play a future season), and reload the page after moving it.
- Pass `runJobs` the journey's own league ids (`leagueIdOf(page.url())`): automation advances only those, since the future clock would otherwise play the seeded leagues forward (finalizing their weeks, drawing their boards) until the next `pnpm db:reset`.
