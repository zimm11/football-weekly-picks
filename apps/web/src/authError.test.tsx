import { describe, expect, it } from "vitest";
import { readAuthError } from "./authError";

describe("readAuthError", () => {
  it("finds nothing in a URL without an error", () => {
    expect(readAuthError("", "?next=1")).toBeUndefined();
    expect(readAuthError("#access_token=abc", "")).toBeUndefined();
  });

  it("explains an expired email link from the fragment", () => {
    expect(
      readAuthError(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid",
        "",
      ),
    ).toEqual({
      message: "That reset link has expired or was already used. Request a new one below.",
      search: "",
    });
  });

  it("shows a failed Google sign-in's description from the query and keeps other parameters", () => {
    expect(
      readAuthError(
        "",
        "?ref=x&error=access_denied&error_code=bad_oauth&error_description=The+user+cancelled",
      ),
    ).toEqual({ message: "The user cancelled", search: "?ref=x" });
  });

  it("falls back to a generic message when there is no description", () => {
    expect(readAuthError("", "?error=server_error")).toEqual({
      message: "Sign-in didn't work. Try again.",
      search: "",
    });
    expect(readAuthError("#error=access_denied", "")?.message).toBe(
      "That link didn't work. Request a new one below.",
    );
  });
});
