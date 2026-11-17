import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), getSession: vi.fn(), signOut: vi.fn() }));
vi.mock("react-native-url-polyfill/auto", () => ({}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  apiOrigin: () => "https://www.pow-pickem.com",
}));
const token = (id: string, access_token: string) => ({ user: { id }, access_token });
const config = () =>
  Response.json({ supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "public" });

describe("device storage keys", () => {
  it("separate local stacks that share a LAN host, and stay valid SecureStore keys", async () => {
    const { scopedKey } = await import("./config");
    expect(scopedKey("sb", "http://192.168.1.20:54331")).toBe("sb-192.168.1.20_54331");
    expect(scopedKey("sb", "http://192.168.1.20:54341")).not.toBe(
      scopedKey("sb", "http://192.168.1.20:54331"),
    );
    expect(scopedKey("sb", "https://abc.supabase.co")).toBe("sb-abc.supabase.co");
  });
});

describe("native API session isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({ auth: { getSession: mocks.getSession, signOut: mocks.signOut } });
    mocks.getSession.mockResolvedValue({ data: { session: token("a", "first") }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.unstubAllGlobals());
  it("sends the bearer token and JSON body to the shared API", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(config())
      .mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const { request } = await import("./api");
    expect(await request("/me", { method: "PUT", body: { displayName: "Pat" } })).toEqual({ ok: true });
    expect(fetch.mock.calls[1]).toMatchObject([
      "https://www.pow-pickem.com/api/me",
      {
        method: "PUT",
        headers: { Authorization: "Bearer first", "Content-Type": "application/json" },
        body: '{"displayName":"Pat"}',
      },
    ]);
  });
  it("rejects responses belonging to an account that has since signed out", async () => {
    mocks.getSession
      .mockResolvedValueOnce({ data: { session: token("a", "first") } })
      .mockResolvedValueOnce({ data: { session: token("b", "next") } });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(config())
        .mockResolvedValueOnce(Response.json({ private: "a" })),
    );
    const { request } = await import("./api");
    await expect(request("/me")).rejects.toThrow("Your account changed");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("retries a stale 401 with the refreshed token instead of ending the valid session", async () => {
    mocks.getSession
      .mockResolvedValueOnce({ data: { session: token("a", "first") } })
      .mockResolvedValue({ data: { session: token("a", "refreshed") } });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(config())
      .mockResolvedValueOnce(Response.json({ error: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ id: "a" }));
    vi.stubGlobal("fetch", fetch);
    const { request } = await import("./api");
    expect(await request("/me")).toEqual({ id: "a" });
    expect(fetch.mock.calls[2]?.[1].headers.Authorization).toBe("Bearer refreshed");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("ends a rejected current session locally", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(config())
        .mockResolvedValueOnce(Response.json({ error: "expired" }, { status: 401 })),
    );
    const { request } = await import("./api");
    await expect(request("/me")).rejects.toThrow("Your session ended");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("does not cache a failed startup configuration request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(config()),
    );
    const { getSupabase } = await import("./api");
    await expect(getSupabase()).rejects.toThrow("Check your connection");
    await expect(getSupabase()).resolves.toHaveProperty("auth");
  });
});
