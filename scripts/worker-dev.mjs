#!/usr/bin/env node
// Runs the production build locally the way Cloudflare runs it: the web build served as static assets and the
// API in the Workers runtime (`wrangler dev`), against this checkout's local Supabase. Use it to check
// Worker-only behavior before deploying; day-to-day development stays on `pnpm dev`.
//
//   pnpm worker:dev   → http://localhost:<PORT + 1000> (override with WORKER_PORT)
//
// Reads the local stack's settings from .env (`pnpm db:start`, then `pnpm env:local`) or, in CI, from the
// environment. Hyperdrive isn't emulated locally: the Worker connects straight to the database at DATABASE_URL.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {}
if (!process.env.DATABASE_URL || !process.env.SUPABASE_URL) {
  console.error("No local Supabase settings. Run `pnpm db:start` and then `pnpm env:local` first.");
  process.exit(1);
}
const port = process.env.WORKER_PORT ?? String(Number(process.env.PORT ?? 8787) + 1000);

// The Worker gets only the settings it reads (as in production), through a private temporary file.
const dir = mkdtempSync(path.join(tmpdir(), "picks-worker-"));
const envFile = path.join(dir, ".env");
const vars = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "OPERATOR_USER_IDS"]
  .filter((key) => process.env[key] !== undefined)
  .map((key) => `${key}=${JSON.stringify(process.env[key])}`);
writeFileSync(envFile, `${vars.join("\n")}\n`, { mode: 0o600 });
const cleanUp = () => rmSync(dir, { recursive: true, force: true });

try {
  execFileSync("pnpm", ["--filter", "@picks/web", "build"], { cwd: ROOT, stdio: "inherit" });
} catch {
  cleanUp();
  process.exit(1);
}

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
wrangler.on("exit", (code) => {
  cleanUp();
  process.exit(code ?? 0);
});
