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
};

const envSchema = z
  .object({
    PORT: z.coerce.number().default(8787),
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
  });

/** The Worker gets its database from the Hyperdrive binding, so it has no DATABASE_URL, PORT or clock override. */
const workerEnvSchema = z.object(sharedFields);

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
