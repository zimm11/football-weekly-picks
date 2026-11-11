import { defineConfig, devices } from "@playwright/test";
import { assertLocalTestEnv } from "./local-env";

// Full-stack E2E: real web app + API + local Supabase (`pnpm db:start` must be running).
// The web and API servers are started automatically, or reused if `pnpm dev` is already up.
const isCI = !!process.env.CI;

// Ports come from the repo-root .env (written by `pnpm env:local`), so each git worktree tests its own servers.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}
assertLocalTestEnv(process.env);
const webUrl = `http://localhost:${process.env.WEB_PORT ?? 5173}`;
const apiUrl = `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: webUrl,
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
      command: "pnpm --filter @picks/api dev",
      url: `${apiUrl}/api/health`,
      reuseExistingServer: !isCI,
      cwd: "..",
    },
    {
      command: "pnpm --filter @picks/web dev",
      url: webUrl,
      reuseExistingServer: !isCI,
      cwd: "..",
    },
  ],
});
