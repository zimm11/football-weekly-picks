#!/usr/bin/env node
// After a deploy: waits until the live API reports a healthy database, or fails the job. A new Worker version
// is live everywhere within seconds, but give it up to a minute. Prints status codes only, never bodies.
//
//   APP_URL=https://www.pow-pickem.com node scripts/check-live.mjs
const base = process.env.APP_URL;
if (!base) {
  console.log("::warning::APP_URL is not set, so the live API wasn't checked.");
  process.exit(0);
}
const url = new URL("/api/health", base);
let last = "no response";
for (let attempt = 1; attempt <= 12; attempt++) {
  try {
    const res = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.ok === true) {
      console.log(`Live API is healthy (attempt ${attempt}).`);
      process.exit(0);
    }
    last = `HTTP ${res.status}`;
  } catch {
    last = "request failed";
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
console.error(
  `Live API health check failed (${last}). Check Workers Logs, or roll back with \`wrangler rollback\`.`,
);
process.exit(1);
