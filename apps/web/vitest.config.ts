import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Component tests run in real Chromium (driven by Playwright), not a simulated DOM.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.tsx"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
});
