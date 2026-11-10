# Football Weekly Picks

## Local setup

Requires Node 26, pnpm, and a Docker runtime (Docker Desktop or OrbStack).

```sh
pnpm install
pnpm db:start            # local Supabase: Postgres, Auth, Studio (applies migrations + seed)
pnpm env:local           # write .env from the running stack
pnpm playwright:install  # browsers for component + E2E tests (one-time)
pnpm dev                 # http://localhost:5173 in the main checkout; `pnpm ports` shows the URLs
pnpm test:all            # unit, component, API and E2E tests
```

Each git worktree gets its own ports and database, so several can run at once.

See `CLAUDE.md` for commands, database workflow, and deployment.
