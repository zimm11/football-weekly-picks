import { serve } from "@hono/node-server";
import { createDb } from "@picks/db";
import { createApp } from "./app";
import { supabaseTokenVerifier } from "./auth";
import { shiftedClock } from "./clock";
import { mailpitMailer } from "./email";
import { loadEnv } from "./env";
import { liveInsights } from "./insights";
import { logError } from "./logging";
import { espnProvider } from "./nfl";
import { runEmailJobs } from "./outbox";

/** How often local development runs the email job. Production's Cron Trigger is in wrangler.jsonc. */
const LOCAL_JOB_INTERVAL_MS = 60_000;

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
  // Production email goes through the Worker's Cloudflare binding (src/worker.ts). On Node, the only mailer is
  // the local stack's test inbox.
  const email =
    env.INBOX_URL && env.APP_URL && env.UNSUBSCRIBE_SECRET
      ? {
          mailer: mailpitMailer(env.INBOX_URL, env.EMAIL_FROM),
          appUrl: env.APP_URL,
          unsubscribeSecret: env.UNSUBSCRIBE_SECRET,
          limits: { daily: env.EMAIL_DAILY_LIMIT, monthly: env.EMAIL_MONTHLY_LIMIT },
        }
      : undefined;
  if (!email) console.warn("Email is off: set INBOX_URL (`pnpm env:local`) to send notifications locally");
  const now = clock?.now ?? (() => new Date());
  const app = createApp({
    db,
    verifyToken: supabaseTokenVerifier(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY),
    nfl: espnProvider(),
    insights: liveInsights(),
    now: clock?.now,
    operatorUserIds: env.OPERATOR_USER_IDS,
    email,
    publicConfig: {
      supabaseUrl: env.SUPABASE_URL,
      supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      authProviders: env.AUTH_PROVIDERS,
      ...(clock && { clockOffsetMs: clock.offsetMs }),
    },
  });

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  });

  // Production runs the email job from the Worker's Cron Trigger; locally a timer stands in for it.
  let running = false;
  const jobs = email
    ? setInterval(async () => {
        if (running) return;
        running = true;
        try {
          await runEmailJobs(db, email, now());
        } catch (error) {
          logError("email_jobs", error);
        } finally {
          running = false;
        }
      }, LOCAL_JOB_INTERVAL_MS)
    : undefined;

  const shutdown = async () => {
    clearInterval(jobs);
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
