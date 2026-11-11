# Football Weekly Picks

An NFL pick'em league: each week players pick every game against the spread, mark one Pick of the Week (POW),
and guess the Monday night total as a tiebreaker. A league admin sets up and closes each week. See "Domain rules".

pnpm monorepo: React web app + Hono API (Node/TS) + Supabase (managed Auth + Postgres). Deployed to Render via
GitHub Actions as two services: the web app is a client-side SPA on a Render static site (CDN), and the API is a
Docker container. The static site proxies `/api/*` to the API, so the browser sees one origin. The API image
contains only the esbuild bundle: no `node_modules`, non-root user. A dependency that can't be bundled (native
addons, files read from disk at runtime) needs a Dockerfile change.

## Layout

- `apps/api` — Hono API. `src/app.ts` builds the app (`createApp` takes deps, so tests inject fakes); routes live in `src/leagues.ts` (leagues, invites, standings) and `src/weeks.ts` (week setup, games, picks, results); `src/context.ts` has the access checks; `src/nfl.ts` is the schedule/odds/results provider (ESPN's public scoreboard feed). `src/index.ts` is the Node entrypoint.
- `apps/web` — Vite + React. `src/api.ts` has the typed Hono client (`hc<ApiType>`) and the Supabase client. `src/components/` holds presentational components, `src/pages/` the containers that fetch, `src/router.tsx` a small History API router.
- `e2e/` — Playwright end-to-end tests and config.
- `scripts/` — `ports.mjs` (per-worktree ports), `supabase.mjs` (CLI wrapper), `supabase-env.mjs` (writes `.env`), `check-db-url.mjs` (checks a connection string without printing the password: `pbpaste | node scripts/check-db-url.mjs`), `render-deploy.mjs` (deploy step).
- `packages/db` — Drizzle schema (`src/schema.ts`, the **source of truth** for the DB) and the `createDb` client.
- `packages/shared` — Zod schemas and types shared by API, web, and the future mobile app. `src/rules.ts` is the rules engine (point values, locks, scoring, tiebreakers) as pure functions; change league rules there.
- `supabase/` — Supabase CLI config, generated SQL migrations, and `seed.sql` (local only: four test accounts, a league, and one closed week; the README lists the logins). Update the seed when a schema change would break it.

## Commands (run from repo root)

- `pnpm ports` — print this checkout's URLs (web, API, Supabase Studio, test inbox, Postgres). **Don't assume the default ports; see "Ports and worktrees".**
- `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` — local Supabase stack (needs Docker). `pnpm db:reset` rebuilds from migrations + seed.
- `pnpm sb <args>` — any other Supabase CLI command. Never call `supabase` directly; it would target the default-port stack.
- `pnpm dev` — API and web dev servers (web proxies `/api` to the API)
- `pnpm build` — production builds: web to `apps/web/dist` (the static site), API bundled by esbuild to `apps/api/dist/index.js` (the Docker image)
- `pnpm db:erd` — regenerate `docs/schema.md` from the Drizzle schema (`pnpm db:generate` does this too)
- `pnpm env:local` — write `.env` from the running local Supabase stack
- `pnpm check` — lint + typecheck + unit/component tests
- `pnpm test:e2e` — Playwright E2E (needs `pnpm db:start`; starts web + API itself, or reuses `pnpm dev`)
- `pnpm test:e2e:ui` — Playwright UI mode, for debugging
- `pnpm test:all` — everything
- `pnpm format` — Biome auto-fix

## Domain rules

- **Structure:** league → seasons (by year) → weeks (1–18, regular season only) → games → picks. A league keeps its members across seasons. Whoever creates a league is its admin; others join through its invite link (`/join/<code>`).
- **Week lifecycle:** `draft` (admin only: import games and spreads from the provider, then add/remove games, edit spreads and point values) → `open` (players pick; spreads are fixed unless the admin edits them) → `final` (scored; everyone's picks revealed). The admin pulls results from the provider or types scores in, then closes the week; a closed week can be reopened to correct it.
- **Picks are private until the week is final.** No endpoint returns another player's picks, points or standings contribution for a week that isn't `final`.
- **Points:** Thursday and Monday 3; Sunday night, Tuesday, Wednesday, Friday, Saturday 2; other Sunday games 1; Thanksgiving and Christmas Day 4. A winning POW adds 5. A push scores nothing and is neither a win nor a loss. Spreads are stored as the home team's line.
- **Locks (league time zone):** at 6am on game day, existing picks on that day's games freeze and none of those games can become, stop being, or lose the POW. A missing pick can still be added until kickoff. A game with a result entered is closed to picks whatever the clock says. A player with no POW gets their pick on the week's tiebreaker (Monday night) game as their POW; from 6am on Sunday that is enforced, so such a player can no longer choose any other game as POW. The tiebreaker game is the admin's explicit choice if they made one, otherwise the last Monday game (else the last game), worked out from the slate on every read.
- **Screens:** `/leagues/:id` is the hub (weeks, standings, and the admin's league tools). `/weeks/:id` is what every player sees: the pick sheet while open, results once final; saving picks returns to the league. `/weeks/:id/manage` is admin-only week management (games, spreads, results, open/close). Keep picking and managing on separate screens.
- **Membership and history:** removing a player marks the membership (`removed_at`) instead of deleting it. Each closed week is scored for the people who were in the league when it was played: a player removed after the week's last kickoff stays in it, and one who joined after it isn't added. Don't score past weeks from the current member list.
- **Pick submissions** run in one transaction that locks the week row and takes a per-player advisory lock, so the lock rules can't be raced. Keep reads, validation and writes inside it.
- **Weekly winner:** most points, then most games won, then closest guess at the tiebreaker game's total (on equal distance, the guess that didn't go over).
- **Season standings:** total points, then POWs won, wins, Monday night wins, Sunday night wins.

## MCP servers (`.mcp.json`)

- `playwright` — drive a browser against the running app.
- `supabase` — the hosted Supabase project (signs in through the browser; run `/mcp` to authenticate). This is the **production** database: read freely, but schema changes still go through migrations, never ad-hoc SQL.
- `render` — the Render service: deploys, logs, env vars. Needs `RENDER_API_KEY` exported in the shell that starts Claude Code.
- GitHub needs no MCP server: use the `gh` CLI.

## Ports and worktrees

Every git worktree runs its own isolated stack, so agents can work in parallel.

- `scripts/ports.mjs` gives the main checkout (and CI) slot 0, the default ports: web 5173, API 8787, Supabase 54320–54329. Each linked worktree gets the next free slot `n`: web `5173+n`, API `8787+n`, Supabase `54320+10n` onward, and its own Supabase project (`football-weekly-picks-<n>`) with a separate database.
- Slots are recorded in `picks-port-slots.json` inside the shared `.git` directory and freed when the worktree directory is gone. Force one with `PICKS_PORT_SLOT=<n>`.
- `pnpm env:local` writes the ports into `.env` (`PORT`, `WEB_PORT`); Vite, the API, and Playwright all read them from there. Run it after `pnpm db:start` in every new worktree.
- Before deleting a worktree, run `pnpm sb stop --no-backup` in it to remove its containers and database volume.
- The local stack runs only what the app uses: Postgres, Auth, the API gateway, Studio, and the test inbox. Realtime, Storage, Edge Functions, and Analytics are switched off in `supabase/config.toml`; set `enabled = true` there when a feature needs one.

## Database changes

1. Edit `packages/db/src/schema.ts`.
2. `pnpm db:generate --name <short_description>` writes SQL to `supabase/migrations/` and refreshes the schema diagram in `docs/schema.md`. Review the SQL.
3. `pnpm db:reset` rebuilds the local DB from migrations + seed.
4. Commit the schema change, the migration SQL, `supabase/migrations/meta/`, and `docs/schema.md`.

- For SQL Drizzle can't express (triggers, functions, grants): `pnpm db:migrate:custom --name <desc>`, then fill in the empty file.
- **Renames:** when a change could be either a rename or a drop + add, `drizzle-kit generate` asks interactively, and agents can't answer the prompt. Agents should not attempt a column or table rename on their own. Stop and ask the human to run `pnpm db:generate` in a terminal and pick "rename". (A hand-written custom migration doesn't help, because drizzle-kit diffs against its snapshot in `migrations/meta/`, not the live DB.)
- **Never edit a migration that has been merged to main.** Add a new one.
- Migrations deploy before the new code ships, so keep them backward-compatible (expand, then contract).
- CI fails if `schema.ts` changes without a matching migration, or if `docs/schema.md` is out of date.
- `docs/schema.md` (ER diagram + table reference) is generated by `packages/db/scripts/erd.mjs`; never edit it by hand. Its descriptions are the `/** ... */` comments above tables and columns in `schema.ts`, so document new tables and columns there. A comment-only change needs `pnpm db:erd`.

## Testing

| Layer     | Tool                                                               | Location                      | Covers                                                                 |
| --------- | ------------------------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------- |
| Unit      | Vitest (Node)                                                      | `packages/*/src/**/*.test.ts` | Pure logic and Zod schemas                                             |
| API       | Vitest + `app.request()`                                           | `apps/api/test/`              | Routes, auth, DB behavior. DB suites skip unless `DATABASE_URL` is set |
| Component | Vitest browser mode (Playwright Chromium) + `vitest-browser-react` | `apps/web/src/**/*.test.tsx`  | Single components given props. No network                              |
| E2E       | Playwright Test (Chromium + mobile WebKit)                         | `e2e/tests/`                  | Real user flows across web → API → Supabase                            |

**Workflow for agents. Follow this before saying a change is done:**

1. `pnpm check` must pass.
2. If the change touches UI, routes, auth, or the schema: run `pnpm test:e2e` with `pnpm db:start` running.
3. For UI changes, also check visually: with `pnpm dev` running, use the Playwright MCP tools to open the web URL from `pnpm ports`, step through the changed flow, and take a screenshot.
4. Add or update tests at the lowest layer that can catch the bug. E2E covers critical user journeys only.

Conventions:

- Query by role, label, or text (`getByRole("button", { name: "Eagles" })`), never by CSS class. Add `aria-label`s so elements are reachable this way.
- Keep components presentational (data and callbacks in via props) so they're testable without mocks. Containers in `App.tsx` do the fetching.
- E2E tests sign up a fresh user per test (the `signedIn` fixture), so they never share state. Tests delete only rows they created; never truncate.
- Time-dependent logic takes a `now` parameter, so tests pass a fixed date rather than mocking timers.

## Conventions

- Every table gets `.enableRLS()` with no policies. The API connects as a privileged role; RLS stops clients holding the public publishable key from touching tables directly via Supabase's REST API. Don't add RLS policies unless clients are meant to query Supabase directly.
- Request and response shapes live in `packages/shared` (Zod). Validate input with `zValidator`.
- Auth: clients sign in with Supabase and send `Authorization: Bearer <access_token>`. `requireAuth` verifies it and sets `c.var.user`.
- Keep routes chained on the Hono instance, otherwise `ApiType` loses route types and the web client breaks.

## Deploy (GitHub Actions → Render)

- `ci.yml` runs on PRs. Job `check`: lint, typecheck, migration drift check, unit + component tests, web build, API docker build. Job `e2e`: local Supabase, DB-backed API tests, Playwright (report uploaded as an artifact).
- `deploy.yml` runs on push to main: CI → connection-string check → `supabase db push` → `scripts/render-deploy.mjs` for the API, then again for the static site. Each run asks Render to build and deploy that commit and waits until it is live (the job fails if the deploy fails). The API deploys first, so the API must stay backward-compatible with the web build that is still live.
- `render.yaml` defines both services, with auto-deploy off so Actions is the only deploy path:
  - `football-weekly-picks-ui` (static site, the public URL): builds `apps/web/dist` on Render; `/assets/*` cached as immutable; rewrites `/api/*` to the API and every other path without a file to `/index.html`.
  - `football-weekly-picks` (Docker, API only): health check on `/api/health`; Render keeps the old version serving until the new one passes it. Its onrender.com URL is hard-coded in the static site's `/api/*` rewrite.
- Secrets (GitHub environment `production`): `SUPABASE_DB_URL` (session pooler URL; GitHub runners are IPv4-only), `RENDER_API_KEY`, `RENDER_SERVICE_ID` (the API service), `RENDER_STATIC_SITE_ID` (the static site).
- API service env vars on Render: `DATABASE_URL` (Supabase session pooler URL), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`. `PORT` is set to 10000 in `render.yaml`.
- The web build needs no env vars (it fetches `/api/config` at runtime). Supabase Auth's Site URL and redirect URLs must point at the static site's URL.
- The image is host-neutral (listens on `PORT`, three env vars, health check), and `apps/web/dist` works on any static host that can proxy `/api/*`. Only `render.yaml` and the deploy step are Render-specific.
