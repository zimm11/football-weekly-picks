/** Only process tokens on our own callback routes; never accept credentials from an arbitrary URL. */
import { pageOrigin } from "./config";
export function authCallback(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || (url.port && url.origin !== pageOrigin())) return null;
  const ownScheme = url.protocol === "pow-pickem:";
  // The web build receives its links on its own address (production, or a local server).
  if (!ownScheme && url.origin !== "https://www.pow-pickem.com" && url.origin !== pageOrigin()) return null;
  // Expo/custom schemes may have either a host (scheme://auth/callback) or just a path.
  const path = (
    ownScheme ? `${url.hostname ? `/${url.hostname}` : ""}${url.pathname}` : url.pathname
  ).replace(/\/$/, "");
  if (!["/reset-password", "/auth/callback", "/account"].includes(path)) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  const code = url.searchParams.get("code");
  const error =
    url.searchParams.get("error_description") ??
    params.get("error_description") ??
    (url.searchParams.has("error") || params.has("error")
      ? "That sign-in link didn't work. Request a new one."
      : null);
  return {
    code,
    error,
    accessToken: params.get("access_token"),
    refreshToken: params.get("refresh_token"),
    recovery: path === "/reset-password" || params.get("type") === "recovery",
  };
}

/** Notification destinations have no query, fragment, credentials or external hosts. */
export function internalPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let path = value;
  if (value.startsWith("https://")) {
    try {
      const url = new URL(value);
      if (
        url.origin !== "https://www.pow-pickem.com" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        return null;
      path = url.pathname;
    } catch {
      return null;
    }
  }
  return /^\/(?:leagues\/[a-zA-Z0-9-]+(?:\/(?:messages(?:\/[a-zA-Z0-9-]+)?|results|standings|league))?|weeks\/[a-zA-Z0-9-]+(?:\/manage)?|join\/[a-zA-Z0-9-]+)\/?$/.test(
    path,
  )
    ? path
    : null;
}
