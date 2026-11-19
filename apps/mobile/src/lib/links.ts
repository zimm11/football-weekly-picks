import { AUTH_MESSAGES, AuthLinkError, authMessage } from "./authErrors";
import { pageOrigin } from "./config";

/** The kinds of emailed link the app verifies itself (`verifyOtp`), and nothing else. */
const LINK_TYPES = ["signup", "email", "recovery", "email_change", "invite", "magiclink"] as const;
export type LinkType = (typeof LINK_TYPES)[number];
const isLinkType = (value: string | null): value is LinkType =>
  (LINK_TYPES as readonly (string | null)[]).includes(value);

/** Where emailed links land. The site's root takes only a token-hash link (Auth falls back to the Site URL). */
const LANDINGS = ["/reset-password", "/auth/callback", "/account"] as const;
export type LinkLanding = (typeof LANDINGS)[number] | "/";

/** A link failure that names nothing the app knows: a link cut short, or a code it doesn't recognize. */
export const BAD_LINK = "That link didn't work. Ask for a new one.";

/**
 * Reads an emailed link that opened the app: a token-hash link (`token_hash` + `type`, verified with
 * `verifyOtp`, in any browser), an older PKCE link (`?code=`, only where it was asked for), a paired implicit
 * session, or the error Auth sent instead. Only our own landing routes count; credentials are never accepted from
 * an arbitrary URL. `next` is where to go afterwards (validated by `nextPath`), `otherAddress` that Auth took one
 * of an email change's two confirmations and is waiting for the other.
 */
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
  const hash = new URLSearchParams(url.hash.slice(1));
  const read = (name: string) => url.searchParams.get(name) ?? hash.get(name);
  const rawType = read("type");
  const tokenHash = read("token_hash");
  const landing: LinkLanding | null = (LANDINGS as readonly string[]).includes(path)
    ? (path as LinkLanding)
    : !path && tokenHash && !ownScheme
      ? "/"
      : null;
  if (!landing) return null;
  const type = isLinkType(rawType) ? rawType : null;
  const errorCode = read("error_code");
  const description = read("error_description");
  const failed = !!(errorCode || description || read("error"));
  const mapped = failed ? authMessage(new AuthLinkError(errorCode, description)) : null;
  return {
    path: landing,
    code: url.searchParams.get("code"),
    /** Only with a type the app knows: a hash with anything else is a broken link (`error`). */
    tokenHash: type ? tokenHash : null,
    type,
    error:
      mapped && mapped !== AUTH_MESSAGES.generic ? mapped : failed || (tokenHash && !type) ? BAD_LINK : null,
    accessToken: hash.get("access_token"),
    refreshToken: hash.get("refresh_token"),
    recovery: landing === "/reset-password" || rawType === "recovery",
    otherAddress: /confirmation link accepted/i.test(read("message") ?? ""),
    next: nextPath(url.searchParams.get("next")),
  };
}
export type AuthCallback = NonNullable<ReturnType<typeof authCallback>>;

/** Pages a sign-in or an emailed link may return to besides the notification destinations below. */
const RETURN_PAGES = ["/account", "/leagues/new"];
/**
 * Pages with an id a sign-in may return to that no notification opens, so they stay out of `DESTINATION` (and
 * `push-sw.js`): a week's results so far, a commissioner's page.
 */
const RETURN_PATTERNS = [/^\/weeks\/[a-zA-Z0-9-]+\/progress$/];

/**
 * Where to go after signing in or opening an emailed link (`?next=`): an in-app path from the allowlist (a
 * league, week, board or invite, or Settings), never another site. Anything else is null.
 */
export function nextPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/")) return null;
  const path = value.replace(/\/$/, "") || "/";
  return RETURN_PAGES.includes(path) ||
    RETURN_PATTERNS.some((pattern) => pattern.test(path)) ||
    internalPath(value)
    ? value
    : null;
}

/** `link` carrying `next` (when it is a valid `nextPath`), for an emailed link's redirect or `/login`. */
export function withNext(link: string, next: string | null | undefined) {
  const path = nextPath(next);
  return path ? `${link}${link.includes("?") ? "&" : "?"}next=${encodeURIComponent(path)}` : link;
}

/**
 * Every in-app destination a notification may open, and nothing else (an allowlist against open redirects):
 * a league and its tabs, a thread, a week and its manage screen, a squares board and its manage screen, an
 * invite. Keep it in step with `safePath` in `public/push-sw.js` (the website's copy) and with the paths the
 * API puts in notifications (`path`/`url` in apps/api/src: leagueEvents, pushQueue, reminders, automation).
 * `/leagues/new` is the New league form, not a league, so no notification opens it.
 */
const DESTINATION =
  /^\/(?:leagues\/(?!new(?:\/|$))[a-zA-Z0-9-]+(?:\/(?:messages(?:\/[a-zA-Z0-9-]+)?|results|standings|league))?|weeks\/[a-zA-Z0-9-]+(?:\/manage)?|boards\/[a-zA-Z0-9-]+(?:\/manage)?|join\/[a-zA-Z0-9-]+)\/?$/;

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
  return DESTINATION.test(path) ? path : null;
}
