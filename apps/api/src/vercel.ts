import { createDb } from "@picks/db";
import { createApp } from "./app";
import { supabaseTokenVerifier } from "./auth";
import { loadEnv } from "./env";

/*
 * Production entrypoint: Vercel runs this Hono app as a function (see /api/index.ts and /vercel.json).
 * Local development uses src/index.ts instead, which runs the same app on a plain Node server.
 */
const env = loadEnv();

// Function instances come and go, so each one keeps a small pool and connects through
// Supabase's transaction pooler (DATABASE_URL on port 6543) rather than holding direct connections.
const db = createDb(env.DATABASE_URL, { max: 3, idle_timeout: 20 });

export default createApp({
  db,
  verifyToken: supabaseTokenVerifier(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY),
  publicConfig: { supabaseUrl: env.SUPABASE_URL, supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY },
});
