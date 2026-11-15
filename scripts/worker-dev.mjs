#!/usr/bin/env node
// Runs the production build locally the way Cloudflare runs it: the web build served as static assets and the
// API in the Workers runtime (`wrangler dev`), against this checkout's local Supabase. Use it to check
// Worker-only behavior before deploying; day-to-day development stays on `pnpm dev`.
//
//   pnpm worker:dev   → http://localhost:<PORT + 1000> (override with WORKER_PORT)
//
// Needs `pnpm db:start` and `pnpm env:local`. Hyperdrive isn't emulated locally: the Worker connects straight to
// the local database named by DATABASE_URL.
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const envFile = path.join(ROOT, ".env");
try {
  process.loadEnvFile(envFile);
} catch {
  console.error("No .env found. Run `pnpm db:start` and then `pnpm env:local` first.");
  process.exit(1);
}
const port = process.env.WORKER_PORT ?? String(Number(process.env.PORT ?? 8787) + 1000);

execFileSync("pnpm", ["--filter", "@picks/web", "build"], { cwd: ROOT, stdio: "inherit" });

const wrangler = spawn(
  "pnpm",
  [
    ...["exec", "wrangler", "dev", "--env-file", envFile, "--port", port],
    // Local Postgres has no TLS, so the Worker mustn't insist on it (see src/worker.ts).
    ...["--var", "NODE_ENV:development", "--show-interactive-dev-session=false"],
  ],
  {
    cwd: path.join(ROOT, "apps/api"),
    stdio: "inherit",
    env: {
      ...process.env,
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: process.env.DATABASE_URL,
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => wrangler.kill(signal));
wrangler.on("exit", (code) => process.exit(code ?? 0));
