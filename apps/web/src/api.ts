import type { ApiType } from "@picks/api/app";
import type { AuthProvider } from "@picks/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hc } from "hono/client";
import { setClockOffset } from "./clock";

type PublicConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  authProviders?: AuthProvider[];
  clockOffsetMs?: number;
};

let config: Promise<PublicConfig> | undefined;
let supabase: Promise<SupabaseClient> | undefined;

/** Fetches public config from the API at runtime, so the web build needs no baked-in env vars. */
export function getConfig(): Promise<PublicConfig> {
  config ??= fetch("/api/config").then((res) => res.json() as Promise<PublicConfig>);
  return config;
}

/** Caches the promise (not the client) so concurrent callers share one auth client. */
export function getSupabase(): Promise<SupabaseClient> {
  supabase ??= getConfig().then((config) => {
    setClockOffset(config.clockOffsetMs);
    return createClient(config.supabaseUrl, config.supabasePublishableKey);
  });
  return supabase;
}

/** Typed API client — request/response types come straight from the Hono routes. */
export const api = hc<ApiType>("/", {
  headers: async (): Promise<Record<string, string>> => {
    const { data } = await (await getSupabase()).auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  },
}).api;

/**
 * Resolves an API call to its JSON body, or throws an Error carrying the API's `{ error }` message.
 * Callers name the response type from `@picks/shared`.
 */
export async function unwrap<T>(request: Promise<{ ok: boolean; json(): Promise<unknown> }>): Promise<T> {
  const res = await request;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Something went wrong. Try again.");
  }
  return data as T;
}

export const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : "Something went wrong. Try again.";
