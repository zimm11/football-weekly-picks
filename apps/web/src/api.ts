import type { ApiType } from "@picks/api/app";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hc } from "hono/client";

let supabase: Promise<SupabaseClient> | undefined;

/**
 * Fetches public config from the API at runtime, so the web build needs no baked-in env vars.
 * Caches the promise (not the client) so concurrent callers share one auth client.
 */
export function getSupabase(): Promise<SupabaseClient> {
  supabase ??= fetch("/api/config")
    .then((res) => res.json() as Promise<{ supabaseUrl: string; supabasePublishableKey: string }>)
    .then((config) => createClient(config.supabaseUrl, config.supabasePublishableKey));
  return supabase;
}

/** Typed API client — request/response types come straight from the Hono routes. */
export const api = hc<ApiType>("/", {
  headers: async (): Promise<Record<string, string>> => {
    const { data } = await (await getSupabase()).auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  },
}).api;
