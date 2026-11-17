import { defineConfig, devices } from "@playwright/test";
import { assertLocalTestEnv } from "./local-env";

// Full-stack E2E against local Supabase (`pnpm db:start` must be running), always on the production build as
// Cloudflare runs it (`pnpm worker:dev`): the Expo web build and the API in the Workers runtime, on one origin.
// The Worker is started automatically, or reused locally if `pnpm worker:dev` is already up.
const isCI = !!process.env.CI;

// Ports come from the repo-root .env (written by `pnpm env:local`), so each git worktree tests its own servers.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}
assertLocalTestEnv(process.env);
const workerUrl = `http://localhost:${process.env.WORKER_PORT ?? Number(process.env.PORT ?? 8787) + 1000}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: workerUrl,
    // The browsers can reach this machine and nothing else. Every other host goes to a proxy that isn't
    // there, so a link that points at the live site (an invite link, an emailed link) fails the test instead
    // of signing up a real account in production. Covers every context, including `browser.newContext()`.
    launchOptions: { proxy: { server: "http://127.0.0.1:9", bypass: "localhost,127.0.0.1,[::1]" } },
    // Auth requests/responses and invite capabilities must not enter uploaded artifacts.
    trace: "off",
    screenshot: "off",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 15"] } },
  ],
  webServer: [
    {
      command: "pnpm worker:dev",
      url: `${workerUrl}/api/health`,
      reuseExistingServer: !isCI,
      cwd: "..",
      timeout: 120_000,
    },
  ],
});
