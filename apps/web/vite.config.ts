import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Ports come from the repo-root .env (written by `pnpm env:local`), so each git worktree gets its own.
  const env = loadEnv(mode, "../..", "");
  return {
    plugins: [react()],
    server: {
      port: Number(env.WEB_PORT ?? 5173),
      // Fail instead of silently moving to another port, which would break the E2E tests' base URL.
      strictPort: true,
      proxy: { "/api": `http://localhost:${env.PORT ?? 8787}` },
    },
  };
});
