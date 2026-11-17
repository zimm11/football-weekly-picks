#!/usr/bin/env node
// Prints app env vars for this worktree's running local Supabase stack, in dotenv format.
//   pnpm env:local          → writes .env
//   CI: node scripts/supabase-env.mjs >> "$GITHUB_ENV"
import { execFileSync } from "node:child_process";
import path from "node:path";
import { getPorts, supabaseCliEnv } from "./ports.mjs";

const ports = getPorts();
let status;
try {
  const raw = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...supabaseCliEnv(ports) },
  });
  status = JSON.parse(raw.slice(raw.indexOf("{")));
} catch {
  console.error("Could not read local Supabase status. Start the local stack first.");
  process.exit(1);
}
// Commands go to stderr: stdout is redirected to GITHUB_ENV (or .env locally).
if (process.env.GITHUB_ACTIONS === "true") {
  for (const value of Object.values(status)) {
    if (typeof value !== "string" || !value || value.includes("\n")) continue;
    process.stderr.write(`::add-mask::${value.replaceAll("%", "%25").replaceAll("\r", "%0D")}\n`);
  }
}
const get = (...keys) => {
  for (const k of keys) {
    const hit = Object.entries(status).find(([name]) => name.toUpperCase() === k);
    if (hit) return hit[1];
  }
  throw new Error(`None of ${keys.join(", ")} found in \`supabase status\` output. Is the stack running?`);
};

const env = {
  PORT: String(ports.api),
  DATABASE_URL: get("DB_URL"),
  SUPABASE_URL: get("API_URL"),
  SUPABASE_PUBLISHABLE_KEY: get("PUBLISHABLE_KEY", "ANON_KEY"),
  // The local stack's secret (service-role) key, for the one Auth admin call account deletion makes.
  SUPABASE_SECRET_KEY: get("SECRET_KEY", "SERVICE_ROLE_KEY"),
  // The seeded admin@example.com runs the local app, so the operator screen can be opened and tested.
  OPERATOR_USER_IDS: "11111111-1111-4111-8111-000000000001",
  // The local stack's test inbox (Mailpit), where E2E tests read auth emails such as password resets.
  INBOX_URL: `http://127.0.0.1:${ports.supabase.mail}`,
  // Notification email goes to the same test inbox (INBOX_URL). These secrets are for the local stack only.
  // Links in it open the Expo web preview of `pnpm dev`; `pnpm worker:dev` points them at the Worker instead.
  APP_URL: `http://localhost:${ports.metro}`,
  UNSUBSCRIBE_SECRET: "local-only-unsubscribe-secret-not-for-production",
  // The test inbox has no quota, so local runs (and repeated E2E) shouldn't stop at production's budget.
  EMAIL_DAILY_LIMIT: "10000",
  EMAIL_MONTHLY_LIMIT: "100000",
};
process.stdout.write(
  `${Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`,
);
