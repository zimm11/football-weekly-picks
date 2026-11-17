/**
 * The API's origin. Only a public origin belongs here; auth credentials always come from the player's session.
 * Native builds call the address they were built with (production by default). The web build is served by
 * the same Worker as the API, so in a browser it calls its own origin unless a dev server named another.
 */
export function apiOrigin(
  value = process.env.EXPO_PUBLIC_API_URL ?? pageOrigin() ?? "https://www.pow-pickem.com",
) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("EXPO_PUBLIC_API_URL must be an HTTP(S) origin.");
  // The page's own origin is whatever served it, including a local Worker over http.
  if (!__DEV__ && url.protocol !== "https:" && url.origin !== pageOrigin())
    throw new Error("Release builds require an HTTPS API.");
  return url.origin;
}

/**
 * Where an emailed link (password reset, email confirmation) should open the app: this site in the web build,
 * the app's own scheme on a phone. Supabase Auth must list each as an allowed redirect.
 */
export function appLink(path: "/reset-password" | "/auth/callback" | "/account"): string {
  const origin = pageOrigin();
  return origin ? `${origin}${path}` : `pow-pickem:/${path}`;
}

/** The origin of the page running the web build; undefined in the native app, which has no page. */
export function pageOrigin(): string | undefined {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin?.startsWith("http") ? origin : undefined;
}

/**
 * A device-storage key for one server. Every local checkout shares Expo Go's storage and the same LAN host,
 * so keys carry the port too: switching worktrees must not hand one stack's session to another.
 * SecureStore allows only letters, digits, ".", "-" and "_".
 */
export function scopedKey(prefix: string, url: string) {
  return `${prefix}-${new URL(url).host.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}
