import { serve } from "@hono/node-server";
import { createDb } from "@picks/db";
import { refuseDeletedAccounts, supabaseAccountAdmin } from "./accounts";
import { createApp } from "./app";
import { supabaseTokenVerifier } from "./auth";
import { shiftedClock } from "./clock";
import { mailpitMailer } from "./email";
import { loadEnv } from "./env";
import { liveInsights } from "./insights";
import { runScheduledJobs } from "./jobs";
import { withLocalWeb } from "./localWeb";
import { logError } from "./logging";
import { espnProvider } from "./nfl";
import { expoPushSender, webPushSender } from "./pushSender";

/** How often local development runs the scheduled jobs. Production's Cron Trigger is in wrangler.jsonc. */
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
  const sender =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
      ? webPushSender(
          {
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
            subject: env.VAPID_SUBJECT,
          },
          fetch,
          now,
        )
      : undefined;
  // A mismatched VAPID pair is logged (VAPID_KEY_MISMATCH) and switches push off instead of failing every send.
  const push = sender && (await sender.ready?.()) ? sender : undefined;
  const nativePush = env.EXPO_PUSH_ENABLED ? expoPushSender(env.EXPO_ACCESS_TOKEN) : undefined;
  const accounts = env.SUPABASE_SECRET_KEY
    ? supabaseAccountAdmin(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_SECRET_KEY)
    : undefined;
  const app = createApp({
    db,
    accounts,
    push,
    nativePush,
    // A deleted account is refused even while its access token is still valid.
    verifyToken: refuseDeletedAccounts(
      db,
      supabaseTokenVerifier(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY),
    ),
    nfl: espnProvider(),
    insights: liveInsights(),
    now: clock?.now,
    operatorUserIds: env.OPERATOR_USER_IDS,
    email,
    publicConfig: {
      supabaseUrl: env.SUPABASE_URL,
      supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY,
      ...(clock && { clockOffsetMs: clock.offsetMs }),
    },
  });

  const server = serve({ fetch: withLocalWeb(app, env.MOBILE_DEV_ORIGIN).fetch, port: env.PORT }, (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  });

  // Production runs the scheduled jobs from the Worker's Cron Trigger; locally a timer stands in for it. Node has
  // no Workers AI binding, so nothing is screened here (README, "Content moderation").
  let running = false;
  const jobs = setInterval(async () => {
    if (running) return;
    running = true;
    await runScheduledJobs(
      db,
      { email, push, nativePush, accounts, operatorUserIds: env.OPERATOR_USER_IDS },
      now(),
    ).finally(() => {
      running = false;
    });
  }, LOCAL_JOB_INTERVAL_MS);

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
