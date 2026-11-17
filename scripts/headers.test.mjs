import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The website is apps/mobile's Expo web build, and its `public/_headers` is what Cloudflare Static Assets sends.
// `html` is the page template, `hashed` the folders whose file names carry a content hash.
const clients = [{ app: "apps/mobile", html: "public/index.html", hashed: ["/_expo/static/*", "/assets/*"] }];

const read = (app, path) => readFileSync(new URL(`../${app}/${path}`, import.meta.url), "utf8");

/** `_headers` as { path: { header: value } }. */
function rules(app) {
  const result = {};
  let path;
  for (const line of read(app, "public/_headers").split("\n")) {
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

for (const { app, html, hashed } of clients) {
  test(`${app}: every page and asset gets the security headers, and caching rules stay`, () => {
    const headers = rules(app);
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
    for (const path of hashed)
      assert.equal(headers[path]?.["Cache-Control"], "public, max-age=31536000, immutable", path);
    assert.equal(headers["/push-sw.js"]["Cache-Control"], "no-cache");
  });

  test(`${app}: the page has no inline script or style for the policy to block`, () => {
    const page = read(app, html);
    assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)[^>]*>/);
    assert.doesNotMatch(page, /\sstyle=/);
  });
}
