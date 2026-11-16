import type { Db } from "@picks/db";
import { logError, logJobRun } from "./logging";
import { type EmailDeps, runEmailJobs } from "./outbox";
import { runPushJobs } from "./pushQueue";
import type { PushSender } from "./pushSender";

/**
 * The scheduled work: pick reminders and retries, by email and by push. Production runs it from the Worker's
 * Cron Trigger (wrangler.jsonc), local development on a timer (src/index.ts). Each part is idempotent and fails
 * on its own: a push service outage never holds up email or the other way round, and within each channel a
 * failure to queue reminders (logged as `email_queue` / `push_queue`) never stops the send step.
 */
export async function runScheduledJobs(db: Db, deps: { email?: EmailDeps; push?: PushSender }, now: Date) {
  const { email, push } = deps;
  await Promise.all([
    email &&
      runEmailJobs(db, email, now).then(
        (result) => logJobRun("email_jobs", result),
        (error) => logError("email_jobs", error),
      ),
    push &&
      runPushJobs(db, push, now).then(
        (result) => logJobRun("push_jobs", result),
        (error) => logError("push_delivery", error),
      ),
  ]);
}
