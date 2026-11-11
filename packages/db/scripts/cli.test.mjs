import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { redact } from "./cli.mjs";

test("redacts raw and transformed secrets, database passwords, generated local keys and JWTs", () => {
  const key = "synthetic-key-with-symbols/+";
  const password = "synthetic-password/@";
  const jwt = ["eyJhbGciOiJIUzI1NiJ9", "c3ludGhldGlj", "c2lnbmF0dXJl"].join(".");
  const localKey = ["sb", "secret", "local-test-key"].join("_");
  const url = `postgresql://u:${encodeURIComponent(password)}@localhost/db`;
  const values = [
    key,
    encodeURIComponent(key),
    Buffer.from(key).toString("base64"),
    password,
    encodeURIComponent(password),
    url,
    jwt,
    localKey,
  ];
  const output = redact(values.join("\n"), { RENDER_API_KEY: key, DATABASE_URL: url });
  for (const value of values) assert.ok(!output.includes(value));
  assert.match(output, /REDACTED/);
});

test("subprocess redaction buffers split credentials on both streams, flushes final output, and preserves failure", () => {
  const secret = ["sb", "secret", "split-local-test-key"].join("_");
  const child = `process.stdout.write(${JSON.stringify(secret.slice(0, 9))}); process.stderr.write(${JSON.stringify(secret.slice(0, 9))}); setTimeout(() => { process.stdout.write(${JSON.stringify(secret.slice(9))}); process.stderr.write(${JSON.stringify(secret.slice(9))}); process.exitCode=7; }, 10);`;
  const source = `import { runCli } from ${JSON.stringify(new URL("./cli.mjs", import.meta.url).href)}; const r = await runCli(process.execPath, ['-e', ${JSON.stringify(child)}]); process.exitCode=r.status;`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8" });
  assert.equal(result.status, 7);
  assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret));
  assert.match(result.stdout, /REDACTED/);
  assert.match(result.stderr, /REDACTED/);
});
