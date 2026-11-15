import { defineConfig } from "vitest/config";

/**
 * `pnpm test:contract`: live checks against ESPN's feeds. They need the network, so they stay out of
 * `pnpm test` (whose default pattern, `*.test.ts`, doesn't match `*.contract.ts`).
 */
export default defineConfig({
  test: {
    include: ["test/contract/**/*.contract.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
