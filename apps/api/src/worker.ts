// Cloudflare Worker entrypoint (production). Static Assets serve the web app; only /api/* reaches this
// handler (wrangler.jsonc). Local development and tests use the Node entrypoint, src/index.ts.

import { env } from "cloudflare:workers";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHyperdriveDb, type Db } from "@picks/db";
import { createApp } from "./app";
import { supabaseTokenVerifier } from "./auth";
import { loadWorkerEnv } from "./env";
import { liveInsights } from "./insights";
import { logError } from "./logging";
import { espnProvider } from "./nfl";

/**
 * A Worker can't keep a database connection between requests, but the routes are built once per isolate (so
 * their caches survive) and hold on to `deps.db`. This stand-in forwards each use to the current request's
 * Hyperdrive connection.
 */
const requestDb = new AsyncLocalStorage<Db>();
const db = new Proxy({} as Db, {
  get(_, key) {
    const current = requestDb.getStore();
    if (!current) throw new Error("The database is only available while handling a request");
    const value = Reflect.get(current, key, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

/**
 * Built at module load, from the top-level `env`: that work counts toward the Worker's startup (1 s limit), not
 * toward each request's CPU time (10 ms on the free plan). A configuration error is logged once and answered
 * with a 500, rather than failing every request with a runtime exception.
 */
function build() {
  const config = loadWorkerEnv(env);
  const app = createApp({
    db,
    verifyToken: supabaseTokenVerifier(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY),
    nfl: espnProvider(),
    insights: liveInsights(),
    operatorUserIds: config.OPERATOR_USER_IDS,
    publicConfig: {
      supabaseUrl: config.SUPABASE_URL,
      supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY,
    },
  });
  // `pnpm worker:dev` sets NODE_ENV=development; deployed Workers always run with wrangler.jsonc's "production".
  return { app, production: config.NODE_ENV !== "development" };
}

let worker: ReturnType<typeof build> | undefined;
try {
  worker = build();
} catch (error) {
  logError("startup", error);
}

export default {
  async fetch(request, env, ctx) {
    if (!worker) return Response.json({ error: "Internal server error" }, { status: 500 });
    const { app, production } = worker;
    // In production the database leg must be encrypted; the health check confirms it.
    const connection = createHyperdriveDb(env.HYPERDRIVE.connectionString, { requireTls: production });
    try {
      return await requestDb.run(connection, () => app.fetch(request, env, ctx));
    } finally {
      ctx.waitUntil(connection.$close());
    }
  },
} satisfies ExportedHandler<Env>;
