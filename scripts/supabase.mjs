#!/usr/bin/env node
// Runs the Supabase CLI with this worktree's project name and ports (see ports.mjs).
// Always go through this (`pnpm sb <args>` or the `pnpm db:*` scripts) rather than calling `supabase` directly,
// otherwise a worktree would talk to the default-port stack.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { supabaseCliEnv } from "./ports.mjs";

const root = path.resolve(import.meta.dirname, "..");
const result = spawnSync("pnpm", ["exec", "supabase", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ...supabaseCliEnv() },
});
process.exit(result.status ?? 1);
