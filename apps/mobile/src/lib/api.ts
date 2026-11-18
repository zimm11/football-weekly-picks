import "./urlPolyfill";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { setClockOffset } from "./clock";
import { apiOrigin, scopedKey } from "./config";
import { sessionStorage } from "./storage";

let client: Promise<SupabaseClient> | undefined;

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";

/** An answer from the API that wasn't a success: its message, with the HTTP status (404 for something gone). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
/** The HTTP status of a failed API request; undefined when the request never got an answer (offline, timeout). */
export const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : undefined);

/** Use AbortController rather than assuming the native runtime implements AbortSignal.timeout. */
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 20_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch {
    throw new Error("Can’t reach POW Pick’em. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
}

export function getSupabase(): Promise<SupabaseClient> {
  if (!client) {
    const loading = (async () => {
      const response = await fetchWithTimeout(`${apiOrigin()}/api/config`, {}, 15_000);
      if (!response.ok) throw new Error("POW Pick’em is unavailable. Try again.");
      const config = (await response.json()) as {
        supabaseUrl: string;
        supabasePublishableKey: string;
        clockOffsetMs?: number;
      };
      if (!config?.supabaseUrl || !config.supabasePublishableKey)
        throw new Error("POW Pick’em is unavailable. Try again.");
      setClockOffset(config.clockOffsetMs);
      return createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: {
          storage: sessionStorage,
          storageKey: `${scopedKey("sb", config.supabaseUrl)}-auth-token`,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: "pkce",
        },
      });
    })();
    client = loading;
    loading.catch(() => {
      if (client === loading) client = undefined;
    });
  }
  return client;
}

type RequestOptions = { method?: string; body?: unknown };
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Invalid API path.");
  const sb = await getSupabase();
  async function send(retry: boolean): Promise<T> {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    const session = data.session;
    const response = await fetchWithTimeout(`${apiOrigin()}/api${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const current = (await sb.auth.getSession()).data.session;
    // An in-flight request from a previous player must not populate the next player's screen.
    if (session?.user.id !== current?.user.id) throw new Error("Your account changed. Try again.");
    if (response.status === 401) {
      // An old token can be rejected while its replacement is already valid. Don't sign that session out.
      if (session?.access_token !== current?.access_token) {
        if (retry) return send(false);
        throw new Error("Your session changed. Try again.");
      }
      if (current) await sb.auth.signOut({ scope: "local" });
      throw new Error("Your session ended. Sign in again.");
    }
    const value = response.status === 204 ? undefined : await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        typeof value?.error === "string" ? value.error : "Something went wrong. Try again.",
        response.status,
      );
    if (value === null) throw new Error("POW Pick’em returned an unreadable response. Try again.");
    return value as T;
  }
  return send(true);
}
