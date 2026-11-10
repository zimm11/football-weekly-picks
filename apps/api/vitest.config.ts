import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  test: {
    // Load the repo-root .env so DB-backed tests can find DATABASE_URL locally.
    env: loadEnv(mode, "../..", ""),
    fileParallelism: false,
  },
}));
