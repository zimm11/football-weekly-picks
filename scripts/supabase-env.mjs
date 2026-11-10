#!/usr/bin/env node
// Prints app env vars for this worktree's running local Supabase stack, in dotenv format.
//   pnpm env:local          → writes .env
//   CI: node scripts/supabase-env.mjs >> "$GITHUB_ENV"
import { execFileSync } from "node:child_process";
import path from "node:path";
import { getPorts, supabaseCliEnv } from "./ports.mjs";

const ports = getPorts();
const raw = execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
  cwd: path.resolve(import.meta.dirname, ".."),
  encoding: "utf8",
  env: { ...process.env, ...supabaseCliEnv(ports) },
});
const status = JSON.parse(raw.slice(raw.indexOf("{")));
const get = (...keys) => {
  for (const k of keys) {
    const hit = Object.entries(status).find(([name]) => name.toUpperCase() === k);
    if (hit) return hit[1];
  }
  throw new Error(`None of ${keys.join(", ")} found in \`supabase status\` output. Is the stack running?`);
};

const env = {
  PORT: String(ports.api),
  WEB_PORT: String(ports.web),
  DATABASE_URL: get("DB_URL"),
  SUPABASE_URL: get("API_URL"),
  SUPABASE_PUBLISHABLE_KEY: get("PUBLISHABLE_KEY", "ANON_KEY"),
};
process.stdout.write(
  `${Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`,
);
