import { describe, expect, it } from "vitest";
import { authCallback, internalPath } from "./links";

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
  it("surfaces expired or denied callback errors", () => {
    expect(
      authCallback("pow-pickem://reset-password#error=denied&error_description=Link+expired")?.error,
    ).toBe("Link expired");
    expect(authCallback("pow-pickem://reset-password?error=denied")?.error).toContain("Request a new one");
  });
  it("allows only supported internal notification destinations", () => {
    for (const path of [
      "/leagues/abc",
      "/leagues/abc/messages/def",
      "/leagues/abc/results",
      "/weeks/abc",
      "/weeks/abc/manage",
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
      "javascript:alert(1)",
      null,
      {},
    ])
      expect(internalPath(path)).toBeNull();
  });
});
