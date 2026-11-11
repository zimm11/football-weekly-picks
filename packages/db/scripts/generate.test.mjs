import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function fixture(t, schema) {
  const dir = mkdtempSync(path.join(tmpdir(), "picks-generate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, "generate.mjs");
  const config = path.join(dir, "drizzle.config.ts");
  const marker = path.join(dir, "diagram-refreshed");
  copyFileSync(new URL("./generate.mjs", import.meta.url), script);
  writeFileSync(
    path.join(dir, "erd.mjs"),
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'refreshed');`,
  );
  writeFileSync(
    config,
    `export default ${JSON.stringify({ dialect: "postgresql", schema, out: "./migrations" })};`,
  );
  return {
    dir,
    marker,
    run: (...args) =>
      spawnSync(process.execPath, [script, "--config", config, ...args], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      }),
  };
}

test("refreshes the diagram after creating a migration and after a successful no-op", (t) => {
  const schema = fileURLToPath(new URL("../src/schema.ts", import.meta.url));
  const f = fixture(t, schema);
  let result = f.run("--name", "fixture");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Your SQL migration file/);
  assert.ok(existsSync(f.marker));
  const journal = JSON.parse(readFileSync(path.join(f.dir, "migrations/meta/_journal.json"), "utf8"));
  assert.equal(journal.entries.length, 1);

  rmSync(f.marker);
  result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /No schema changes, nothing to migrate/);
  assert.ok(existsSync(f.marker));
});

test("fails when Drizzle logs a schema error but exits zero, without refreshing the diagram", (t) => {
  const f = fixture(t, "unused");
  const schema = path.join(f.dir, "broken-schema.ts");
  writeFileSync(schema, 'throw new Error("schema import failed for regression test");');
  writeFileSync(
    path.join(f.dir, "drizzle.config.ts"),
    `export default ${JSON.stringify({ dialect: "postgresql", schema, out: "./migrations" })};`,
  );
  const failure = f.run();
  assert.equal(failure.status, 1, failure.stdout + failure.stderr);
  assert.match(failure.stderr, /schema import failed for regression test/);
  assert.match(failure.stderr, /Drizzle did not finish generating migrations/);
  assert.equal(existsSync(f.marker), false);
});

test("propagates a nonzero CLI exit without refreshing the diagram", (t) => {
  const f = fixture(t, "unused");
  const result = f.run("--invalid-option-for-test");
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(f.marker), false);
});
