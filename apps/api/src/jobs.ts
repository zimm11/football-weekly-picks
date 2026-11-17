import type { Db } from "@picks/db";
import { type AccountAdmin, retryAuthDeletions } from "./accounts";
import { advanceLeagues } from "./automation";
import { logError, logJobRun } from "./logging";
import { runModerationJobs } from "./moderationJobs";
import type { NflProvider } from "./nfl";
import { type EmailDeps, runEmailJobs } from "./outbox";
import { runPushJobs } from "./pushQueue";
import type { PushSender } from "./pushSender";
import type { Screener } from "./screening";
import { providerWeeks } from "./weekOps";

/**
 * The scheduled work: the account and moderation jobs (retrying Auth deletions, rechecking posts saved unchecked,
 * clearing removed text, the operator's digest), leagues that run themselves (automation), then pick reminders
 * and retries, by email and by push. Production runs it from the Worker's Cron Trigger (wrangler.jsonc), local
 * development on a timer (src/index.ts). Each part is idempotent and fails on its own: automation failing
 * (logged per league as `automation_league`) never holds up email or push, a push service outage never holds up
 * email or the other way round, and within each channel a failure to queue reminders (logged as `email_queue` /
 * `push_queue`) never stops the send step. Moderation and automation run first, so a digest or the notifications
 * they queue go out in the same run.
 */
export async function runScheduledJobs(
  db: Db,
  deps: {
    email?: EmailDeps;
    push?: PushSender;
    nativePush?: PushSender;
    nfl?: NflProvider;
    screener?: Screener;
    accounts?: AccountAdmin;
    operatorUserIds?: readonly string[];
  },
  now: Date,
) {
  const { email, push, nativePush, nfl } = deps;
  // Accounts whose data is deleted but whose Auth soft delete didn't go through.
  if (deps.accounts)
    await retryAuthDeletions(db, deps.accounts).then(
      (authDeleted) => logJobRun("account_jobs", { authDeleted }),
      (error) => logError("account_delete", error),
    );
  await runModerationJobs(db, deps, now).then(
    (result) => logJobRun("moderation_jobs", result),
    (error) => logError("moderation_jobs", error),
  );
  if (nfl) {
    await advanceLeagues({
      db,
      nfl,
      now,
      results: providerWeeks(nfl, () => now),
      notify: { email, push, nativePush },
    }).then(
      (result) => logJobRun("automation_jobs", result),
      (error) => logError("automation_jobs", error),
    );
  }
  await Promise.all([
    email &&
      runEmailJobs(db, email, now).then(
        (result) => logJobRun("email_jobs", result),
        (error) => logError("email_jobs", error),
      ),
    (push || nativePush) &&
      runPushJobs(db, push, now, nativePush).then(
        (result) => logJobRun("push_jobs", result),
        (error) => logError("push_delivery", error),
      ),
  ]);
}
