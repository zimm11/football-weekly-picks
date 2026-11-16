// Cloudflare Worker entrypoint (production). Static Assets serve the web app; only /api/* reaches the fetch
// handler (wrangler.jsonc). The Cron Trigger calls the scheduled handler, which runs the email and push jobs. Local
// development and tests use the Node entrypoint, src/index.ts.

import { env } from "cloudflare:workers";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHyperdriveDb, type Db } from "@picks/db";
import { createApp } from "./app";
import { supabaseTokenVerifier } from "./auth";
import { cloudflareMailer, mailpitMailer } from "./email";
import { loadWorkerEnv } from "./env";
import { liveInsights } from "./insights";
import { runScheduledJobs } from "./jobs";
import { logError } from "./logging";
import { espnProvider } from "./nfl";
import type { EmailDeps } from "./outbox";
import { webPushSender } from "./pushSender";

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
 * Work that should outlive the response (a new thread's emails and notifications). A Worker cancels anything still
 * running once the response is sent unless it is passed to `waitUntil`, and the request's connection closes
 * then too, so `withConnection` waits for these tasks before closing it. A task belongs to the request that
 * started it; no other request ever awaits it. Tasks log their own errors.
 */
function background(task: () => Promise<unknown>) {
  const current = scope.getStore();
  if (!current) throw new Error("Background work must start while handling a request");
  current.tasks.push(task());
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
        }
      : undefined;
  // Push is on once all three VAPID secrets are set (README, "Push notifications").
  const push =
    config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY && config.VAPID_SUBJECT
      ? webPushSender({
          publicKey: config.VAPID_PUBLIC_KEY,
          privateKey: config.VAPID_PRIVATE_KEY,
          subject: config.VAPID_SUBJECT,
        })
      : undefined;
  const app = createApp({
    db,
    verifyToken: supabaseTokenVerifier(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY),
    nfl: espnProvider(),
    insights: liveInsights(),
    operatorUserIds: config.OPERATOR_USER_IDS,
    email,
    push,
    background,
    publicConfig: {
      supabaseUrl: config.SUPABASE_URL,
      supabasePublishableKey: config.SUPABASE_PUBLISHABLE_KEY,
    },
  });
  // `pnpm worker:dev` sets NODE_ENV=development; deployed Workers always run with wrangler.jsonc's "production".
  return { app, email, push, production: config.NODE_ENV !== "development" };
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

  /** The Cron Trigger (wrangler.jsonc): queue due pick reminders, then send what's waiting, by email and push. */
  async scheduled(_controller, env, ctx) {
    if (!worker || (!worker.email && !worker.push)) return;
    const { email, push, production } = worker;
    // Each job logs its own failures through the safe logger, so nothing raw reaches the runtime's log.
    await withConnection(env, ctx, production, () => runScheduledJobs(db, { email, push }, new Date()));
  },
} satisfies ExportedHandler<Env>;
