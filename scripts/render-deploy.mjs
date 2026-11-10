#!/usr/bin/env node
// Triggers a Render deploy of one commit and waits until it is live. Exits non-zero if the deploy fails,
// so the GitHub Actions run reflects what actually happened on Render.
//
// Env: RENDER_API_KEY, RENDER_SERVICE_ID, and optionally COMMIT_SHA (defaults to the branch's latest commit),
// RENDER_API_URL, DEPLOY_TIMEOUT_MINUTES (default 20), POLL_SECONDS (default 10).
const { RENDER_API_KEY, RENDER_SERVICE_ID, COMMIT_SHA } = process.env;
const api = process.env.RENDER_API_URL ?? "https://api.render.com/v1";
const timeoutMs = Number(process.env.DEPLOY_TIMEOUT_MINUTES ?? 20) * 60_000;
const pollMs = Number(process.env.POLL_SECONDS ?? 10) * 1000;

if (!RENDER_API_KEY || !RENDER_SERVICE_ID) {
  console.error("RENDER_API_KEY and RENDER_SERVICE_ID must be set.");
  process.exit(1);
}

const FAILED = new Set(["build_failed", "update_failed", "pre_deploy_failed", "canceled", "deactivated"]);
const deploysUrl = `${api}/services/${RENDER_SERVICE_ID}/deploys`;

async function request(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${RENDER_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${init.method ?? "GET"} ${url} returned ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : undefined;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let deploy = await request(deploysUrl, {
  method: "POST",
  body: JSON.stringify(COMMIT_SHA ? { commitId: COMMIT_SHA } : {}),
});
if (!deploy?.id) {
  // Render answered "queued" without a deploy object (another deploy is running). Pick up the newest one.
  await sleep(pollMs);
  const [latest] = await request(`${deploysUrl}?limit=1`);
  deploy = latest?.deploy ?? latest;
  if (!deploy?.id) throw new Error("Render queued the deploy but did not report its id.");
}
console.log(`Deploy ${deploy.id} started${COMMIT_SHA ? ` for commit ${COMMIT_SHA.slice(0, 7)}` : ""}.`);

const deadline = Date.now() + timeoutMs;
let lastStatus;
while (true) {
  const { status } = await request(`${deploysUrl}/${deploy.id}`);
  if (status !== lastStatus) console.log(`  status: ${status}`);
  lastStatus = status;
  if (status === "live") {
    console.log("Deploy is live.");
    process.exit(0);
  }
  if (FAILED.has(status)) {
    console.error(`Deploy failed with status "${status}". See the deploy logs in the Render dashboard.`);
    process.exit(1);
  }
  if (Date.now() > deadline) {
    console.error(`Timed out waiting for the deploy (last status "${status}").`);
    process.exit(1);
  }
  await sleep(pollMs);
}
