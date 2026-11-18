/**
 * Plain words for what Supabase Auth reports, so a player never reads its raw text ("Invalid login
 * credentials", "PKCE code verifier not found in storage…"). Errors are matched by their code first, then by
 * their name, then by the words older Auth servers send without a code.
 */

/** What an Auth failure carries: `AuthError` from supabase-js, or the `error_code`/`error_description` of a link. */
type AuthFailure = { name?: unknown; code?: unknown; message?: unknown; status?: unknown };

export const AUTH_MESSAGES = {
  credentials: "That email and password don't match.",
  invalidEmail: "Enter a valid email address.",
  registered: "There's already an account for that email. Sign in instead.",
  samePassword: "Choose a password you haven't used here before.",
  weakPassword: "Choose a stronger password: at least six characters, and not a common one.",
  rateLimit: "Too many tries. Wait a minute, then try again.",
  expired: "That link has expired or was already used. Ask for a new one.",
  otherBrowser: "Open this link in the same browser you asked for it in, or ask for a new one.",
  network: "Can't reach POW Pick'em. Check your connection.",
  unconfirmed: "Confirm your email first: open the link we sent you, then sign in.",
  generic: "Something went wrong. Try again.",
} as const;

const BY_CODE: Record<string, string> = {
  invalid_credentials: AUTH_MESSAGES.credentials,
  email_address_invalid: AUTH_MESSAGES.invalidEmail,
  user_already_exists: AUTH_MESSAGES.registered,
  email_exists: AUTH_MESSAGES.registered,
  same_password: AUTH_MESSAGES.samePassword,
  weak_password: AUTH_MESSAGES.weakPassword,
  over_email_send_rate_limit: AUTH_MESSAGES.rateLimit,
  over_request_rate_limit: AUTH_MESSAGES.rateLimit,
  otp_expired: AUTH_MESSAGES.expired,
  flow_state_expired: AUTH_MESSAGES.expired,
  flow_state_not_found: AUTH_MESSAGES.expired,
  pkce_code_verifier_not_found: AUTH_MESSAGES.otherBrowser,
  bad_code_verifier: AUTH_MESSAGES.otherBrowser,
  email_not_confirmed: AUTH_MESSAGES.unconfirmed,
  request_timeout: AUTH_MESSAGES.network,
};

const BY_WORDS: [RegExp, string][] = [
  [/invalid login credentials/i, AUTH_MESSAGES.credentials],
  [/already (been )?registered|already exists/i, AUTH_MESSAGES.registered],
  [/different from the old password/i, AUTH_MESSAGES.samePassword],
  [/password should (be|contain)|weak password/i, AUTH_MESSAGES.weakPassword],
  [/validate email|invalid format|email address .*invalid/i, AUTH_MESSAGES.invalidEmail],
  [/rate limit|too many requests|only request this after/i, AUTH_MESSAGES.rateLimit],
  [/code verifier/i, AUTH_MESSAGES.otherBrowser],
  [/expired|invalid or has expired|already (been )?used|not found/i, AUTH_MESSAGES.expired],
  [/not confirmed/i, AUTH_MESSAGES.unconfirmed],
  [/failed to fetch|network|load failed|can.t reach/i, AUTH_MESSAGES.network],
];

/** supabase-js marks its errors `__isAuthError`; their names (and `AuthLinkError`'s) start with "Auth". */
const isAuthFailure = (error: unknown): error is AuthFailure =>
  typeof error === "object" &&
  error !== null &&
  ((error as { __isAuthError?: unknown }).__isAuthError === true ||
    String((error as { name?: unknown }).name ?? "").startsWith("Auth"));

/** A failure an emailed link reported in its address (`error_code`, `error_description`). */
export class AuthLinkError extends Error {
  constructor(
    readonly code: string | null,
    description: string | null,
  ) {
    super(description ?? "");
    this.name = "AuthLinkError";
  }
}

/**
 * The plain-words message for a failed Auth call or emailed link. Anything that isn't from Auth (the app's own
 * checks, "Enter your email.") keeps its message; an Auth failure this doesn't know gets the generic sentence.
 */
export function authMessage(error: unknown): string {
  if (!isAuthFailure(error))
    return error instanceof Error && error.message ? error.message : AUTH_MESSAGES.generic;
  const code = typeof error.code === "string" ? error.code : "";
  if (BY_CODE[code]) return BY_CODE[code];
  if (error.name === "AuthPKCECodeVerifierMissingError") return AUTH_MESSAGES.otherBrowser;
  if (error.name === "AuthWeakPasswordError") return AUTH_MESSAGES.weakPassword;
  if (error.name === "AuthRetryableFetchError") return AUTH_MESSAGES.network;
  const words = typeof error.message === "string" ? error.message : "";
  for (const [pattern, message] of BY_WORDS) if (pattern.test(words)) return message;
  if (error.status === 429) return AUTH_MESSAGES.rateLimit;
  return AUTH_MESSAGES.generic;
}

/** An Auth failure as an `Error` carrying the plain words, for code that shows `error.message`. */
export function authFailure(error: unknown): Error {
  return new Error(authMessage(error));
}
