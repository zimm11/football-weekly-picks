import { describe, expect, it } from "vitest";
import { AUTH_MESSAGES } from "./authErrors";
import { authCallback, BAD_LINK, internalPath, nextPath, withNext } from "./links";

describe("native link boundaries", () => {
  it("accepts both custom scheme callback forms and HTTPS recovery links", () => {
    for (const url of [
      "pow-pickem://auth/callback?code=abc",
      "pow-pickem:///auth/callback?code=abc",
      "https://www.pow-pickem.com/auth/callback?code=abc",
    ])
      expect(authCallback(url)?.code).toBe("abc");
    expect(authCallback("pow-pickem://reset-password?code=abc")?.recovery).toBe(true);
  });
  it("supports a paired implicit session only on a callback route", () => {
    expect(
      authCallback("pow-pickem://auth/callback#access_token=access&refresh_token=refresh&type=recovery"),
    ).toMatchObject({ accessToken: "access", refreshToken: "refresh", recovery: true });
    expect(authCallback("pow-pickem://leagues/abc#access_token=access&refresh_token=refresh")).toBeNull();
  });
  it("refuses lookalike hosts, embedded credentials, ports and arbitrary schemes", () => {
    for (const url of [
      "https://www.pow-pickem.com.evil.test/auth/callback?code=abc",
      "https://user@www.pow-pickem.com/auth/callback?code=abc",
      "https://www.pow-pickem.com:8443/auth/callback?code=abc",
      "http://www.pow-pickem.com/auth/callback?code=abc",
      "evil://auth/callback?code=abc",
      "not a url",
    ])
      expect(authCallback(url)).toBeNull();
  });
  it("surfaces expired or denied callback errors in plain words", () => {
    expect(
      authCallback("pow-pickem://reset-password#error=denied&error_description=Link+expired")?.error,
    ).toBe(AUTH_MESSAGES.expired);
    expect(
      authCallback(
        "https://www.pow-pickem.com/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired",
      )?.error,
    ).toBe("That link has expired or was already used. Ask for a new one.");
    expect(authCallback("pow-pickem://reset-password?error=denied")?.error).toBe(BAD_LINK);
    expect(
      authCallback(
        "https://www.pow-pickem.com/auth/callback?error=server_error&error_description=Something+odd",
      )?.error,
    ).toBe(BAD_LINK);
    expect(authCallback("https://www.pow-pickem.com/auth/callback?code=abc")?.error).toBeNull();
  });
  it("reads token-hash links from the query or the fragment, with an allowlisted type", () => {
    expect(
      authCallback("https://www.pow-pickem.com/reset-password#token_hash=h1&type=recovery"),
    ).toMatchObject({
      path: "/reset-password",
      tokenHash: "h1",
      type: "recovery",
      recovery: true,
      error: null,
    });
    expect(
      authCallback("https://www.pow-pickem.com/auth/callback?next=%2Fjoin%2Fabc#token_hash=h2&type=signup"),
    ).toMatchObject({ path: "/auth/callback", tokenHash: "h2", type: "signup", next: "/join/abc" });
    expect(authCallback("pow-pickem://account?token_hash=h3&type=email_change")).toMatchObject({
      path: "/account",
      tokenHash: "h3",
      type: "email_change",
    });
    // Auth falls back to the Site URL when a redirect isn't allowed: the root takes a token hash, nothing else.
    expect(authCallback("https://www.pow-pickem.com/#token_hash=h4&type=signup")).toMatchObject({
      path: "/",
      tokenHash: "h4",
    });
    expect(authCallback("https://www.pow-pickem.com/?code=abc")).toBeNull();
    expect(authCallback("pow-pickem://#token_hash=h4&type=signup")).toBeNull();
    // A type the app doesn't verify is a broken link, never passed on.
    expect(authCallback("https://www.pow-pickem.com/auth/callback#token_hash=h5&type=sms")).toMatchObject({
      tokenHash: null,
      type: null,
      error: BAD_LINK,
    });
    expect(authCallback("https://www.pow-pickem.com/auth/callback?token_hash=h6")?.error).toBe(BAD_LINK);
  });
  it("notices the first of an email change's two confirmations", () => {
    expect(
      authCallback(
        "https://www.pow-pickem.com/account?message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email",
      ),
    ).toMatchObject({ otherAddress: true, error: null, code: null });
    expect(authCallback("https://www.pow-pickem.com/account?code=abc")?.otherAddress).toBe(false);
  });
  it("returns only to allowlisted in-app pages", () => {
    for (const path of ["/account", "/join/abc", "/leagues/abc", "/weeks/abc/manage", "/boards/abc"])
      expect(nextPath(path)).toBe(path);
    for (const path of [
      "https://evil.test",
      "//evil.test/account",
      "https://www.pow-pickem.com/account",
      "/account?x=1",
      "/operator",
      "/login",
      "/leagues/../operator",
      "javascript:alert(1)",
      "",
      null,
      ["/account"],
    ])
      expect(nextPath(path)).toBeNull();
    expect(
      authCallback("https://www.pow-pickem.com/auth/callback?code=a&next=https://evil.test")?.next,
    ).toBeNull();
    expect(withNext("https://www.pow-pickem.com/auth/callback", "/join/abc")).toBe(
      "https://www.pow-pickem.com/auth/callback?next=%2Fjoin%2Fabc",
    );
    expect(withNext("pow-pickem://auth/callback", "/join/abc")).toBe(
      "pow-pickem://auth/callback?next=%2Fjoin%2Fabc",
    );
    expect(withNext("/login?x=1", "/account")).toBe("/login?x=1&next=%2Faccount");
    expect(withNext("/login", "//evil.test")).toBe("/login");
    expect(withNext("/login", undefined)).toBe("/login");
  });
  it("allows only supported internal notification destinations", () => {
    for (const path of [
      // Everything the API sends: league events, reminders, new threads.
      "/leagues/abc",
      "/leagues/abc/messages",
      "/leagues/abc/messages/def",
      "/leagues/abc/results",
      "/leagues/abc/standings",
      "/leagues/abc/league",
      "/weeks/abc",
      "/weeks/abc/manage",
      "/boards/abc",
      "/boards/abc/manage",
      "/boards/11111111-1111-4111-8111-111111111111",
      "/join/abc",
    ]) {
      expect(internalPath(path)).toBe(path);
      expect(internalPath(`https://www.pow-pickem.com${path}`)).toBe(path);
    }
    for (const path of [
      "//evil.test",
      "/account",
      "/leagues/abc?token=secret",
      "https://www.pow-pickem.com/leagues/abc#x",
      "https://user@www.pow-pickem.com/weeks/abc",
      "/leagues/../account",
      "/boards",
      "/boards/abc/delete",
      "/boards/abc/manage/extra",
      "/boards/abc?next=https://evil.test",
      "/leagues/abc/settings",
      "/weeks/abc/picks",
      "/operator",
      "https://evil.test/boards/abc",
      "javascript:alert(1)",
      null,
      {},
    ])
      expect(internalPath(path)).toBeNull();
  });
});
