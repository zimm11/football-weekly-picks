# Football Weekly Picks

The code behind **[POW Pick'em](https://www.pow-pickem.com)**, an NFL pick'em league app. Players pick
against the spread, choose a Pick of the Week (POW), and compete for weekly wins and the season lead.
A league admin prepares each slate and publishes the results.

The app supports regular-season weeks 1–18, invite-only leagues with shared administration, multiple
seasons, private picks until finalization, and season standings with a week-by-week history. Each game has
a matchup sheet with team stats, injuries, news, and prediction-market prices. Finalized weeks hand out
awards and name a Low Point Loser, and each league has a message board. The interface is phone-first and
dark, and the app can be added to a phone's home screen.

- [Local setup](#local-setup)
- [Trying the app locally](#trying-the-app-locally)
- [League rules](#league-rules)
- [Architecture and repository layout](#architecture-and-repository-layout)
- [Development and testing](#development-and-testing)
- [Database workflow](#database-workflow)
- [Deployment](#deployment)
- [Credentials and diagnostics](#credentials-and-diagnostics)
- [Troubleshooting](#troubleshooting)

## Local setup

### Prerequisites

- **Node.js 24 or newer.** CI and the Docker image use Node 26.
- **pnpm 12.18.0**, pinned in [`package.json`](package.json).
- **A running Docker runtime**, such as Docker Desktop or OrbStack, for local Supabase.

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm db:start    # start local Supabase; first start applies migrations and seed data
pnpm env:local   # generate this checkout's .env from the running stack
pnpm ports      # show this checkout's URLs
pnpm dev        # run the web app and API together
```

Open the web URL printed by `pnpm ports`. The main checkout uses `http://localhost:5173`; linked git
worktrees get their own ports and database. No hosted Supabase project, Render account, or ESPN API key
is needed for local development. The first Supabase start downloads its container images.

To run all tests, use another terminal after setup:

```sh
pnpm playwright:install  # one-time Chromium and WebKit installation
pnpm test:all           # unit, component, script, API, and E2E tests
```

### Environment variables

[`.env.example`](.env.example) documents the configuration. Prefer `pnpm env:local` over copying it:
the generated `.env` includes working local credentials and the correct ports for this checkout.
Running it again overwrites `.env`.

| Variable                   | Purpose                                                   | Main checkout / default                                           |
| -------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `PORT`                     | API listen port; also used by the dev proxy and E2E tests | `8787`                                                            |
| `WEB_PORT`                 | Vite dev server and E2E web port                          | `5173`                                                            |
| `DATABASE_URL`             | PostgreSQL connection string used by the API              | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` locally |
| `SUPABASE_URL`             | Supabase Auth project URL                                 | `http://127.0.0.1:54321` locally                                  |
| `SUPABASE_PUBLISHABLE_KEY` | Public Supabase publishable key, or legacy `anon` key     | Generated from the local stack                                    |
| `INBOX_URL`                | Local test inbox, read by the password-reset E2E tests    | `http://127.0.0.1:54324` locally; not used by the API             |

The web app fetches its public Auth configuration from `/api/config` at runtime, so its production build
needs no environment variables. Database credentials stay on the API server.

#### Simulating a different date and time (local only)

To test pick and POW locks or week phases without waiting for game day, start the API with
`CLOCK_OVERRIDE` set to an ISO 8601 time with an offset:

```sh
CLOCK_OVERRIDE=2026-09-13T12:30:00-04:00 pnpm dev
```

The API's clock starts at that moment and keeps running in real time. The web app picks up the same offset
from `/api/config` and shows a **Simulated time** banner under the header. Restart `pnpm dev` to change or
clear it. The API refuses to start with `CLOCK_OVERRIDE` when `NODE_ENV=production`, so it can't reach the
deployed service. Rows the database timestamps itself (such as message times) still use the real clock.

### Ports, worktrees, and stopping the stack

Run `pnpm ports` in each checkout to see its web, API, Supabase, Studio, test inbox, and PostgreSQL URLs.
The main checkout uses slot 0. Each linked worktree gets an isolated Supabase project and the next free
slot `n`: web port `5173 + n`, API port `8787 + n`, and Supabase ports based at `54320 + 10n`.
`PICKS_PORT_SLOT=<n>` can override allocation; use the same override for all commands in that checkout.

Always use `pnpm db:*` or `pnpm sb <args>` for Supabase commands. These wrappers select the checkout's
project and ports; invoking the Supabase CLI directly can target a different local stack. Start Supabase
and run `pnpm env:local` in every new worktree.

```sh
pnpm db:status  # inspect the local stack
pnpm db:stop    # stop Supabase, preserving local data
```

Stop `pnpm dev` with Ctrl+C. Accounts and data persist between runs. **`pnpm db:reset` wipes the local
database and reapplies migrations and seed data.** Before deleting a worktree, run
`pnpm sb stop --no-backup` inside it to remove its containers and database volume.

## Trying the app locally

### Test accounts

[`supabase/seed.sql`](supabase/seed.sql) creates four accounts. All use the password **`password123`**:

| Email               | Name    | Role in Sunday Crew |
| ------------------- | ------- | ------------------- |
| `admin@example.com` | Commish | Admin               |
| `pat@example.com`   | Pat     | Player              |
| `sam@example.com`   | Sam     | Player              |
| `alex@example.com`  | Alex    | Player              |

The **Sunday Crew** league has a 2026 season with **Weeks 6–9 already finalized**. Results, standings,
the week-by-week grid, and rank movement have history to explore. Week 9 uses the matchups and scores
recorded in the seed with made-up spreads; Weeks 6–8 use made-up eight-game slates. The fixtures include
pushes, weeks with no POW, and missed picks, including Alex missing all of Week 7. Later weeks are absent
so you can create them yourself. Each seeded account sees the Week 9 results recap the first time it
opens the league.

Local sign-up needs no email confirmation. You can create an account with a made-up email address and
a password of at least six characters. To join the seeded league, open `/join/local-invite` on your web
URL, sign in, and press **Join league**. In the main checkout, that URL is
`http://localhost:5173/join/local-invite`.

Use a normal browser window for the admin and a private window or different browser profile for a player.
Sessions are stored per browser profile, so both accounts can stay signed in side by side.

### Adding POW Pick'em to your home screen

In a browser, the account menu has **Add to home screen**. It opens instructions over the current
screen, keeping unsaved picks in place, and shows only the steps for the player's phone (iPhone/iPad
or Android; both on a computer). On a phone, the first time a player saves picks in that browser, the
same instructions open once on their own with a **Not now** button; they never reappear after that.
None of this shows when running from the home-screen app. To see the one-time prompt again locally,
remove `pow:home-screen-offered` from the site's local storage. Open the new icon after adding it;
you may need to sign in again. The app requires an internet connection.

### Feedback and app operator

Signed-in players can choose **Send feedback** from their account menu to report a bug, request a
feature, or send a note. Reports stay in the database; no email service is needed. Each player can send
up to five reports per rolling 24 hours. Reports include the sender, originating app path, and browser
user agent, without URL queries, fragments, or invite codes.

The **Operator** menu opens an app-wide dashboard with account and league growth, active players and
leagues, pick and message counts, eight weeks of activity, and the latest 25 accounts and leagues.
Its feedback inbox supports **Mark done**, **Reopen**, and loading older reports. Usage is derived from
stored picks and messages: it does not measure visits, sessions, or time spent. Private pick choices
and league message bodies are never included.

Operator access is separate from league admin access. On the **API service**, set `OPERATOR_USER_IDS`
to your Supabase Auth user UUID (or a comma-separated list). Find it under **Authentication → Users**
in your Supabase dashboard. Restart/redeploy the API, then reload the app. An empty or unset value
grants nobody access; players cannot grant themselves access through their profile or league role.
To revoke access, remove the UUID and restart/redeploy the API.

For local development, `pnpm env:local` makes the seeded `admin@example.com` account an operator.
This local setting is not applied to production. The feedback migration must be deployed before the
new API, using the normal migration and deployment workflow.

### Walking through a week

1. Sign in as `admin@example.com` and open **Sunday Crew**. The league has five tabs: **Picks**,
   **Results**, **Standings**, **Messages**, and **League**. The **Season** selector applies to every tab
   except Messages, which is league-wide.
2. Open **League**, select an unused week, and press **Create week**. To prepare another year, choose
   **Start a new season** in the season selector; the season is created with its first week. Existing
   weeks open with **Manage week**. With **Import games and spreads from ESPN** checked, creation
   fetches the slate from ESPN and opens the draft's management screen. Imports need internet access.
3. Review kickoffs, spreads, point values, and the tiebreaker game. Add or remove games as needed and
   press **Save changes** after edits. A draft is visible only to admins. Every game needs a spread
   before you can press **Open week for picks**. After the week opens, the app offers to post a league
   message announcing it; you can edit the draft or skip it.
4. Follow **Make your own picks**, or open **Picks**. Select teams, mark one POW, enter a guess for the
   tiebreaker game's combined score, and press **Save picks**. A partial sheet can be saved and completed
   later. **Stats, news & market** on a game opens its matchup sheet. Then try the player account. The
   admin's management screen shows submission counts and whether a POW was chosen; other players'
   choices remain private.
5. In **Manage week**, press **Pull results from ESPN** once games are final, or enter both scores for
   each game and press **Save changes**. Score boxes appear once a game kicks off; before that, press
   **Enter score** on the game to record a result early. Results imports update games originally imported from ESPN;
   manually added games need manually entered scores. Recording a result closes that game to picks
   immediately.
6. When every game has a score, press **Finalize week** and confirm. This reveals everyone's picks,
   names the weekly winner and any Low Point Loser, hands out the week's awards, and includes the week in
   standings. The app again offers to post a league message, with final results shown beside the draft
   for reference. Each other player sees a one-time results recap the next time they open the league.
   **Reopen week** lets you correct a score or spread. While reopened, other players' picks are hidden
   again and the week is
   excluded from standings until finalized again; the corrected week is then recapped again.
7. Open **Messages** to start a thread or reply. A dot on the tab and an **Unread** label mark threads
   with posts you haven't opened. Tap the smiley under a message or reply to add 👍, 😂, 🔥, 🎉, 😮, 🙏 or 🏈; tap a reaction shown on the message to join it, or tap yours again to remove it. Use **Quote reply** to include a message with your reply, or **Remove quote** to drop it while keeping your draft. The reply box stays at the bottom of the thread, and new replies appear on their own. Admins can open a thread's **⋯** menu and choose **Pin announcement** to keep it at the top of the board.

### Sharing league administration

Any admin can open **League → Members**, tap **⋯** beside a current player, and choose **Make admin**.
All admins have equal access to weeks, games, scores, settings, invites, and membership management.
Admins can revoke each other's admin access or remove each other, including the league creator.
**Revoke admin** keeps that person in the league as a player with their picks and results. Admins can
also step down themselves, provided at least one active admin remains.

### Leaving, removal, and limits

Any member can use **League → Leave league**; an admin can remove another member from the **⋯** menu
beside their name. Either way the
person loses access, weeks they already played keep their results, and they can rejoin through an invite
link. A league's only admin must make someone else an admin before leaving. **Make a new link** (beside **Copy link**, and
**Share** on phones) replaces the invite link, so links already shared stop working. A league holds at most 100 players, and one
account can be in at most 25 leagues; removed and departed members don't count toward either limit.

### Accounts and passwords

**Forgot password?** on the sign-in form emails a link that signs the player in and asks for a new
password. Locally, that email arrives in the test inbox listed by `pnpm ports`. A signed-in player can
use **Change password** or **Change your name** from the account menu in the header.

### Testing locks and inspecting data

Locks use the real clock unless `CLOCK_OVERRIDE` is set locally (see
[Simulating a different date and time](#simulating-a-different-date-and-time-local-only)). An imported
historical week may already be locked. To exercise different states, add games manually in a draft and
open the week:

| Game timing                                 | What to expect                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Kickoff a few days away                     | Picks and POW can be saved and changed                                 |
| Today, before kickoff                       | Picks and POW can still be changed                                     |
| Kickoff in the past, or both scores entered | No new picks or changes; a POW on that game cannot be moved or removed |

Use the **Supabase Studio** URL from `pnpm ports` to inspect accounts under Authentication and tables
under Table Editor. The main checkout's Studio URL is `http://127.0.0.1:54323`. The test inbox URL shows
emails sent by the local Auth service.

## League rules

The app's `/how-to-play` page explains the player and admin flows.
[`packages/shared/src/rules.ts`](packages/shared/src/rules.ts) is the implementation of scoring and locks,
and [`packages/shared/src/awards.ts`](packages/shared/src/awards.ts) of the weekly awards.

### Messages

Active league members can react to any message or reply, once per emoji per player. Counts and your
own selections are visible to members. Reactions do not bump threads or create unread indicators.
Only admins can pin or unpin threads as announcements; pinned threads appear first without changing
unread status. Quoted replies can reference only messages in the same thread and show the original
author and text with a link back. You can remove a quote before posting without losing your reply.

### Scoring

Pick the team that will cover the displayed spread. Spreads are stored as the home team's line: `-3.5`
means the home team is favored by 3.5 points. A winning pick earns the game's points. Losing and missing
picks earn zero; a push earns zero and counts as neither a win nor a loss.

Spreads stay fixed after opening unless an admin edits them manually. Pulling results and finalizing
never replace them with new provider lines; scoring uses the spreads currently saved in the app.

Default point values use **Eastern time**, with holidays taking priority. Admins can override each game's value.

| Game slot                               | Points |
| --------------------------------------- | ------ |
| Sunday daytime                          | 1      |
| Sunday night, 7pm ET or later           | 2      |
| Thursday or Monday                      | 3      |
| Tuesday, Wednesday, Friday, or Saturday | 2      |
| Thanksgiving or Christmas Day           | 4      |

A winning **Pick of the Week** earns **5 bonus points** in addition to the game's value. A losing or
pushed POW earns no bonus. There is no automatic POW: a player who doesn't choose one has none that
week. The POW can go on any game that hasn't kicked off, and can be moved or removed until the game
holding it kicks off. After that it stays on that game for the week.

### Deadlines and rankings

- **Before kickoff**, a game's pick can be added or changed, and the POW can be put on it, moved off it,
  or removed.
- **At kickoff**, the game locks: no new picks or changes are accepted, and it can no longer become the
  POW. A POW already on it cannot be moved or removed. A recorded result locks the game regardless of
  the clock.
- **The tiebreaker guess** follows its game's lock: it can be entered or changed until kickoff. A saved
  guess cannot be removed.
- **The tiebreaker game** is the admin's explicit choice, otherwise the last Monday game, otherwise the
  last game on the slate.
- **Weekly ranking:** most points, then most games won, then the closest guess to the tiebreaker game's
  combined final score. At equal distance, the guess that did not go over wins. Remaining ties share the win.
- **Season ranking:** total points from finalized weeks, then POWs won, total wins, Monday wins, and
  Sunday night wins. Remaining ties share a rank.

### Awards and the Low Point Loser

Each finalized week names its winner and hands out these, all worked out from the final results:

| Award                 | Who gets it                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Low Point Loser (LPL) | Last place by the weekly ranking. Shared if still level; nobody if the whole league tied. |
| Perfect week          | Picked every game and won them all                                                        |
| Bullseye              | Guessed the tiebreaker game's combined score exactly                                      |
| Lone wolf             | The only player on the covering side of a game that at least three players picked         |

### Week lifecycle, privacy, and history

The stored week lifecycle is `draft → open → final`; only an admin finalizes a week. The interface derives
additional phases such as **Games underway** and **Awaiting finalization** from kickoffs and scores.
Picks stay private until finalization, including from admins. Removing a member, or a member leaving,
preserves their history; weekly participation uses membership dates rather than applying today's member
list to past weeks.

## Architecture and repository layout

This is a TypeScript pnpm workspace with a React SPA, a Hono API, and Supabase Auth + PostgreSQL.

```text
Browser ── /api/* ──> Hono API ── Drizzle ──> PostgreSQL
   │                     │
   ├── Supabase Auth     ├── verifies Supabase access tokens
   └── ESPN image CDN    ├── ESPN scoreboard (admin imports)
       (team logos)      └── ESPN game summary + Kalshi markets (matchup sheet)
```

Vite proxies `/api` to the API during development. In production, the Render static site proxies those
requests to the API service, keeping browser API requests on the same origin. The browser signs in through
Supabase Auth and sends its access token to the API as `Authorization: Bearer <access_token>`.
Application data goes through the API; app tables have row-level security enabled without client policies.

| Path                                     | Responsibility                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`apps/web`](apps/web)                   | React 19, Vite, Tailwind CSS v4, shadcn/ui, and a small History API router; pages fetch data and components render it   |
| [`apps/api`](apps/api)                   | Hono routes for profiles, leagues, invites, weeks, picks, results, and messages; Node server, ESPN and Kalshi providers |
| [`packages/shared`](packages/shared)     | Shared Zod schemas, types, scoring, locks, awards, season selection, and statistics                                     |
| [`packages/db`](packages/db)             | Drizzle schema, PostgreSQL client, TLS policy, migration generation, and schema documentation generator                 |
| [`supabase`](supabase)                   | Local service configuration, SQL migrations, migration metadata, and development seed                                   |
| [`e2e`](e2e)                             | Playwright full-stack tests for desktop Chromium and mobile WebKit                                                      |
| [`scripts`](scripts)                     | Worktree ports, Supabase wrappers, environment generation, connection diagnostics, app icons, and Render deployment     |
| [`.github/workflows`](.github/workflows) | CI checks and production deployment                                                                                     |
| [`docs/schema.md`](docs/schema.md)       | Generated ER diagram and table/column reference                                                                         |

Useful starting points are [`apps/api/src/app.ts`](apps/api/src/app.ts) for API composition,
[`apps/web/src/api.ts`](apps/web/src/api.ts) for the typed Hono client and Auth configuration, and
[`packages/db/src/schema.ts`](packages/db/src/schema.ts) for the database model. Request and response
contracts live in `packages/shared`. Keep Hono routes chained so the client retains their inferred types.

ESPN imports use a public, unofficial scoreboard feed with no API key. It may omit spreads or change shape;
the admin can enter games, spreads, and scores manually. Imports and score pulls are explicit admin actions.

The matchup sheet loads on demand from `GET /api/games/:gameId/insights`. Team form, injuries, leaders, and
news come from ESPN's game summary; win and cover prices come from Kalshi's public market API. Neither needs
a key, both are cached in memory, and either can fail on its own: the sheet shows whatever arrived. A game
added by hand has no ESPN stats. The sheet contains public background only, never this league's picks.
Team logos are loaded by the browser from ESPN's image CDN (`a.espncdn.com`).

The web app has a manifest and icons so it can be installed to a home screen. There is no service worker,
so nothing works offline.

## Development and testing

### Commands

Run workspace commands from the repository root:

| Command            | Purpose                                                                            |
| ------------------ | ---------------------------------------------------------------------------------- |
| `pnpm dev`         | Start web and API development servers                                              |
| `pnpm build`       | Build web assets to `apps/web/dist` and the API bundle to `apps/api/dist/index.js` |
| `pnpm lint`        | Check formatting and lint rules with Biome                                         |
| `pnpm format`      | Apply Biome formatting and fixes                                                   |
| `pnpm typecheck`   | Type-check workspace packages                                                      |
| `pnpm test`        | Run unit, API, component, and Node script tests                                    |
| `pnpm check`       | Run lint, type checking, and `pnpm test`                                           |
| `pnpm test:e2e`    | Run full-stack Playwright tests                                                    |
| `pnpm test:e2e:ui` | Open Playwright's interactive test runner                                          |
| `pnpm test:all`    | Run `pnpm test` followed by E2E tests                                              |
| `pnpm icons`       | Redraw the app icons in `apps/web/public` after changing `scripts/icons.mjs`       |

`pnpm check` does not include E2E tests or production builds. `pnpm test:all` does not include lint or
type checking. For a full local verification, run `pnpm check`, `pnpm test:e2e`, and `pnpm build` after
starting Supabase, generating `.env`, and installing the browsers.

### Test layers

| Layer                               | Tool and location                                                         | Requirements                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Rules, schemas, and statistics      | Vitest in `packages/shared/src/**/*.test.ts`                              | No running services                                                                 |
| Database tooling and safety scripts | Node test runner in `packages/db/scripts/` and `scripts/`                 | No running services                                                                 |
| API                                 | Vitest + `app.request()` in `apps/api/test/`                              | Database suites require local Supabase and `DATABASE_URL`; they skip if it is unset |
| Components and router               | Vitest browser mode + Playwright Chromium in `apps/web/src/**/*.test.tsx` | Installed Chromium; no running app or database                                      |
| End-to-end                          | Playwright in `e2e/tests/`                                                | Local Supabase, generated `.env`, Chromium, and WebKit                              |

E2E starts the API and web servers automatically, or reuses `pnpm dev` outside CI. It refuses remote
database and Auth services. Tests create their own data rather than depending on the seed. Traces and
screenshots are disabled to keep credentials and invite links out of artifacts.

For focused runs, use workspace filters such as `pnpm --filter @picks/shared test` or
`pnpm --filter @picks/api test`. Add tests at the lowest layer that catches a change; UI, route, Auth,
and schema changes also need E2E verification. Time-dependent rules accept a `now` argument so tests
can use fixed dates.

Pull request CI runs a Git history secret scan, lint, type checking, migration and schema documentation
drift checks, unit/component/script tests, a web build, and an API Docker build. A separate job starts
local Supabase, runs database-backed API tests, and runs E2E. Playwright reports are retained for three days.

## Database workflow

[`packages/db/src/schema.ts`](packages/db/src/schema.ts) is the database source of truth. Drizzle generates
SQL; the Supabase CLI applies it. [`docs/schema.md`](docs/schema.md) is generated from the schema and its
comments, and CI checks that it is current.

For a schema change:

1. Edit `packages/db/src/schema.ts`, including table and column descriptions.
2. Run `pnpm db:generate --name <short_description>` to generate SQL and refresh the schema reference.
3. Review the SQL, then run `pnpm db:reset` to rebuild the **local** database from migrations and seed.
   This deletes existing local data. Update `supabase/seed.sql` if the schema change requires it.
4. Run the relevant tests, including E2E for schema changes.
5. Commit the schema, SQL migration, `supabase/migrations/meta/`, and `docs/schema.md` together.

For triggers, functions, grants, or other SQL Drizzle cannot express, run
`pnpm db:migrate:custom --name <short_description>` and fill in the generated file. For documentation-only
schema comment changes, run `pnpm db:erd`. Edit descriptions in the schema rather than editing the
generated Markdown by hand.

Table and column renames can prompt interactively during generation; run the generator in a terminal
and select the intended rename. Never edit a migration already merged to `main`; add a new migration.
Production migrations run before the new app deploys, so they must remain compatible with the currently
running version. Use separate expand and contract changes when removing or replacing fields.

## Deployment

[`render.yaml`](render.yaml) defines two services:

| Service                    | Runtime            | Role                                                                                                          |
| -------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `football-weekly-picks-ui` | Render static site | Serves `apps/web/dist`, caches hashed assets, proxies `/api/*`, and falls back to `index.html` for SPA routes |
| `football-weekly-picks`    | Docker web service | Runs the bundled API and checks readiness at `/api/health`                                                    |

The API image uses a non-root user and ships the esbuild bundle and source map without `node_modules`.
Dependencies that need native modules or runtime files require corresponding Dockerfile changes.
The Blueprint selects the free API plan; a sleeping instance can delay API requests while the static
site continues to load.

### Initial configuration

1. Create the two services from the repository's Render Blueprint. Automatic Render deploys are disabled
   so GitHub Actions controls deployment order.
2. Set the API service's `DATABASE_URL` to the Supabase **session pooler** connection string, plus
   `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. The Blueprint sets `PORT=10000`.
3. Configure Supabase Auth's Site URL and redirect URLs for the public web URL, including the custom
   domain if used. The redirect URLs must cover `/reset-password` (password reset emails) and the pages
   people sign up from, such as `/join/<code>` (the confirmation email returns them there). Check that the
   static site's `/api/*` rewrite points at your API service; its `onrender.com` destination is explicit
   in `render.yaml`.
4. Add these GitHub Actions secrets to the **`production` environment**:

   | Secret                  | Purpose                                                                                    |
   | ----------------------- | ------------------------------------------------------------------------------------------ |
   | `SUPABASE_DB_URL`       | Supabase session pooler URL for migrations; used for IPv4 connectivity from GitHub runners |
   | `RENDER_API_KEY`        | Authorizes the Render deployment script                                                    |
   | `RENDER_SERVICE_ID`     | API service ID                                                                             |
   | `RENDER_STATIC_SITE_ID` | Static site ID                                                                             |

5. Verify the database TLS configuration described below before deploying.

### Release sequence

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on pushes to `main` and manual dispatch:

```text
CI → verified database connection → migrations → API deploy → static site deploy
```

Each Render deployment builds the selected commit and must become live before the next step runs.
The API health endpoint checks database connectivity and returns HTTP 503 if that check fails. Keep API
changes compatible with the web build still serving during deployment, and migrations compatible with
the old API. Local seed data is not applied in production.

The API listens on `PORT` and can run on another container host. The web build can run on another static
host with an `/api/*` proxy and SPA fallback; Render-specific setup lives in the Blueprint and deploy script.

## Credentials and diagnostics

Remote database connections require TLS with certificate and hostname verification. The API and the
connection-check script share this policy in [`packages/db/src/connection.ts`](packages/db/src/connection.ts).
Supabase database hosts use the bundled public Supabase CA certificate. Loopback connections support the
local stack without TLS; URL parameters cannot disable TLS for a remote connection. Startup and health
checks also verify that the database connection behind a pooler is encrypted.

When rolling out this TLS policy to an existing Supabase project, coordinate enabling **Enforce SSL on
incoming connections** in Supabase Database Settings with the API deployment. That setting restarts the
database and can interrupt older builds that do not request TLS. The migration connection check blocks
deployment until the pooler-to-database connection is encrypted; application code alone does not enable
that setting.

Use a publishable key or legacy `anon` key for `SUPABASE_PUBLISHABLE_KEY`. Privileged keys are rejected
before API startup because `/api/config` exposes the public key to browsers. Environment files are ignored
except for `.env.example`. `pnpm env:local` intentionally writes local credentials to `.env`; keep it private.

API logs include route templates, request IDs, fixed explanations for known failures, vetted error codes,
and safe source locations. They omit raw URLs, request data, SQL parameters, arbitrary exception messages,
and nested errors. Use a response's **`X-Request-ID`** to correlate a failure with its log entry. CLI wrappers
redact credentials before printing output. Hosting access logs are separate; avoid raw request-URL logging
for invite links.

[`scripts/check-db-url.mjs`](scripts/check-db-url.mjs) checks a database connection without printing its
password. On macOS, pass a copied connection string through stdin:

```sh
pbpaste | node scripts/check-db-url.mjs
```

## Troubleshooting

| Symptom                                                 | What to check                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Supabase will not start                                 | Start Docker Desktop or OrbStack, then retry `pnpm db:start`. Inspect the stack with `pnpm db:status`.              |
| API reports invalid configuration, or `.env` is missing | Run `pnpm db:start`, then `pnpm env:local`, and restart `pnpm dev`. Use `.env.example` to check variable names.     |
| The app or tests use the wrong checkout                 | Compare `.env` with `pnpm ports`, regenerate it with `pnpm env:local`, and use `pnpm sb` for CLI commands.          |
| Vite reports a port already in use                      | Stop the process using this checkout's web port. Vite deliberately fails instead of choosing another port.          |
| Playwright cannot find a browser                        | Run `pnpm playwright:install`. Component tests need Chromium; E2E also needs WebKit.                                |
| API database tests skip                                 | Start the local stack and generate `.env` so `DATABASE_URL` is available.                                           |
| E2E rejects the environment                             | It requires loopback database and Auth URLs. Regenerate `.env` from local Supabase.                                 |
| Seeded accounts or weeks are missing                    | For a disposable local database, `pnpm db:reset` reapplies migrations and seed, deleting existing local data.       |
| A new week has no import or a missing spread            | ESPN may have no schedule or odds for that week. Retry the import while still in draft, or add/edit games manually. |
| Picks are locked in an imported week                    | Locks follow actual kickoffs. Use manually added future games to test picking.                                      |
| Finalize week is unavailable                            | Every game needs both final scores. Enter scores for manually added games; ESPN results only update imported games. |
| The matchup sheet is empty or missing a section         | ESPN or Kalshi had nothing for the game or didn't answer. Manually added games have no ESPN stats.                  |
| A password reset email never arrives locally            | Local Auth doesn't send real email. Open the test inbox URL from `pnpm ports`.                                      |
| Production health or migration connection check fails   | Check the session pooler URL, verified TLS, and Supabase SSL enforcement. Use the connection diagnostic above.      |

See [`AGENTS.md`](AGENTS.md) for additional contributor guidance on UI conventions, API structure, and
repository tooling.
