# Football Weekly Picks

The app is called **POW Pick'em** in everything players see, and lives at `www.pow-pickem.com`. "Football Weekly Picks" is the repository and service name only.

An NFL pick'em app. Every league has one of four types: weekly pick'em (each week players pick every game against the spread, mark one Pick of the Week (POW), and guess the Monday night total as a tiebreaker), playoff pick'em, squares or survivor. A league's admins (commissioners, to players) run it by hand, or it runs itself from the schedule feed.

pnpm monorepo: an Expo (React Native) app for iPhone and the web, a Hono API (TypeScript) and Supabase (managed Auth and Postgres). GitHub Actions deploys one Cloudflare Worker: Static Assets serve the Expo web build, and `/api/*` runs the Hono API in the Workers runtime, reaching Postgres through Hyperdrive. Local development and tests run the same API on Node.

## Read before you change

This file holds only what every task needs. Each area has its own doc; read it before changing that area.

| Before changing                                                                | Read                           |
| ------------------------------------------------------------------------------ | ------------------------------ |
| Any screen or component: theme, controls, copy, motion, loading, feedback      | `docs/agents/design.md`        |
| App structure: routes, the league tabs, load cache, browser Back, unsaved work | `docs/agents/app.md`           |
| League types, creating a league, members, admins, invites, Your leagues        | `docs/agents/leagues.md`       |
| Weeks, picks, locks, scoring, standings, awards, the recap, the matchup sheet  | `docs/agents/weekly.md`        |
| Leagues that run themselves: the cron, Automatic weekly                        | `docs/agents/automation.md`    |
| Playoff pick'em                                                                | `docs/agents/playoff.md`       |
| Squares                                                                        | `docs/agents/squares.md`       |
| Survivor                                                                       | `docs/agents/survivor.md`      |
| The message board, reactions, content moderation                               | `docs/agents/messages.md`      |
| Email, push, league events, pick reminders                                     | `docs/agents/notifications.md` |
| Sign-in, emailed links, account deletion, Settings, home-screen help           | `docs/agents/accounts.md`      |
| API modules, the Workers runtime, the ESPN provider, logging and credentials   | `docs/agents/api.md`           |
| Writing tests, the E2E dev harness                                             | `docs/agents/testing.md`       |
| CI, deploy, secrets, security headers, cost limits                             | `docs/agents/deploy.md`        |

**Keep this file short.** It loads into every agent session, and Codex reads only the first 32 KiB of it; `scripts/agents-doc.test.mjs` fails over 24 KB. New detail goes in the area's doc, and only when the code can't say it: a rule, a reason, a trap, where something lives. Don't describe what a screen shows; the code and its tests do that.

## Layout

- `apps/api` — Hono API. `src/app.ts` builds it (`createApp` takes deps, so tests inject fakes). Routes are one module per area (`leagues.ts`, `weeks.ts`, `messages.ts`, `moderation.ts`, …) and per league type (`playoff.ts`, `squares.ts`, `survivor.ts`); `src/automation/` runs leagues that run themselves. `src/index.ts` is the Node entrypoint (local dev, tests), `src/worker.ts` the Cloudflare Worker's (production).
- `apps/mobile` — Expo Router + React Native: the iPhone app and, through react-native-web, the website (there is no other web client). `app/` routes are thin files that render a screen from `src/screens/`; shared components and the theme are in `src/components/`; adapters and pure, unit-tested helpers in `src/lib/`.
- `packages/shared` — Zod schemas and types shared by the API and the app, and the rules as pure functions (`src/rules.ts`, `src/leagueTypes.ts`, one file per league type). Change league rules there.
- `packages/db` — Drizzle schema (`src/schema.ts`, the **source of truth** for the DB) and the database clients.
- `supabase/` — Supabase CLI config, generated SQL migrations, Auth email templates, and the local seed (`seed.sql`, then `seeds/*.sql`, one per league type). Update the seed when a schema change would break it.
- `e2e/` — Playwright tests. `scripts/` — tooling (ports, the Supabase wrapper, icons, deploy checks), each with a `*.test.mjs` beside it.
- `docs/` — `agents/` (above), `schema.md` (generated) and `web-cutover.md`.

## Commands (run from repo root)

- `pnpm ports` — print this checkout's URLs. **Don't assume the default ports; see "Ports and worktrees".**
- `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` — local Supabase stack (needs Docker). `pnpm db:reset` rebuilds from migrations + seed.
- `pnpm sb <args>` — any other Supabase CLI command. Never call `supabase` directly; it would target the default-port stack.
- `pnpm dev` — the day-to-day loop: Supabase (applying new migrations), the API on Node, and Expo with its hot-reloaded browser preview. It needs a network for the LAN address; offline, use `pnpm worker:dev`.
- `pnpm mobile` — the same for a phone with Expo Go (`--web` adds the browser preview, `--help` lists the options). Server logs go to `.expo/logs/` in `apps/mobile`.
- `pnpm worker:dev` — the production build as Cloudflare runs it (Expo web build + API in the Workers runtime) against local Supabase, on `PORT + 1000`. E2E runs against it.
- `pnpm build` — Expo web build, then a dry-run bundle of the Worker.
- `pnpm env:local` — write `.env` from the running local Supabase stack.
- `pnpm check` — lint + typecheck + unit/app/script tests (`pnpm lint`, `pnpm typecheck`, `pnpm test`).
- `pnpm format` — Biome auto-fix.
- `pnpm mobile:check` and `pnpm mobile:export` — the app's typecheck and tests, and its iOS JavaScript bundle. Run both after app changes.
- `pnpm test:e2e` — Playwright against the local Worker (needs `pnpm db:start`; starts `pnpm worker:dev` itself or reuses a running one; `pnpm playwright:install` once). `pnpm test:e2e:ui` for debugging.
- `pnpm test:contract` — live checks of ESPN's feeds against what the app reads (needs the network; not part of `pnpm test`).
- `pnpm db:generate --name <desc>` / `pnpm db:erd` — see "Database changes".

## Rules that always hold

Privacy and data:

- **Picks are private until the league type's reveal point** (`LEAGUE_TYPE_INFO[type].reveal`). Weekly and playoff: no endpoint returns another player's picks, points or standings contribution for a week that isn't `final`, except its results so far (`WeekView.resultsSoFar`: each pick on a game that has locked, with the week's points as they stand), which go to the league's admins and, in a league that runs itself or a Hands-on one whose admins share them, to every player (`resultsSoFarAudience`); see `docs/agents/weekly.md`. Survivor: a pick shows from its team's kickoff; before that the API says nothing about it, not even that one exists, admins included. A squares board is public.
- Email and push payloads carry league names and thread titles, never a pick, a team, a square, a message body or whether the reader is in or out.
- Never hard-delete an `auth.users` row: it cascades through every table. Account deletion soft-deletes.
- Don't score past weeks from the current member list; a closed week is scored for who was in the league when it was played (`week_participants`).
- A mute or suspension never touches picking: no moderation checks in pick, week or standings routes.
- Never write offensive words into the repo; tests use the placeholder `forbiddenword`.

Writes:

- A pick save, a square claim, a lock, a draw or a score write is one transaction that takes the week or board row lock first. Keep reads, validation and writes inside it.
- Every email and push goes through its queue (`email_outbox`, `push_deliveries`): queued in the transaction that made the change, sent after commit, rechecked just before sending. Don't add a send path that skips it.
- Scheduled jobs and automation steps are idempotent. Hands-on weekly leagues are never advanced by automation.
- `GET /leagues` calls no feed and runs no automation.
- Every type-specific route checks the league type first (`requireLeagueType`, `requireBoard`) and answers 404 for another type.

Words:

- Players read **commissioner**, never "admin"; code, API fields and the database keep `admin` (stored rows and installed apps depend on it; don't rename). These docs say "admin".
- Players read **pro football**, never "NFL" (one exception: the Terms' non-affiliation line), and never the data provider's name (ESPN). Code, logs and developer docs use both.
- No sportsbook or prediction-market prices, branding or betting links. Team badges are the app's own drawings, never a team's logo.

Runtime:

- Code the API runs must work on Node and in Workers: no native addons, no files read from disk at runtime, nothing shared between requests except settled values (never an in-flight promise, socket or stream). Work that outlives the response goes through the `background` dep; a bare un-awaited promise is cancelled.
- The API stays backward-compatible with open browser tabs and installed iPhone apps, which keep their old build after a deploy.
- Time-dependent logic takes `now`: the `now` dep in the API, `now()` in `apps/mobile/src/lib/clock.ts` in the app, never `new Date()`.
- The app loads nothing from third parties (no images, fonts or scripts); the CSP allows none.
- Logs never print raw errors, SQL parameters, request bodies or headers, or raw URLs (`apps/api/src/logging.ts`). Never disable TLS certificate verification.

## Before saying a change is done

1. `pnpm check` must pass.
2. If the change touches UI, routes, auth, or the schema: run `pnpm test:e2e` with `pnpm db:start` running.
3. For UI changes, also check visually: with `pnpm worker:dev` (or `pnpm dev`) running, use the Playwright MCP tools to open its URL from `pnpm ports`, step through the changed flow, and take a screenshot. For iPhone-only behavior, also run `pnpm mobile:export`, and check on a device or simulator when it matters.
4. Add or update tests at the lowest layer that can catch the bug (`docs/agents/testing.md`). E2E covers critical user journeys only.
5. If the change touches how ESPN is read (`nfl.ts`, `insights.ts`, or `TEAM_ABBRS` in `packages/shared`): run `pnpm test:contract`, and extend `apps/api/test/contract/` to cover any new field or convention the app relies on.
6. When a rule or a player-facing flow changes, update the places that describe it: the How to play page (`apps/mobile/app/how-to-play.tsx`), the README ("Walking through a week", "League rules"), the area's doc in `docs/agents/` (rules and reasons, not this file), and the comments at the top of `supabase/seed.sql`. The Terms of use (`apps/mobile/app/terms.tsx`) describe the moderation rules, limits and account deletion too.
7. When what the app keeps about a player changes, update the Privacy policy (`apps/mobile/app/privacy.tsx`) and its date in the same change: a new column or table holding something about a player, a new provider or external host (also `_headers`), a new kind of email or notification, a retention period, or what account deletion clears. Keep the App Store privacy answers (`apps/mobile/README.md`) saying the same thing.

## Database changes

1. Edit `packages/db/src/schema.ts`.
2. `pnpm db:generate --name <short_description>` writes SQL to `supabase/migrations/` and refreshes the schema diagram in `docs/schema.md`. Review the SQL, including its order: drizzle-kit can write a composite foreign key before the unique constraint it refers to, which fails until the constraint is moved above it by hand.
3. `pnpm db:reset` rebuilds the local DB from migrations + seed.
4. Commit the schema change, the migration SQL, `supabase/migrations/meta/`, and `docs/schema.md`.

- For SQL Drizzle can't express (triggers, functions, grants): `pnpm db:migrate:custom --name <desc>`, then fill in the empty file.
- **Renames:** when a change could be either a rename or a drop + add, `drizzle-kit generate` asks interactively, and agents can't answer the prompt. Don't attempt a column or table rename; stop and ask the human to run `pnpm db:generate` in a terminal and pick "rename". (A hand-written custom migration doesn't help: drizzle-kit diffs against its snapshot in `migrations/meta/`, not the live DB.)
- **Never edit a migration that has been merged to main.** Add a new one.
- Migrations deploy before the new code ships, so keep them backward-compatible (expand, then contract).
- CI fails if `schema.ts` changes without a matching migration, or if `docs/schema.md` is out of date. `docs/schema.md` is generated from the `/** ... */` comments above tables and columns in `schema.ts`; never edit it by hand, document new tables and columns there, and run `pnpm db:erd` after a comment-only change.

## Ports and worktrees

Every git worktree runs its own isolated stack (its own ports, Supabase project and database), so agents can work in parallel.

- `pnpm ports` prints this checkout's URLs. The main checkout and CI get the default ports (API 8787, Metro and the web preview 8081, the local Worker 9787, Supabase 54320–54329); each linked worktree gets the next free slot (`scripts/ports.mjs`; `PICKS_PORT_SLOT=<n>` forces one).
- In every new worktree, run `pnpm env:local` after `pnpm db:start`: it writes the ports into `.env`, which the API, `pnpm worker:dev` and Playwright read.
- Before deleting a worktree, run `pnpm sb stop --no-backup` in it to remove its containers and database volume.
- The local stack runs only Postgres, Auth, the API gateway, Studio and the test inbox (Mailpit), where all local email lands. PostgREST, Realtime, Storage, Edge Functions and Analytics are switched off in `supabase/config.toml`; set `enabled = true` there when a feature needs one.

## Conventions

- A text column with a fixed set of values lists them once in `schema.ts` and gets a CHECK from the same list (`oneOf`); `text({ enum })` alone is only a TypeScript type. A second foreign key between the same two tables repeats the first one's `ON DELETE` rule, never `NO ACTION`: which of the two Postgres checks first isn't guaranteed.
- Every table gets `.enableRLS()` with no policies. The client roles (`anon`, `authenticated`) also hold no grants on `public`; a function added to `public` needs its own `REVOKE ... FROM PUBLIC`. The API connects as a privileged role; RLS stops clients holding the public publishable key from touching tables directly. Don't add RLS policies unless clients are meant to query Supabase directly.
- Request and response shapes live in `packages/shared` (Zod). Validate input with `zValidator`. Names and titles (display names, league names, thread titles) use `singleLine`: they reach email subjects and notification titles, where a line break could forge a header.
- Auth: clients sign in with Supabase and send `Authorization: Bearer <access_token>`. `requireAuth` verifies it and sets `c.var.user`.
- Keep routes chained on the Hono instance, otherwise `ApiType` loses its route types.

## MCP servers (`.mcp.json`)

- `playwright` — drive a browser against the running app.
- `supabase` — the hosted Supabase project (run `/mcp` to authenticate). This is the **production** database: read freely, but schema changes still go through migrations, never ad-hoc SQL.
- Cloudflare: the `cloudflare` Claude Code plugin brings the Cloudflare MCP server and Workers skills. Use them, or `pnpm --filter @picks/api exec wrangler …`, for deploys, logs, secrets and Hyperdrive.
- GitHub needs no MCP server: use the `gh` CLI.
