#!/usr/bin/env node
// Runs the Supabase CLI with this worktree's project name and ports (see ports.mjs).
// Always go through this (`pnpm sb <args>` or the `pnpm db:*` scripts) rather than calling `supabase` directly,
// otherwise a worktree would talk to the default-port stack.
import path from "node:path";
import { runCli } from "../packages/db/scripts/cli.mjs";
import { supabaseCliEnv } from "./ports.mjs";

const root = path.resolve(import.meta.dirname, "..");
const result = await runCli("pnpm", ["exec", "supabase", ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, ...supabaseCliEnv() },
});
process.exit(result.status ?? 1);
