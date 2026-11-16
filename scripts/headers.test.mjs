import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");

/** `_headers` as { path: { header: value } }. */
function rules() {
  const result = {};
  let path;
  for (const line of read("public/_headers").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!line.startsWith(" ")) {
      path = line.trim();
      result[path] = {};
    } else {
      const [name, ...value] = line.trim().split(":");
      result[path][name] = value.join(":").trim();
    }
  }
  return result;
}

test("every page and asset gets the security headers, and caching rules stay", () => {
  const headers = rules();
  const all = headers["/*"];
  assert.equal(all["Strict-Transport-Security"], "max-age=15552000");
  assert.equal(all["X-Content-Type-Options"], "nosniff");
  assert.equal(all["X-Frame-Options"], "DENY");
  assert.equal(all["Referrer-Policy"], "strict-origin-when-cross-origin");
  const csp = Object.fromEntries(
    all["Content-Security-Policy"].split(";").map((d) => {
      const [name, ...sources] = d.trim().split(/\s+/);
      return [name, sources];
    }),
  );
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.ok(csp["img-src"].includes("https://a.espncdn.com"), "team logos");
  assert.ok(csp["connect-src"].includes("https://*.supabase.co"), "Supabase Auth");
  assert.deepEqual(csp["worker-src"], ["'self'"]);
  assert.equal(headers["/assets/*"]["Cache-Control"], "public, max-age=31536000, immutable");
  assert.equal(headers["/push-sw.js"]["Cache-Control"], "no-cache");
});

test("the page has no inline script or style for the policy to block", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\sstyle=/);
});
