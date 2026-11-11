#!/usr/bin/env node
// Triggers a Render deploy of one commit and waits until it is live. Exits non-zero if the deploy fails,
// so the GitHub Actions run reflects what actually happened on Render.
//
// Env: RENDER_API_KEY, RENDER_SERVICE_ID, and optionally COMMIT_SHA (defaults to the branch's latest commit),
// DEPLOY_TIMEOUT_MINUTES (default 20), POLL_SECONDS (default 10).
const { RENDER_API_KEY, RENDER_SERVICE_ID, COMMIT_SHA } = process.env;
const api = "https://api.render.com/v1";
const timeoutMs = Number(process.env.DEPLOY_TIMEOUT_MINUTES ?? 20) * 60_000;
const pollMs = Number(process.env.POLL_SECONDS ?? 10) * 1000;

if (!RENDER_API_KEY || !RENDER_SERVICE_ID) {
  console.error("RENDER_API_KEY and RENDER_SERVICE_ID must be set.");
  process.exit(1);
}

const FAILED = new Set(["build_failed", "update_failed", "pre_deploy_failed", "canceled", "deactivated"]);
const deploysUrl = `${api}/services/${RENDER_SERVICE_ID}/deploys`;

class RenderRequestError extends Error {
  constructor(status) {
    super("Render API request failed.");
    this.status = status;
  }
}

async function request(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${RENDER_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new RenderRequestError(res.status);
  return res.json();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
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
  if (!/^dep-[a-z0-9]+$/.test(deploy.id)) throw new Error("Invalid deploy id.");
  console.log("Render deploy started.");

  const deadline = Date.now() + timeoutMs;
  let lastStatus;
  while (true) {
    const { status } = await request(`${deploysUrl}/${deploy.id}`);
    if (
      ![
        "created",
        "queued",
        "build_in_progress",
        "pre_deploy_in_progress",
        "update_in_progress",
        "live",
        ...FAILED,
      ].includes(status)
    ) {
      throw new Error("Unexpected Render status.");
    }
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
}

main().catch((error) => {
  console.error(
    error instanceof RenderRequestError
      ? `Render API request failed (HTTP ${error.status}). Check deployment settings in Render.`
      : "Render deployment failed. Check service configuration and connectivity.",
  );
  process.exitCode = 1;
});
