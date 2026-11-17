import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import type { AuthVariables } from "./auth";
import { CLOUDFLARE_EMAIL_ERROR_CODES } from "./email";

/** Fixed codes for push failures the push service won't recover from, by HTTP status class (pushSender.ts). */
export const PUSH_ERROR_CODES = [
  "VAPID_KEY_MISMATCH",
  "PUSH_BAD_REQUEST",
  "PUSH_UNAUTHORIZED",
  "PUSH_PAYLOAD_TOO_LARGE",
  "PUSH_REJECTED",
  "PUSH_SUBSCRIPTION_INVALID",
] as const;

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const codes = new Set<string>([
  "INVALID_ENVIRONMENT",
  // Cloudflare Email Service's error codes: fixed identifiers, never prose.
  ...CLOUDFLARE_EMAIL_ERROR_CODES,
  "EMAIL_REJECTED",
  "EMAIL_PROVIDER_UNAVAILABLE",
  "EMAIL_QUOTA_EXCEEDED",
  ...PUSH_ERROR_CODES,
  "DATABASE_TLS_REQUIRED",
  "AUTH_UNAVAILABLE",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "28P01",
  "23505",
  "23503",
  "23514",
  "40001",
  "40P01",
  "53300",
  "57P01",
  "08001",
  "08006",
]);
const messages: Record<string, string> = {
  INVALID_ENVIRONMENT: "API environment configuration is invalid.",
  EMAIL_REJECTED: "Email provider rejected the message.",
  EMAIL_PROVIDER_UNAVAILABLE: "Email provider unavailable or refused the request.",
  EMAIL_QUOTA_EXCEEDED: "Email provider quota reached; notification emails resume tomorrow (UTC).",
  E_DAILY_LIMIT_EXCEEDED:
    "Cloudflare's daily email quota reached; notification emails resume tomorrow (UTC).",
  E_RATE_LIMIT_EXCEEDED: "Cloudflare is rate limiting email; the outbox will retry.",
  E_SENDER_NOT_VERIFIED: "The sender's domain isn't verified for Cloudflare Email Sending.",
  E_SENDER_DOMAIN_NOT_AVAILABLE: "The sender's domain isn't onboarded to Cloudflare Email Sending.",
  E_RECIPIENT_NOT_ALLOWED:
    "Cloudflare refused the recipient (on Workers Free, only verified addresses can receive).",
  E_RECIPIENT_SUPPRESSED:
    "The recipient is on Cloudflare's suppression list (an earlier bounce or complaint).",
  VAPID_KEY_MISMATCH:
    "VAPID_PRIVATE_KEY doesn't belong to VAPID_PUBLIC_KEY; push stays off until the pair matches.",
  PUSH_BAD_REQUEST: "A push service rejected a notification as malformed (400).",
  PUSH_UNAUTHORIZED:
    "A push service refused this app's VAPID authorization (401/403), e.g. a subscription made with other keys.",
  PUSH_PAYLOAD_TOO_LARGE: "A push service refused a notification as too large (413).",
  PUSH_REJECTED: "A push service permanently rejected a notification (other 4xx).",
  PUSH_SUBSCRIPTION_INVALID: "A device subscription has an unusable endpoint or keys.",
  DATABASE_TLS_REQUIRED: "Pooler-to-database TLS is disabled. Enable database SSL enforcement.",
  AUTH_UNAVAILABLE: "Supabase Auth didn't answer.",
  ECONNREFUSED: "Connection refused.",
  ECONNRESET: "Connection reset.",
  ETIMEDOUT: "Connection timed out.",
  ENOTFOUND: "Host lookup failed.",
  EPIPE: "Connection closed unexpectedly.",
  CERT_HAS_EXPIRED: "TLS certificate expired.",
  DEPTH_ZERO_SELF_SIGNED_CERT: "TLS certificate is not trusted.",
  SELF_SIGNED_CERT_IN_CHAIN: "TLS certificate chain is not trusted.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "TLS certificate signature could not be verified.",
  ERR_TLS_CERT_ALTNAME_INVALID: "TLS certificate does not match the host.",
  "28P01": "Database authentication failed.",
  "23505": "Database unique constraint violated.",
  "23503": "Database reference constraint violated.",
  "23514": "Database check constraint violated.",
  "40001": "Database transaction must be retried.",
  "40P01": "Database transaction deadlock.",
  "53300": "Database connection limit reached.",
  "57P01": "Database server is shutting down.",
  "08001": "Database connection could not be established.",
  "08006": "Database connection failed.",
};
const applicationMessages = new Set([
  "Thread insert returned no row",
  "League insert returned no row",
  "Season upsert returned no row",
  "Reminder has no games",
  "Invalid league event name",
  "Screening answer was unusable",
  "Report insert returned no row",
  "Auth soft delete failed",
]);
const operationMessages = {
  health: "Database health check failed.",
  request: "Unexpected API request failure.",
  schedule_import: "Schedule provider request failed.",
  results_sync: "Results provider request failed.",
  results_autosync: "Automatic results provider request failed.",
  matchup_insights: "Matchup stats provider request failed.",
  market_insights: "Prediction market provider request failed.",
  push_delivery: "Push notification delivery failed.",
  push_queue: "Queueing pick reminder notifications failed.",
  push_config: "Push configuration is invalid; push is off.",
  reminder_targets: "Working out who needs a pick reminder failed.",
  startup: "API startup failed; check environment configuration.",
  email_send: "Sending an email failed.",
  email_jobs: "Email job failed.",
  email_queue: "Queueing pick reminder emails failed.",
  automation_jobs: "League automation run failed.",
  automation_due: "Finding leagues with automation due failed.",
  automation_league: "Advancing one league's automation failed.",
  league_event: "Queueing a league event's notifications failed.",
  moderation_screen: "Content screening model request failed; the content was saved unchecked.",
  moderation_jobs: "Moderation job failed.",
  moderation_report: "Checking a reported message failed.",
  account_delete: "Deleting an account in Supabase Auth failed; the scheduled job retries it.",
};
type Operation = keyof typeof operationMessages;

/** The first known error code on an error or its causes, else `UNKNOWN`. Safe to log or store. */
export function knownErrorCode(error: unknown): string {
  for (let depth = 0, current = error; depth < 5 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && codes.has(candidate.code)) return candidate.code;
    current = candidate.cause;
  }
  return "UNKNOWN";
}

/** Only fixed operations and known error codes cross the logging boundary. Never serialize errors. */
export function logError(operation: Operation, error: unknown, requestId?: string) {
  const code = knownErrorCode(error);
  // Keep diagnostic prose, but only from our fixed vocabulary. Arbitrary driver messages embed SQL values.
  const message =
    messages[code] ??
    (error instanceof Error && applicationMessages.has(error.message)
      ? error.message
      : operationMessages[operation]);
  // Source maps resolve these to application files. Emit only an allowlisted basename and line/column,
  // never the error header, a full stack, file URL, function arguments, or arbitrary filename.
  const frame =
    error instanceof Error
      ? error.stack?.match(
          /apps\/api\/src\/((?:automation\/|reminders\/)?(?:accounts|app|auth|context|email|env|index|insights|jobs|leagueEvents|leagues|logging|messages|moderation|moderationJobs|nfl|operator|outbox|pickem|playoff|push|pushQueue|pushSender|reminderTargets|screening|services|squares|survivor|templates|typeHooks|unsubscribe|webPush|weekOps|weekly|weeks|worker))\.(ts|js):(\d{1,6}):(\d{1,6})\b/,
        )
      : undefined;
  const location = frame ? `${frame[1]}.${frame[2]}:${frame[3]}:${frame[4]}` : undefined;
  const inputFields = error && typeof error === "object" && "fields" in error ? error.fields : undefined;
  const fields =
    code === "INVALID_ENVIRONMENT" && Array.isArray(inputFields)
      ? inputFields.filter((field) =>
          [
            "PORT",
            "DATABASE_URL",
            "SUPABASE_URL",
            "SUPABASE_PUBLISHABLE_KEY",
            "OPERATOR_USER_IDS",
            "APP_URL",
            "EMAIL_FROM",
            "INBOX_URL",
            "UNSUBSCRIBE_SECRET",
            "EMAIL_DAILY_LIMIT",
            "EMAIL_MONTHLY_LIMIT",
            "VAPID_PUBLIC_KEY",
            "VAPID_PRIVATE_KEY",
            "VAPID_SUBJECT",
            "MODERATION_MODE",
            "SUPABASE_SECRET_KEY",
          ].includes(field),
        )
      : undefined;
  console.error(JSON.stringify({ event: "error", operation, message, code, requestId, location, fields }));
}

const warnings = {
  email_budget_reached: "Email budget reached; notification emails resume tomorrow (UTC).",
};

/** A fixed, expected condition worth seeing in the logs. Carries no data beyond its name and message. */
export function logWarning(name: keyof typeof warnings) {
  console.warn(JSON.stringify({ event: "warning", name, message: warnings[name] }));
}

/** A summary of one scheduled run: counts only, and only when it did something. */
export function logJobRun(
  event: "email_jobs" | "push_jobs" | "automation_jobs" | "moderation_jobs" | "account_jobs",
  result: Record<string, number>,
) {
  if (Object.values(result).some((n) => n > 0)) console.log(JSON.stringify({ event, ...result }));
}

export const requestLogger = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const requestId = randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-ID", requestId);
  const start = performance.now();
  try {
    await next();
  } finally {
    console.log(
      JSON.stringify({
        event: "request",
        requestId,
        method: methods.has(c.req.method) ? c.req.method : "OTHER",
        route: routePath(c, -1) || "unmatched",
        status: c.res.status,
        durationMs: Math.round(performance.now() - start),
      }),
    );
  }
});
