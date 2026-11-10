import { serve } from "@hono/node-server";
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
