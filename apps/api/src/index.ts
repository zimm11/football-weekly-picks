import { readFile } from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createDb } from "@picks/db";
import { createApp } from "./app";
import { supabaseTokenVerifier } from "./auth";
import { loadEnv } from "./env";

const env = loadEnv();
const db = createDb(env.DATABASE_URL);
const app = createApp({
  db,
  verifyToken: supabaseTokenVerifier(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY),
  publicConfig: { supabaseUrl: env.SUPABASE_URL, supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY },
});

if (env.WEB_DIST_DIR) {
  const root = path.resolve(env.WEB_DIST_DIR);
  const indexHtml = await readFile(path.join(root, "index.html"), "utf8");
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), root) }));
  // SPA fallback for client-side routes.
  app.get("*", (c) => c.html(indexHtml));
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});

const shutdown = async () => {
  server.close();
  await db.$close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
