import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  // A pasted line break inside the URL becomes part of the password and fails authentication, so reject it up front.
  DATABASE_URL: z
    .string()
    .trim()
    .min(1)
    .refine((url) => !/\s/.test(url), "contains a line break, tab or space; re-paste it as a single line"),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  /** Directory of the built web app. When set, the API also serves the SPA (production). */
  WEB_DIST_DIR: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
