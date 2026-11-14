// Cloudflare Worker entrypoint (production). Static Assets serve the web app; only /api/* reaches the fetch
// handler (wrangler.jsonc). The Cron Trigger calls the scheduled handler, which runs the email job. Local
// development and tests use the Node entrypoint, src/index.ts.

import { env } from "cloudflare:workers";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHyperdriveDb, type Db } from "@picks/db";
import { createApp } from "./app";
import { supabaseTokenVerifier } from "./auth";
import { cloudflareMailer, mailpitMailer } from "./email";
import { loadWorkerEnv } from "./env";
import { liveInsights } from "./insights";
import { logEmailJobs, logError } from "./logging";
import { espnProvider } from "./nfl";
import { type EmailDeps, runEmailJobs } from "./outbox";

/** One request's (or one scheduled run's) database connection, and the work it handed to `background`. */
type Scope = { db: Db; tasks: Promise<unknown>[] };
const scope = new AsyncLocalStorage<Scope>();

/**
 * A Worker can't keep a database connection between requests, but the routes are built once per isolate (so
 * their caches survive) and hold on to `deps.db`. This stand-in forwards each use to the current request's
 * Hyperdrive connection.
 */
const db = new Proxy({} as Db, {
  get(_, key) {
    const current = scope.getStore()?.db;
    if (!current) throw new Error("The database is only available while handling a request");
    const value = Reflect.get(current, key, current);
    return typeof value === "function" ? value.bind(current) : value;
  },
});

/**
 * Work that should outlive the response (sending a new thread's emails). A Worker cancels anything still
 * running once the response is sent unless it is passed to `waitUntil`, and the request's connection closes
 * then too, so `withConnection` waits for these tasks before closing it. A task belongs to the request that
 * started it; no other request ever awaits it.
 */
function background(task: () => Promise<unknown>) {
  const current = scope.getStore();
  if (!current) throw new Error("Background work must start while handling a request");
  current.tasks.push(task().catch((error) => logError("email_jobs", error)));
}

/**
 * Built at module load, from the top-level `env`: that work counts toward the Worker's startup (1 s limit), not
 * toward each request's CPU time. A configuration error is logged once and answered with a 500, rather than
 * failing every request with a runtime exception.
 */
function build() {
  const config = loadWorkerEnv(env);
  // Email is on once UNSUBSCRIBE_SECRET is set (README, "Email"). `pnpm worker:dev` sends to the local test
  // inbox instead of Cloudflare; env validation refuses INBOX_URL in production.
  const email: EmailDeps | undefined =
    config.UNSUBSCRIBE_SECRET && config.APP_URL
      ? {
          mailer: config.INBOX_URL
            ? mailpitMailer(config.INBOX_URL, config.EMAIL_FROM)
            : cloudflareMailer({ send: (message) => env.EMAIL.send(message) }, config.EMAIL_FROM),
          appUrl: config.APP_URL,
          unsubscribeSecret: config.UNSUBSCRIBE_SECRET,
          limits: { daily: config.EMAIL_DAILY_LIMIT, monthly: config.EMAIL_MONTHLY_LIMIT },
          background,
        }
      : undefined;
  const app = createApp({
    db,
    verifyToken: supabaseTokenVerifier(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY),
    nfl: espnProvider(),
    insights: liveInsights(),
    operatorUserIds: config.OPERATOR_USER_IDS,
    email,
    publicConfig: {
      supabaseUrl: config.SUPABASE_URL,
      supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY,
    },
  });
  // `pnpm worker:dev` sets NODE_ENV=development; deployed Workers always run with wrangler.jsonc's "production".
  return { app, email, production: config.NODE_ENV !== "development" };
}

let worker: ReturnType<typeof build> | undefined;
try {
  worker = build();
} catch (error) {
  logError("startup", error);
}

/** Runs `work` with its own Hyperdrive connection, closed once `work` and its background tasks are done. */
async function withConnection<T>(
  env: Env,
  ctx: ExecutionContext,
  production: boolean,
  work: () => Promise<T>,
): Promise<T> {
  // In production the database leg must be encrypted; the health check confirms it.
  const connection = createHyperdriveDb(env.HYPERDRIVE.connectionString, { requireTls: production });
  const current: Scope = { db: connection, tasks: [] };
  try {
    return await scope.run(current, work);
  } finally {
    ctx.waitUntil(Promise.allSettled(current.tasks).then(() => connection.$close()));
  }
}

export default {
  async fetch(request, env, ctx) {
    if (!worker) return Response.json({ error: "Internal server error" }, { status: 500 });
    const { app, production } = worker;
    return withConnection(env, ctx, production, async () => app.fetch(request, env, ctx));
  },

  /** The Cron Trigger (wrangler.jsonc): queue due pick reminders, then send what's waiting in the outbox. */
  async scheduled(_controller, env, ctx) {
    if (!worker?.email) return;
    const { email, production } = worker;
    try {
      const result = await withConnection(env, ctx, production, () => runEmailJobs(db, email, new Date()));
      logEmailJobs(result);
    } catch (error) {
      // Logged through the safe logger, not rethrown: the runtime would print the raw error.
      logError("email_jobs", error);
    }
  },
} satisfies ExportedHandler<Env>;
