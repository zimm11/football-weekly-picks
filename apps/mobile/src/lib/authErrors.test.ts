import { describe, expect, it } from "vitest";
import { AUTH_MESSAGES, AuthLinkError, authFailure, authMessage } from "./authErrors";

/** The shape supabase-js gives its errors. */
const auth = (message: string, code?: string, name = "AuthApiError", status = 400) =>
  Object.assign(new Error(message), { __isAuthError: true, name, code, status });

describe("plain words for Auth failures", () => {
  it("maps the failures players meet by their code", () => {
    expect(authMessage(auth("Invalid login credentials", "invalid_credentials"))).toBe(
      "That email and password don't match.",
    );
    expect(
      authMessage(auth("Unable to validate email address: invalid format", "email_address_invalid")),
    ).toBe(AUTH_MESSAGES.invalidEmail);
    expect(authMessage(auth("User already registered", "user_already_exists"))).toBe(
      "There's already an account for that email. Sign in instead.",
    );
    expect(
      authMessage(auth("New password should be different from the old password.", "same_password")),
    ).toBe(AUTH_MESSAGES.samePassword);
    expect(authMessage(auth("Password should be at least 6 characters.", "weak_password"))).toBe(
      AUTH_MESSAGES.weakPassword,
    );
    expect(
      authMessage(auth("email rate limit exceeded", "over_email_send_rate_limit", "AuthApiError", 429)),
    ).toBe(AUTH_MESSAGES.rateLimit);
    expect(authMessage(auth("Email link is invalid or has expired", "otp_expired"))).toBe(
      "That link has expired or was already used. Ask for a new one.",
    );
  });

  it("explains an old link opened in another browser, never quoting the library", () => {
    const pkce = auth(
      "PKCE code verifier not found in storage. This can happen if the auth flow was initiated in a different browser or device, or if the storage was cleared. For SSR frameworks (Next.js, SvelteKit, etc.), use @supabase/ssr on both the server and client to store the code verifier in cookies.",
      "pkce_code_verifier_not_found",
      "AuthPKCECodeVerifierMissingError",
    );
    expect(authMessage(pkce)).toBe(
      "Open this link in the same browser you asked for it in, or ask for a new one.",
    );
    expect(authMessage({ ...pkce, code: undefined, __isAuthError: true })).toBe(AUTH_MESSAGES.otherBrowser);
  });

  it("falls back to the words when an older server sends no code", () => {
    expect(authMessage(auth("Invalid login credentials"))).toBe(AUTH_MESSAGES.credentials);
    expect(authMessage(auth("User already registered"))).toBe(AUTH_MESSAGES.registered);
    expect(authMessage(auth("Token has expired or is invalid"))).toBe(AUTH_MESSAGES.expired);
    expect(authMessage(auth("Too many requests", undefined, "AuthApiError", 429))).toBe(
      AUTH_MESSAGES.rateLimit,
    );
  });

  it("names a network failure, and hides anything unknown behind a generic sentence", () => {
    expect(authMessage(auth("Failed to fetch", undefined, "AuthRetryableFetchError", 0))).toBe(
      AUTH_MESSAGES.network,
    );
    expect(
      authMessage(auth("Database error saving new user", "unexpected_failure", "AuthApiError", 500)),
    ).toBe("Something went wrong. Try again.");
    expect(authMessage({ name: "AuthUnknownError", message: "boom" })).toBe(AUTH_MESSAGES.generic);
  });

  it("keeps the app's own messages, and reads link errors from the address", () => {
    expect(authMessage(new Error("Enter your email."))).toBe("Enter your email.");
    expect(authMessage("nope")).toBe(AUTH_MESSAGES.generic);
    expect(authMessage(new AuthLinkError("otp_expired", "Email link is invalid or has expired"))).toBe(
      AUTH_MESSAGES.expired,
    );
    expect(authMessage(new AuthLinkError(null, "Link expired"))).toBe(AUTH_MESSAGES.expired);
    expect(authMessage(new AuthLinkError(null, null))).toBe(AUTH_MESSAGES.generic);
    expect(authFailure(auth("x", "invalid_credentials")).message).toBe(AUTH_MESSAGES.credentials);
  });
});
