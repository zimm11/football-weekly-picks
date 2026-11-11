// `pnpm db:generate [--name <desc>]`: writes the SQL migration for a schema change, then refreshes the
// schema diagram (docs/schema.md) so the two always land in the same commit.
import { runCli } from "./cli.mjs";

const { status, stdout: output } = await runCli("drizzle-kit", ["generate", ...process.argv.slice(2)]);
if (status !== 0) process.exit(status);

// Drizzle catches some generation errors and exits zero. Require its completion message too,
// so a failed diff (including an unanswered rename prompt) cannot silently pass CI.
const completed = /No schema changes, nothing to migrate|Your SQL migration file ➜/.test(output);
if (!completed) {
  console.error("Drizzle did not finish generating migrations; schema documentation was not refreshed.");
  process.exit(1);
}
await import("./erd.mjs");
