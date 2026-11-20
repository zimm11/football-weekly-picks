# Leagues that run themselves

Code: `apps/api/src/automation/` — `index.ts` (`advanceLeagues`, the cron's entry; `advanceLeague`; `AUTOMATION`, one `LeagueTypeAutomation` per type with `due(ctx, limit)` and `advance(ctx, league)`), `types.ts`, and one handler file per type (`pickem.ts` is shared by weekly and playoff). `apps/api/src/services.ts` holds `advanceLeagueOnRead`; `apps/api/src/weekOps.ts` the week chores; `apps/api/src/jobs.ts` is what the Cron Trigger calls. Each type's own steps are in its doc (`docs/agents/playoff.md`, `squares.md`, `survivor.md`).

## How a run works

- The Worker's Cron Trigger runs `runScheduledJobs` every five minutes (`pnpm dev` uses a one-minute timer): `runModerationJobs` and `advanceLeagues`, then `runEmailJobs` and `runPushJobs`. The job must stay idempotent.
- `advanceLeagues` runs first and fails on its own: for each type, the leagues its handler says have something due (a bounded batch), each advanced and caught on its own (`automation_due`, `automation_league`).
- The same `advanceLeague` runs on read through `advanceLeagueOnRead`, at most once a minute per league (settled values only); league, week, survivor and board reads call it first. An admin's game edit in a league that runs itself advances it at once (`{ force: true }`), so a week opens as soon as its last line is typed in and finalizes as soon as its last score is.
- **Hands-on weekly leagues are never advanced.**
- **Steps must be idempotent, take their week or board row lock, and queue their notifications in the same transaction.** Each step reads the feed before its transaction through `ctx.results` (once per NFL week per run).
- Every type's due query selects only leagues with something to do, in random order (`order by random()`), so leagues waiting on nothing can't hold the batch and a busy day reaches everyone within a few runs.
- `AutomationContext.onlyLeagues` scopes a run to named leagues: the E2E harness and the API tests use it, production never does.

## Pick'em steps (weekly and playoff)

- `advanceDraft`: once the plan's opening time has come, refresh the slate from the feed (the whole slate only while the week has no games, so a game the admin removed stays removed), then open in the same step.
- `advanceOpen`: follow the feed's kickoffs for games still to finish (`followKickoffs` in `weekOps.ts`: never a spread, and points only until the week's first kickoff), fill finals (never over a typed score), then finalize.
- A week with no games is never "every line in" or "every result in".

## Automatic weekly

Code: `apps/api/src/automation/weekly.ts`, `packages/shared/src/weekly.ts`.

- Start season stores `{ startWeek }` and creates the start week as an empty draft (refused for a season already over). The season automation runs is the league's latest with weeks, through Week 18, while it is this NFL season.
- **Draft and open happen together, on the week's Tuesday.** At `weeklyOpensAt` (the last Tuesday 9 AM Eastern at or before the first kickoff) the next week is created (once every week is final; a week whose games have all kicked off is skipped), its slate and that morning's lines are imported, and it opens in the same run. Nothing is imported before then, an empty draft included (`PickemPlan.opensAt` gates the first import), so lines are never drawn days ahead. Don't bring back a Monday-night draft.
- Spreads freeze at open: automation imports into drafts only (`importSlate(…, { keepAdminSpreads: true })`); points set by hand and an explicit tiebreaker are never touched.
- A draft that already has games (the admin imported it by hand, or a line was missing on Tuesday) keeps following the feed and opens once every game has a line.
- The due query waits accordingly: an empty draft is due from a week before its estimated start (`estimatedWeekStart`), and a final latest week once a Tuesday 9 AM has passed since it began.
- A line still missing 24 hours before the first kickoff (`missingLineDue`) is a league event to the admins only, once (`missing-line:<weekId>`). The other league events are `week-open:<weekId>` and `week-final:<weekId>:<finalizedAt>`.
- **Admin edits in a league that runs itself** (playoff included): spread and point edits stop at the week's first kickoff (`slateEditable`), and a final week's score is corrected in place (`PATCH /games/:id` on a final week takes scores only, never clears one, and bumps `finalized_at` so the recap shows again). The app hides Reopen there and offers no announcement thread.
- Switching to Automatic picks the weeks up as they stand; switching back stops it. Weeks created by hand (Set up a week) stay the admin's override. Switching also changes who sees an open week's results so far, at once: every player while the league runs itself, and the Hands-on league's own setting after switching back (`resultsSoFarAudience`).
