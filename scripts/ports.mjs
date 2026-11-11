#!/usr/bin/env node
// Per-worktree port allocation, so several git worktrees can each run a full local stack at once.
//
// The main checkout (and CI, Docker, or any non-git copy) is slot 0 and uses the default ports.
// Each linked worktree gets the lowest free slot >= 1, recorded in a registry file inside the shared
// git directory. Entries for worktrees that no longer exist are pruned automatically.
// Override with PICKS_PORT_SLOT=<n>.
//
//   pnpm ports   → print this worktree's URLs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAX_SLOT = 99;

const git = (...args) => {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
};

function withLock(lockDir, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const stale = Date.now() - (fs.statSync(lockDir, { throwIfNoEntry: false })?.mtimeMs ?? 0) > 5000;
      if (stale || attempt > 100) fs.rmSync(lockDir, { recursive: true, force: true });
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

function resolveSlot() {
  const override = process.env.PICKS_PORT_SLOT;
  if (override !== undefined && override !== "") {
    const slot = Number(override);
    if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
      throw new Error(`PICKS_PORT_SLOT must be an integer from 0 to ${MAX_SLOT}, got "${override}"`);
    }
    return slot;
  }

  const gitDir = git("rev-parse", "--absolute-git-dir");
  const commonDir = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  if (!gitDir || !commonDir || gitDir === commonDir) return 0; // main checkout, or not a git repo

  const registryFile = path.join(commonDir, "picks-port-slots.json");
  return withLock(`${registryFile}.lock`, () => {
    let registry = {};
    try {
      registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    } catch {}
    for (const dir of Object.keys(registry)) {
      if (!fs.existsSync(dir)) delete registry[dir];
    }
    if (registry[ROOT] === undefined) {
      const taken = new Set(Object.values(registry));
      let slot = 1;
      while (taken.has(slot)) slot++;
      if (slot > MAX_SLOT)
        throw new Error(`No free port slot (max ${MAX_SLOT} worktrees). Remove unused worktrees.`);
      registry[ROOT] = slot;
    }
    fs.writeFileSync(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
    return registry[ROOT];
  });
}

export function getPorts(slot = resolveSlot()) {
  const sb = 54320 + slot * 10;
  return {
    slot,
    projectId: slot === 0 ? "football-weekly-picks" : `football-weekly-picks-${slot}`,
    api: 8787 + slot,
    web: 5173 + slot,
    supabase: {
      shadowDb: sb,
      api: sb + 1,
      db: sb + 2,
      studio: sb + 3,
      mail: sb + 4,
      analytics: sb + 7,
      pooler: sb + 9,
      inspector: 8083 + slot,
    },
  };
}

/** Environment variables that make the Supabase CLI use this worktree's project name and ports. */
export function supabaseCliEnv(ports = getPorts()) {
  return {
    SUPABASE_PROJECT_ID: ports.projectId,
    SUPABASE_API_PORT: String(ports.supabase.api),
    SUPABASE_DB_PORT: String(ports.supabase.db),
    SUPABASE_DB_SHADOW_PORT: String(ports.supabase.shadowDb),
    SUPABASE_DB_POOLER_PORT: String(ports.supabase.pooler),
    SUPABASE_STUDIO_PORT: String(ports.supabase.studio),
    SUPABASE_LOCAL_SMTP_PORT: String(ports.supabase.mail),
    SUPABASE_ANALYTICS_PORT: String(ports.supabase.analytics),
    SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT: String(ports.supabase.inspector),
    SUPABASE_AUTH_SITE_URL: `http://localhost:${ports.web}`,
  };
}

if (import.meta.main) {
  const p = getPorts();
  console.log(
    [
      `Port slot ${p.slot}${p.slot === 0 ? " (default ports)" : ""}, Supabase project "${p.projectId}"`,
      `  Web app          http://localhost:${p.web}`,
      `  API              http://localhost:${p.api}`,
      `  Supabase API     http://127.0.0.1:${p.supabase.api}`,
      `  Supabase Studio  http://127.0.0.1:${p.supabase.studio}`,
      `  Test inbox       http://127.0.0.1:${p.supabase.mail}`,
      `  Postgres         postgresql://postgres:postgres@127.0.0.1:${p.supabase.db}/postgres`,
    ].join("\n"),
  );
}
