import { defineConfig } from "vitest/config";
// React Native defines __DEV__ in every bundle; tests run as a development build.
export default defineConfig({
  define: { __DEV__: "true" },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
