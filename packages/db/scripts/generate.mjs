// `pnpm db:generate [--name <desc>]`: writes the SQL migration for a schema change, then refreshes the
// schema diagram (docs/schema.md) so the two always land in the same commit.
import { spawn } from "node:child_process";
import { stripVTControlCharacters } from "node:util";

const child = spawn("drizzle-kit", ["generate", ...process.argv.slice(2)], {
  stdio: ["inherit", "pipe", "inherit"],
  shell: process.platform === "win32",
});
let output = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  output += chunk;
  process.stdout.write(chunk);
});
const status = await new Promise((resolve) => {
  child.on("error", (error) => {
    console.error(error);
    resolve(1);
  });
  child.on("close", (code) => resolve(code ?? 1));
});
if (status !== 0) process.exit(status);

// Drizzle catches some generation errors and exits zero. Require its completion message too,
// so a failed diff (including an unanswered rename prompt) cannot silently pass CI.
const completed = /No schema changes, nothing to migrate|Your SQL migration file ➜/.test(
  stripVTControlCharacters(output),
);
if (!completed) {
  console.error("Drizzle did not finish generating migrations; schema documentation was not refreshed.");
  process.exit(1);
}
await import("./erd.mjs");
