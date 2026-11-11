import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assertLocalTestEnv } from "../e2e/local-env.ts";
import { selectCiSlot } from "./ci-ports.mjs";

function run(t, script, preload, env = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "picks-security-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hook = path.join(dir, "hook.mjs");
  writeFileSync(hook, preload);
  return spawnSync(process.execPath, ["--import", hook, new URL(script, import.meta.url).pathname], {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, RENDER_API_KEY: "not-a-real-key", RENDER_SERVICE_ID: "srv-test", ...env },
  });
}

test("Render API failures and malformed responses never echo response bodies or raw errors", (t) => {
  for (const response of [
    "new Response(process.env.RENDER_API_KEY, {status:403})",
    "new Response(process.env.RENDER_API_KEY, {status:200})",
  ]) {
    const result = run(t, "./render-deploy.mjs", `globalThis.fetch = async () => ${response};`);
    assert.equal(result.status, 1);
    assert.ok(!`${result.stdout}${result.stderr}`.includes("not-a-real-key"));
    assert.match(result.stderr, /Render/);
  }
});

test("a successful Render deployment retains status diagnostics without printing response fields", (t) => {
  const preload = `let count=0; globalThis.fetch=async (_,init)=>{
    if(init.redirect!=='error') throw new Error(process.env.RENDER_API_KEY);
    return Response.json(count++ ? {status:'live', token:process.env.RENDER_API_KEY} : {id:'dep-test'});
  };`;
  const result = run(t, "./render-deploy.mjs", preload);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Deploy is live/);
  assert.ok(!result.stdout.includes("not-a-real-key"));
});

test("database diagnostic drops credential-bearing driver errors", (t) => {
  const mock = `export default function(){return Object.assign(async()=>{throw new Error(process.env.AUDIT_PASSWORD)},{end:async()=>{}})}`;
  const preload = `import {registerHooks} from 'node:module'; registerHooks({resolve(specifier,context,next){
    if(specifier.endsWith('/postgres/src/index.js')) return {url:${JSON.stringify(`data:text/javascript,${encodeURIComponent(mock)}`)},shortCircuit:true};
    return next(specifier,context);
  }});`;
  const result = run(t, "./check-db-url.mjs", preload, {
    DB_URL: "postgresql://u:synthetic-password@db.example.com/db",
    AUDIT_PASSWORD: "synthetic-password",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /verified TLS/);
  assert.match(result.stderr, /Database check failed/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes("synthetic-password"));
});

test("CI selects a different port group when the default database port is occupied", async () => {
  const checked = [];
  const slot = await selectCiSlot(async (port) => {
    checked.push(port);
    return port !== 54322;
  });
  assert.equal(slot, 1);
  assert.ok(checked.includes(54332));
});

test("E2E refuses remote databases and auth services before tests or captures can run", () => {
  const local = { DATABASE_URL: "postgresql://u:p@127.0.0.1/db", SUPABASE_URL: "http://localhost:54321" };
  assert.doesNotThrow(() => assertLocalTestEnv(local));
  for (const [name, value] of [
    ["DATABASE_URL", "postgresql://u:synthetic-password@db.example.com/db"],
    ["DATABASE_URL", "postgresql://u:synthetic-password@localhost/db?host=remote"],
    ["SUPABASE_URL", "https://project.supabase.co"],
  ]) {
    assert.throws(
      () => assertLocalTestEnv({ ...local, [name]: value }),
      (error) =>
        String(error).includes("E2E requires a local") && !String(error).includes("synthetic-password"),
    );
  }
});
