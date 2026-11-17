#!/usr/bin/env node
// Runs the production build locally the way Cloudflare runs it: the Expo web build served as static assets and
// the API in the Workers runtime (`wrangler dev`), against this checkout's local Supabase. Use it to check
// Worker-only behavior before deploying; day-to-day development stays on `pnpm dev`. E2E tests run against it.
//
//   pnpm worker:dev   → http://localhost:<PORT + 1000> (override with WORKER_PORT)
//
// Email goes to the local test inbox, as with `pnpm dev`, not through Cloudflare. The Cron Trigger doesn't fire
// on its own; run the email job with `curl "http://localhost:<port>/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"`.
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
const vars = [
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "OPERATOR_USER_IDS",
  "UNSUBSCRIBE_SECRET",
  "INBOX_URL",
  "EMAIL_FROM",
  "EMAIL_DAILY_LIMIT",
  "EMAIL_MONTHLY_LIMIT",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
]
  .filter((key) => process.env[key] !== undefined)
  .map((key) => `${key}=${JSON.stringify(process.env[key])}`);
writeFileSync(envFile, `${vars.join("\n")}\n`, { mode: 0o600 });
const cleanUp = () => rmSync(dir, { recursive: true, force: true });

// EXPO_WEB_OUT names another build folder, so parallel runs (one per agent or worktree task) don't collide.
// The default folder is the one wrangler.jsonc already points at, so `--assets` is only passed for another.
const assets = process.env.EXPO_WEB_OUT ? path.resolve(ROOT, process.env.EXPO_WEB_OUT) : undefined;
try {
  // The page calls its own origin, so a phone's API address must not be built in.
  const { EXPO_PUBLIC_API_URL: _, ...env } = process.env;
  const out = assets ?? path.join(ROOT, "apps/mobile/dist-web");
  execFileSync(
    "pnpm",
    ["--filter", "@picks/mobile", "exec", "expo", "export", "--platform", "web", "--output-dir", out],
    { cwd: ROOT, stdio: "inherit", env },
  );
} catch {
  cleanUp();
  process.exit(1);
}

const wrangler = spawn(
  "pnpm",
  [
    ...["exec", "wrangler", "dev", "--env-file", envFile, "--port", port],
    ...(assets ? ["--assets", assets] : []),
    // Its own local state, so two Workers on different ports can run side by side.
    ...["--persist-to", path.join(dir, "state")],
    // Local Postgres has no TLS, so the Worker mustn't insist on it (see src/worker.ts).
    ...["--var", "NODE_ENV:development", "--show-interactive-dev-session=false"],
    // Links in emails point at this server, which serves the web app too.
    ...["--var", `APP_URL:http://localhost:${port}`, "--test-scheduled"],
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
