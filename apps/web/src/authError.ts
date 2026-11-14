const ERROR_KEYS = ["error", "error_code", "error_description"];

/**
 * Supabase sends people back with the reason a sign-in failed in the URL: an expired or already-used email link
 * in the fragment (`#error=access_denied&error_code=otp_expired&error_description=...`), a cancelled or failed
 * Google sign-in in the fragment or the query string. Returns the message to show and the query string to keep
 * (the error parameters removed), or undefined when the URL carries no error.
 */
export function readAuthError(hash: string, search: string): { message: string; search: string } | undefined {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const query = new URLSearchParams(search);
  const params = fragment.has("error") ? fragment : query.has("error") ? query : undefined;
  if (!params) return undefined;
  // Read before clearing: `params` may be `query`.
  const code = params.get("error_code");
  const description = params.get("error_description");
  for (const key of ERROR_KEYS) query.delete(key);
  const message =
    code === "otp_expired"
      ? "That reset link has expired or was already used. Request a new one below."
      : (description ??
        (params === query
          ? "Sign-in didn't work. Try again."
          : "That link didn't work. Request a new one below."));
  return { message, search: query.size ? `?${query}` : "" };
}
