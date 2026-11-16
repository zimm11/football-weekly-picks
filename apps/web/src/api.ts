import type { ApiType } from "@picks/api/app";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hc } from "hono/client";
import { setClockOffset } from "./clock";

type PublicConfig = { supabaseUrl: string; supabasePublishableKey: string; clockOffsetMs?: number };

/** What a request that never reached the API (offline, or the connection dropped) says. */
export const CONNECTION_ERROR = "Can't reach POW Pick'em. Check your connection.";
/** What a request turned away for want of a valid sign-in says. The app signs out and asks again. */
export const SESSION_ENDED = "Your session ended. Sign in again.";

export const isConnectionError = (err: unknown) => err instanceof Error && err.message === CONNECTION_ERROR;

let supabase: Promise<SupabaseClient> | undefined;

async function loadConfig(): Promise<PublicConfig> {
  let res: Response;
  try {
    res = await fetch("/api/config");
  } catch {
    throw new Error(CONNECTION_ERROR);
  }
  // A deploy in progress or the host's own error page (e.g. a spending limit) answers with something else.
  if (!res.ok) throw new Error("POW Pick'em isn't available right now. Try again in a moment.");
  try {
    return (await res.json()) as PublicConfig;
  } catch {
    throw new Error("POW Pick'em isn't available right now. Try again in a moment.");
  }
}

/**
 * Fetches public config from the API at runtime, so the web build needs no baked-in env vars.
 * Caches the promise (not the client) so concurrent callers share one auth client. A failure isn't cached:
 * the next call asks again.
 */
export function getSupabase(): Promise<SupabaseClient> {
  if (!supabase) {
    const loading = loadConfig().then((config) => {
      setClockOffset(config.clockOffsetMs);
      return createClient(config.supabaseUrl, config.supabasePublishableKey);
    });
    supabase = loading;
    loading.catch(() => {
      if (supabase === loading) supabase = undefined;
    });
  }
  return supabase;
}

/** Typed API client — request/response types come straight from the Hono routes. */
export const api = hc<ApiType>("/", {
  headers: async (): Promise<Record<string, string>> => {
    const { data } = await (await getSupabase()).auth.getSession();
    return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {};
  },
}).api;

let endingSession = false;

/**
 * The API no longer accepts this sign-in (it expired, or was revoked elsewhere), though the app still looks
 * signed in. Signing out here puts the sign-in screen up; `takeSessionEnded` lets the app say why.
 */
function endSession() {
  if (endingSession) return;
  endingSession = true;
  getSupabase()
    .then(async (sb) => {
      // Signed-out screens (an unsubscribe link) have no session to end.
      if ((await sb.auth.getSession()).data.session) await sb.auth.signOut({ scope: "local" });
      else endingSession = false;
    })
    .catch(() => {
      endingSession = false;
    });
}

/** Whether the last sign-out was the app's own, after the API turned the session away. Reading it resets it. */
export function takeSessionEnded(): boolean {
  const ended = endingSession;
  endingSession = false;
  return ended;
}

/**
 * Resolves an API call to its JSON body, or throws an Error carrying the API's `{ error }` message.
 * A lost connection and an ended session get messages that say what to do. Callers name the response type
 * from `@picks/shared`.
 */
export async function unwrap<T>(
  request: Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>,
): Promise<T> {
  let res: Awaited<typeof request>;
  try {
    res = await request;
  } catch (err) {
    // fetch rejects with a TypeError when the request never got an answer.
    if (err instanceof TypeError) throw new Error(CONNECTION_ERROR);
    throw err;
  }
  if (res.status === 401) {
    endSession();
    throw new Error(SESSION_ENDED);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data as { error?: string } | null)?.error ?? "Something went wrong. Try again.");
  }
  return data as T;
}

export const messageOf = (err: unknown) =>
  err instanceof Error ? err.message : "Something went wrong. Try again.";
