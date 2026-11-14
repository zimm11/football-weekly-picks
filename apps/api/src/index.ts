import { serve } from "@hono/node-server";
import { createDb } from "@picks/db";
import { createApp } from "./app";
import { supabaseTokenVerifier } from "./auth";
import { shiftedClock } from "./clock";
import { loadEnv } from "./env";
import { logError } from "./logging";
import { espnProvider } from "./nfl";

async function main() {
  const env = loadEnv();
  const db = createDb(env.DATABASE_URL);
  try {
    await db.$check();
  } catch (error) {
    await db.$close();
    throw error;
  }
  const clock = env.CLOCK_OVERRIDE ? shiftedClock(new Date(env.CLOCK_OVERRIDE)) : undefined;
  if (clock) console.warn(`Clock override active: the API's clock starts at ${env.CLOCK_OVERRIDE}`);
  const app = createApp({
    db,
    verifyToken: supabaseTokenVerifier(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY),
    nfl: espnProvider(),
    now: clock?.now,
    publicConfig: {
      supabaseUrl: env.SUPABASE_URL,
      supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      ...(clock && { clockOffsetMs: clock.offsetMs }),
    },
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
}

main().catch((error) => {
  logError("startup", error);
  process.exitCode = 1;
});
