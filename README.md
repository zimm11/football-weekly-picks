# Football Weekly Picks

The code behind **POW Pick'em** ([www.pow-pickem.com](https://www.pow-pickem.com)), an NFL pick'em league app.

## Local setup

Requires Node 24+, pnpm, and a Docker runtime (Docker Desktop or OrbStack).

```sh
pnpm install
pnpm db:start            # local Supabase: Postgres, Auth, Studio (applies migrations + seed)
pnpm env:local           # write .env from the running stack
pnpm playwright:install  # browsers for component + E2E tests (one-time)
pnpm dev                 # http://localhost:5173 in the main checkout; `pnpm ports` shows the URLs
pnpm test:all            # unit, component, API and E2E tests
```

Each git worktree gets its own ports and database, so several can run at once. Run `pnpm ports` to see this
checkout's URLs; the examples below use the main checkout's defaults.

## Trying the app locally

### Test accounts

The local database comes seeded (`supabase/seed.sql`) with a league that has one finished week, so there is
something to look at straight away. All four accounts use the password `password123`:

| Email               | Name    | Role in "Sunday Crew" |
| ------------------- | ------- | --------------------- |
| `admin@example.com` | Commish | Admin                 |
| `pat@example.com`   | Pat     | Player                |
| `sam@example.com`   | Sam     | Player                |
| `alex@example.com`  | Alex    | Player                |

The league has the 2026 season with **Week 9 closed**: real matchups and scores, made-up spreads, and picks
from everyone, so the results grid and season standings are filled in. No later week exists; you create those
yourself (next section).

You don't have to use the seeded accounts. Local sign-up needs no email confirmation, so "Create account" with
any made-up address and a password of 6+ characters signs you straight in. To join the seeded league as a new
user, open http://localhost:5173/join/local-invite.

Accounts and data stay in the local database between runs. They are wiped only by `pnpm db:reset` (which
rebuilds the database and re-applies the seed) or by removing the stack with `pnpm sb stop --no-backup`.

### Walking through a week

1. Sign in as `admin@example.com` and open **Sunday Crew**.
2. Under **Admin → Set up a week**, pick the season and week and press **Create week**. With "Import games and
   spreads from ESPN" ticked, the week's games, kickoffs and spreads are pulled in (this needs internet access).
   You land on the week's **Manage** screen; the week starts as a draft that players can't see.
3. Adjust the draft if you want: change spreads or point values and press **Save changes**, remove a game, add
   one by hand, or choose a different tiebreaker game. Then press **Open week for picks**.
4. Make picks. The admin picks on the same screen as everyone else: follow **Make your own picks** (or the
   week's link on the league page). Saving returns you to the league page, which shows how many games you've
   picked. Then pick as a player (see "Signing in as two people" below). Each player sees only their own picks
   while the week is open; the Manage screen shows who has picked, not what.
5. To finish the week, go back to **Manage** (the link beside the week on the league page). Press **Pull
   results from ESPN** once games are final, or type scores into the game table and press **Save changes**.
   A game with a score is closed to picks straight away. When every game has a score, **Close week** reveals
   everyone's picks, names the winner and updates the standings. **Reopen week** undoes that if a score needs
   correcting.

### Signing in as two people

The session is stored per browser profile, so use one window for the admin and a private (incognito) window,
or a different browser, for a player. Both stay signed in side by side.

### Testing the pick locks

Locks follow the real clock, in the league's time zone: at 6am on game day, saved picks for that day's games
freeze and those games can no longer take the POW; at kickoff the game closes. An imported week shows whatever
is locked right now. To see a particular state, add a game by hand in the week's admin panel:

- kickoff a few days out: fully open (picks and POW can change);
- kickoff later today: a new pick is accepted, but it can't be the POW and can't be changed once saved;
- kickoff in the past, or any game with a score entered: closed.

### Looking at the data

Supabase Studio (http://127.0.0.1:54323, or the Studio URL from `pnpm ports`) shows accounts under
Authentication and the tables under Table Editor.

## Database schema

[`docs/schema.md`](docs/schema.md) has an ER diagram and a description of every table and column. It is
generated from `packages/db/src/schema.ts` whenever a migration is generated (`pnpm db:generate`), and CI
rejects a pull request where it has fallen behind, so it can be trusted to match the code.

See `CLAUDE.md` for commands, database workflow, the league's rules, and deployment.

## Credentials and diagnostics

Remote database connections require TLS with certificate and hostname verification. The API and deployment
connection check share this policy; Supabase database hosts use the bundled public Supabase CA certificate.
Loopback databases support the local Supabase stack without TLS. URL parameters cannot disable remote TLS.
Startup and health checks also verify the database leg behind a pooler and refuse an unencrypted backend.

For the first production rollout of this policy, coordinate enabling **Enforce SSL on incoming connections**
in Supabase Database Settings with the API deployment. The setting restarts the database and can interrupt
older API builds that do not request TLS. The migration connection check will block the deployment until
the pooler-to-database link is encrypted. Changing the application code alone does not enable that setting.

Use a Supabase publishable key (or a legacy `anon` key) for `SUPABASE_PUBLISHABLE_KEY`; privileged keys are
rejected before the API starts. Environment files are ignored except for `.env.example`.

API logs include route templates, request IDs, readable explanations for known failures, vetted error codes,
and safe source locations. They omit raw URLs, request data, SQL parameters, arbitrary exception messages,
and nested errors. Use the response's `X-Request-ID` to correlate a failure with its log entry. CLI output is
redacted before it is printed, including local Supabase keys. `pnpm env:local` intentionally writes the local
credentials to `.env`; do not share that file.

CI scans Git history with Gitleaks and chooses free ports before starting Supabase. E2E rejects remote
database/auth services, disables browser traces and screenshots, and retains its report for three days.
Hosting access logs are separate from API logs; avoid enabling raw request-URL logging for invite links.
