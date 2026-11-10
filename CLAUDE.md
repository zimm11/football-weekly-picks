# Football Weekly Picks

**Status: infrastructure skeleton. No business logic yet.** Anything marked `PLACEHOLDER` (the `examples` table,
`/api/examples` routes, `ExampleList` component, E2E item flow) exists only to exercise the stack end to end.
Replace it as real features land.

pnpm monorepo: React web app + Hono API (Node/TS) + Supabase (managed Auth + Postgres). Deployed to Render as a
single container (the API also serves the built web app) via GitHub Actions. The image contains only the esbuild
bundle of the API and the static web build: no `node_modules`, non-root user. A dependency that can't be bundled
(native addons, files read from disk at runtime) needs a Dockerfile change.

## Layout

- `apps/api` — Hono API. `src/app.ts` holds all routes (`createApp` takes deps, so tests inject fakes). `src/index.ts` is the Node entrypoint.
- `apps/web` — Vite + React. `src/api.ts` has the typed Hono client (`hc<ApiType>`) and the Supabase client. `src/components/` holds presentational components.
- `e2e/` — Playwright end-to-end tests and config.
- `scripts/` — `ports.mjs` (per-worktree ports), `supabase.mjs` (CLI wrapper), `supabase-env.mjs` (writes `.env`).
- `packages/db` — Drizzle schema (`src/schema.ts`, the **source of truth** for the DB) and the `createDb` client.
- `packages/shared` — Zod schemas and types shared by API, web, and the future mobile app.
- `supabase/` — Supabase CLI config, generated SQL migrations, and `seed.sql` (local only).

## Commands (run from repo root)

- `pnpm ports` — print this checkout's URLs (web, API, Supabase Studio, test inbox, Postgres). **Don't assume the default ports; see "Ports and worktrees".**
- `pnpm db:start` / `pnpm db:stop` / `pnpm db:status` — local Supabase stack (needs Docker). `pnpm db:reset` rebuilds from migrations + seed.
- `pnpm sb <args>` — any other Supabase CLI command. Never call `supabase` directly; it would target the default-port stack.
- `pnpm dev` — API and web dev servers (web proxies `/api` to the API)
- `pnpm build` — production builds: web to `apps/web/dist`, API bundled by esbuild to `apps/api/dist/index.js`
- `pnpm env:local` — write `.env` from the running local Supabase stack
- `pnpm check` — lint + typecheck + unit/component tests
- `pnpm test:e2e` — Playwright E2E (needs `pnpm db:start`; starts web + API itself, or reuses `pnpm dev`)
- `pnpm test:e2e:ui` — Playwright UI mode, for debugging
- `pnpm test:all` — everything
- `pnpm format` — Biome auto-fix

## Ports and worktrees

Every git worktree runs its own isolated stack, so agents can work in parallel.

- `scripts/ports.mjs` gives the main checkout (and CI) slot 0, the default ports: web 5173, API 8787, Supabase 54320–54329. Each linked worktree gets the next free slot `n`: web `5173+n`, API `8787+n`, Supabase `54320+10n` onward, and its own Supabase project (`football-weekly-picks-<n>`) with a separate database.
- Slots are recorded in `picks-port-slots.json` inside the shared `.git` directory and freed when the worktree directory is gone. Force one with `PICKS_PORT_SLOT=<n>`.
- `pnpm env:local` writes the ports into `.env` (`PORT`, `WEB_PORT`); Vite, the API, and Playwright all read them from there. Run it after `pnpm db:start` in every new worktree.
- Before deleting a worktree, run `pnpm sb stop --no-backup` in it to remove its containers and database volume.
- The local stack runs only what the app uses: Postgres, Auth, the API gateway, Studio, and the test inbox. Realtime, Storage, Edge Functions, and Analytics are switched off in `supabase/config.toml`; set `enabled = true` there when a feature needs one.

## Database changes

1. Edit `packages/db/src/schema.ts`.
2. `pnpm db:generate --name <short_description>` writes SQL to `supabase/migrations/`. Review it.
3. `pnpm db:reset` rebuilds the local DB from migrations + seed.
4. Commit the schema change, the migration SQL, and `supabase/migrations/meta/`.

- For SQL Drizzle can't express (triggers, functions, grants): `pnpm db:migrate:custom --name <desc>`, then fill in the empty file.
- **Renames:** when a change could be either a rename or a drop + add, `drizzle-kit generate` asks interactively, and agents can't answer the prompt. Agents should not attempt a column or table rename on their own. Stop and ask the human to run `pnpm db:generate` in a terminal and pick "rename". (A hand-written custom migration doesn't help, because drizzle-kit diffs against its snapshot in `migrations/meta/`, not the live DB.)
- **Never edit a migration that has been merged to main.** Add a new one.
- Migrations deploy before the new code ships, so keep them backward-compatible (expand, then contract).
- CI fails if `schema.ts` changes without a matching migration.

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

- `ci.yml` runs on PRs. Job `check`: lint, typecheck, migration drift check, unit + component tests, docker build. Job `e2e`: local Supabase, DB-backed API tests, Playwright (report uploaded as an artifact).
- `deploy.yml` runs on push to main: CI → `supabase db push` → `scripts/render-deploy.mjs`, which asks Render to build and deploy that commit and waits until it is live (the job fails if the deploy fails).
- `render.yaml` defines the service: Docker runtime, health check on `/api/health`, auto-deploy off so Actions is the only deploy path. Render keeps the old version serving until the new one passes its health check.
- Secrets (GitHub environment `production`): `SUPABASE_DB_URL` (session pooler URL; GitHub runners are IPv4-only), `RENDER_API_KEY`, `RENDER_SERVICE_ID`.
- Render service env vars: `DATABASE_URL` (Supabase session pooler URL), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`. `PORT` is set to 10000 in `render.yaml`.
- The image is host-neutral (listens on `PORT`, three env vars, health check). Only `render.yaml` and the deploy step are Render-specific.
