import { parseDatabaseUrl } from "@picks/db";
import { z } from "zod";

/** Legacy anon JWTs remain supported; privileged keys must never reach /api/config. */
function isPublishableKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  try {
    return JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")).role === "anon";
  } catch {
    return false;
  }
}

/** Settings both entrypoints read: the Node server and the Cloudflare Worker. */
const sharedFields = {
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().refine(isPublishableKey, "Use a publishable key or legacy anon key"),
  NODE_ENV: z.string().optional(),
  /**
   * Comma-separated Supabase user ids of the accounts that run the app. They get the operator screen
   * (feedback and app-wide counts). Empty or unset means nobody does.
   */
  OPERATOR_USER_IDS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.uuid("OPERATOR_USER_IDS must be a comma-separated list of user ids"))),

  // ---------- Email (all optional: without UNSUBSCRIBE_SECRET, the API sends no notification emails) ----------
  /** The public web origin that links in emails point at, e.g. `https://www.pow-pickem.com`. */
  APP_URL: z
    .url()
    .transform((url) => url.replace(/\/+$/, ""))
    .optional(),
  /** The sender. Its domain must be onboarded to Cloudflare Email Sending (and allowed in wrangler.jsonc). */
  EMAIL_FROM: z.string().trim().min(3).default("POW Pick'em <noreply@pow-pickem.com>"),
  /** Signs unsubscribe links, and switches notification email on. At least 32 characters; rotating it breaks links in emails already sent. */
  UNSUBSCRIBE_SECRET: z.string().min(32).optional(),
  /** Local mailer: the Supabase stack's test inbox, used instead of Cloudflare. Refused when NODE_ENV=production. */
  INBOX_URL: z.url().optional(),
  /**
   * The most notification emails the API hands the provider per UTC day and month: a safety cap against a
   * runaway loop, set well above what the leagues need. Past the 3,000 a month Workers Paid includes, sends cost
   * $0.35 per 1,000, so a month at the cap costs about $2.45 more.
   */
  EMAIL_DAILY_LIMIT: z.coerce.number().int().min(0).default(1000),
  EMAIL_MONTHLY_LIMIT: z.coerce.number().int().min(0).default(10000),

  /**
   * Content screening on Workers AI (the Worker's `AI` binding). `enforce` checks every post and name, refusing
   * what the model blocks; `off` is the emergency switch for an outage or a run of wrong blocks. The Node API has
   * no `AI` binding, so it never screens.
   */
  MODERATION_MODE: z.enum(["enforce", "off"]).default("enforce"),

  /** Explicit opt-in to native push after Expo/APNs credentials are configured. */
  EXPO_PUSH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  /** Expo enhanced push security token. Never exposed to clients. */
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),

  // ---------- Web Push (all three or none: without them, push is switched off) ----------
  /** The VAPID public key (65-byte uncompressed P-256 point, base64url). Browsers subscribe with it. */
  VAPID_PUBLIC_KEY: z
    .string()
    .regex(/^B[A-Za-z0-9_-]{86}$/)
    .optional(),
  /** The matching private key (32 bytes, base64url). A secret; changing the pair orphans every subscription. */
  VAPID_PRIVATE_KEY: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .optional(),
  /** A contact push services can reach: `mailto:` or `https:`. */
  VAPID_SUBJECT: z
    .string()
    .regex(/^(mailto:|https:\/\/).+/)
    .optional(),
};

/** Email and push settings that only make sense together. Shared by both entrypoints' schemas. */
function settingRules(
  env: {
    NODE_ENV?: string;
    APP_URL?: string;
    UNSUBSCRIBE_SECRET?: string;
    INBOX_URL?: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
  },
  ctx: z.RefinementCtx,
) {
  const vapid = [env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT];
  if (vapid.some(Boolean) && !vapid.every(Boolean)) {
    ctx.addIssue({
      code: "custom",
      path: ["VAPID_PUBLIC_KEY"],
      message: "Set all three VAPID variables together, or leave all unset.",
    });
  }
  if (env.INBOX_URL && env.NODE_ENV === "production") {
    ctx.addIssue({
      code: "custom",
      path: ["INBOX_URL"],
      message: "INBOX_URL is for local testing and is not allowed when NODE_ENV=production",
    });
  }
  if (env.INBOX_URL && !env.UNSUBSCRIBE_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["UNSUBSCRIBE_SECRET"],
      message: "UNSUBSCRIBE_SECRET is required to send email (it signs unsubscribe links)",
    });
  }
  if (env.UNSUBSCRIBE_SECRET && !env.APP_URL) {
    ctx.addIssue({
      code: "custom",
      path: ["APP_URL"],
      message: "APP_URL is required to send email (links in emails point at it)",
    });
  }
}

const envSchema = z
  .object({
    PORT: z.coerce.number().default(8787),
    /** Exact Expo browser origin supplied by the local launcher; never used by the Worker. */
    MOBILE_DEV_ORIGIN: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return url.protocol === "http:" && value === url.origin && Boolean(url.port);
      }, "Use an HTTP origin with an explicit port")
      .optional(),
    // A pasted line break inside the URL becomes part of the password and fails authentication, so reject it up front.
    DATABASE_URL: z
      .string()
      .trim()
      .min(1)
      .superRefine((url, ctx) => {
        try {
          parseDatabaseUrl(url);
        } catch (error) {
          ctx.addIssue({
            code: "custom",
            message: error instanceof Error ? error.message : "Invalid database URL",
          });
        }
      }),
    ...sharedFields,
    /**
     * Local testing only: pretend the API started at this moment (ISO 8601 with an offset, e.g.
     * `2026-09-13T12:30:00-04:00`). The clock keeps running from there. Refused when NODE_ENV=production.
     */
    CLOCK_OVERRIDE: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((env) => !(env.CLOCK_OVERRIDE && env.NODE_ENV === "production"), {
    path: ["CLOCK_OVERRIDE"],
    message: "CLOCK_OVERRIDE is for local testing and is not allowed when NODE_ENV=production",
  })
  .refine((env) => !(env.MOBILE_DEV_ORIGIN && env.NODE_ENV === "production"), {
    path: ["MOBILE_DEV_ORIGIN"],
    message: "MOBILE_DEV_ORIGIN is for local testing only",
  })
  .superRefine(settingRules);

/**
 * The Worker gets its database from the Hyperdrive binding and sends email through the EMAIL binding, so it
 * has no DATABASE_URL, PORT or clock override.
 */
const workerEnvSchema = z.object(sharedFields).superRefine(settingRules);

export type Env = z.infer<typeof envSchema>;

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

function parseEnv<T>(schema: z.ZodType<T>, source: unknown): T {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw Object.assign(new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`), {
      code: "INVALID_ENVIRONMENT",
      fields: [...new Set(parsed.error.issues.map((issue) => issue.path[0]))],
    });
  }
  return parsed.data;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parseEnv(envSchema, source);
}

/** Reads the Worker's vars and secrets. Bindings such as HYPERDRIVE and ASSETS are ignored. */
export function loadWorkerEnv(source: object): WorkerEnv {
  return parseEnv(workerEnvSchema, source);
}
