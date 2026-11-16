import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { CONNECTION_ERROR, getSupabase, SESSION_ENDED, unwrap } from "./api";
import { StartError } from "./components/Splash";

afterEach(() => vi.restoreAllMocks());
const answer = (status: number, body: unknown) => Promise.resolve(Response.json(body, { status }));

describe("getSupabase", () => {
  it("doesn't keep a failed config load, so the next try asks again", async () => {
    const fetch = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(new Response("<h1>Error 1103</h1>", { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ supabaseUrl: "http://localhost:1", supabasePublishableKey: "k" }),
      );
    await expect(getSupabase()).rejects.toThrow("isn't available right now");
    await expect(getSupabase()).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("unwrap", () => {
  it("says to check the connection when a request gets no answer", async () => {
    await expect(unwrap(Promise.reject(new TypeError("Failed to fetch")))).rejects.toThrow(CONNECTION_ERROR);
  });

  it("asks to sign in again when the API turns the session away", async () => {
    await expect(unwrap(answer(401, { error: "Invalid or expired token" }))).rejects.toThrow(SESSION_ENDED);
  });

  it("carries the API's own message otherwise", async () => {
    await expect(unwrap(answer(409, { error: "That game has kicked off." }))).rejects.toThrow(
      "That game has kicked off.",
    );
    await expect(unwrap(answer(200, { ok: true }))).resolves.toEqual({ ok: true });
  });
});

describe("StartError", () => {
  it("explains why the app didn't open and offers another try", async () => {
    const onRetry = vi.fn();
    const screen = await render(<StartError message={CONNECTION_ERROR} onRetry={onRetry} />);
    await expect.element(screen.getByRole("heading", { name: "Can't open POW Pick'em" })).toBeVisible();
    await expect.element(screen.getByRole("alert")).toHaveTextContent(CONNECTION_ERROR);
    await screen.getByRole("button", { name: "Try again" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
