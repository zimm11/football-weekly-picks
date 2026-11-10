#!/usr/bin/env node
// Smoke-tests the built Vercel function (run `pnpm build:vercel` first) against the local Supabase stack:
// loads the exact file Vercel would run and checks health, a real sign-in, and a database round trip.
// This catches builds that pass but cannot start, such as an unresolvable import.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {}

const entry = path.join(root, ".vercel/output/functions/api/index.func/api/index.js");
const { default: app } = await import(pathToFileURL(entry).href);

const call = async (pathname, init) => {
  const res = await app.fetch(new Request(`http://smoke.local${pathname}`, init));
  return { status: res.status, body: await res.json().catch(() => undefined) };
};

const health = await call("/api/health");
assert.deepEqual(health, { status: 200, body: { ok: true, db: "up" } }, "health check");

assert.equal((await call("/api/me")).status, 401, "requests without a token are rejected");

const email = `smoke-${Date.now()}@example.com`;
const signup = await fetch(`${process.env.SUPABASE_URL}/auth/v1/signup`, {
  method: "POST",
  headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "password123" }),
});
const { access_token: token } = await signup.json();
assert.ok(token, "sign-up against local Supabase returned an access token");
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

const me = await call("/api/me", { headers });
assert.equal(me.status, 200, "a real Supabase token is accepted");
assert.equal(me.body.email, email);

const created = await call("/api/examples", {
  method: "POST",
  headers,
  body: JSON.stringify({ title: "smoke" }),
});
assert.equal(created.status, 201, "insert through the built function");
const list = await call("/api/examples", { headers });
assert.deepEqual(
  list.body.map((item) => item.title),
  ["smoke"],
  "read back through the built function",
);

console.log("Vercel build smoke test passed: health, auth, and database round trip.");
process.exit(0);
