#!/usr/bin/env node
// Builds the Vercel deployment output (.vercel/output) locally, without a Vercel account:
// the static web app plus the API function. The deploy workflow runs `vercel pull` first to get the real
// project settings; anywhere else this writes placeholder settings so the build can still be checked.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const projectFile = path.join(root, ".vercel", "project.json");
if (!fs.existsSync(projectFile)) {
  fs.mkdirSync(path.dirname(projectFile), { recursive: true });
  fs.writeFileSync(projectFile, JSON.stringify({ projectId: "local", orgId: "local", settings: {} }));
}
const result = spawnSync("pnpm", ["exec", "vercel", "build", "--yes", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
