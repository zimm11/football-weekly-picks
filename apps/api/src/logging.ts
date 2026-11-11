import { randomUUID } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import type { AuthVariables } from "./auth";

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const codes = new Set([
  "INVALID_ENVIRONMENT",
  "DATABASE_TLS_REQUIRED",
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
  DATABASE_TLS_REQUIRED: "Pooler-to-database TLS is disabled. Enable database SSL enforcement.",
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
]);
const operationMessages = {
  health: "Database health check failed.",
  request: "Unexpected API request failure.",
  schedule_import: "Schedule provider request failed.",
  results_sync: "Results provider request failed.",
  startup: "API startup failed; check environment configuration.",
};

/** Only fixed operations and known error codes cross the logging boundary. Never serialize errors. */
export function logError(
  operation: "health" | "request" | "schedule_import" | "results_sync" | "startup",
  error: unknown,
  requestId?: string,
) {
  let code = "UNKNOWN";
  for (let depth = 0, current = error; depth < 5 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && codes.has(candidate.code)) {
      code = candidate.code;
      break;
    }
    current = candidate.cause;
  }
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
          /(?:apps\/api\/src\/|\/app\/api\/)(app|auth|context|env|index|leagues|logging|messages|nfl|weeks)\.(ts|js):(\d{1,6}):(\d{1,6})\b/,
        )
      : undefined;
  const location = frame ? `${frame[1]}.${frame[2]}:${frame[3]}:${frame[4]}` : undefined;
  const inputFields = error && typeof error === "object" && "fields" in error ? error.fields : undefined;
  const fields =
    code === "INVALID_ENVIRONMENT" && Array.isArray(inputFields)
      ? inputFields.filter((field) =>
          ["PORT", "DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"].includes(field),
        )
      : undefined;
  console.error(JSON.stringify({ event: "error", operation, message, code, requestId, location, fields }));
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
