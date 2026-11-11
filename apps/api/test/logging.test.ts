import { DrizzleQueryError } from "drizzle-orm/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { loadEnv } from "../src/env";
import { logError } from "../src/logging";

const secret = "synthetic-private-value";
const publicConfig = { supabaseUrl: "https://test.invalid", supabasePublishableKey: "sb_publishable_test" };
const deps = {
  db: {} as never,
  verifyToken: async () => null,
  publicConfig,
  nfl: { getWeek: async () => [] },
};
afterEach(() => vi.restoreAllMocks());

describe("safe logging", () => {
  it("retains approved application messages and useful locations without dumping the stack", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const known = new Error("League insert returned no row");
    known.stack = `Error: ${secret}\n    at handler (/app/apps/api/src/leagues.ts:42:7)`;
    logError("request", known, "generated-id");
    const record = JSON.parse(log.mock.calls[0]?.[0]);
    expect(record).toMatchObject({ message: "League insert returned no row", location: "leagues.ts:42:7" });
    expect(JSON.stringify(record)).not.toContain(secret);
  });
  it("logs registered routes instead of invite codes, queries, headers, or unmatched paths", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const app = createApp(deps);
    const response = await app.request(`/api/invites/${secret}/join?access_token=${secret}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "X-Request-ID": secret },
    });
    await app.request(`/unknown/${secret}?password=${secret}`);
    expect(response.status).toBe(401);
    expect(response.headers.get("X-Request-ID")).toMatch(/^[a-f0-9-]{36}$/);
    const records = log.mock.calls.map(([line]) => JSON.parse(line));
    expect(records[0]).toMatchObject({ method: "POST", route: "/api/invites/:code/join", status: 401 });
    expect(records[0].requestId).toBe(response.headers.get("X-Request-ID"));
    expect(JSON.stringify(records)).not.toContain(secret);
  });

  it("drops query parameters, arbitrary error fields, and nested causes but keeps safe error codes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error(secret), { code: "28P01", input: secret });
    const error = new DrizzleQueryError("select * from leagues where invite_code=$1", [secret], cause);
    const app = createApp({
      ...deps,
      verifyToken: async () => ({ id: "user" }),
      db: {
        select() {
          throw error;
        },
        $check() {
          throw new Error(`postgresql://u:${secret}@db.invalid/db`);
        },
      } as never,
    });
    const failure = await app.request("/api/me", { headers: { Authorization: "Bearer test" } });
    const health = await app.request("/api/health");
    expect(failure.status).toBe(500);
    expect(health.status).toBe(503);
    expect(log.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        operation: "request",
        code: "28P01",
        message: "Database authentication failed.",
      }),
      expect.objectContaining({
        operation: "health",
        code: "UNKNOWN",
        message: "Database health check failed.",
      }),
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain("select *");
    expect(await failure.text()).not.toContain(secret);
    expect(await health.text()).not.toContain(secret);
  });
});

describe("public configuration guard", () => {
  const base = { DATABASE_URL: "postgresql://u:p@127.0.0.1/db", SUPABASE_URL: publicConfig.supabaseUrl };
  const legacy = (role: string) =>
    [
      Buffer.from('{"alg":"HS256"}').toString("base64url"),
      Buffer.from(JSON.stringify({ role })).toString("base64url"),
      "synthetic-signature",
    ].join(".");

  it("accepts publishable keys and legacy anon keys", () => {
    for (const key of [publicConfig.supabasePublishableKey, legacy("anon")]) {
      expect(loadEnv({ ...base, SUPABASE_PUBLISHABLE_KEY: key }).SUPABASE_PUBLISHABLE_KEY).toBe(key);
    }
  });

  it("rejects secret, service-role and malformed keys without including the key in the error", () => {
    for (const key of [
      ["sb", "secret", secret].join("_"),
      legacy("service_role"),
      secret,
      "bad.jwt.payload",
    ]) {
      try {
        loadEnv({ ...base, SUPABASE_PUBLISHABLE_KEY: key });
        expect.fail("A private or malformed key was accepted");
      } catch (error) {
        expect(String(error)).toContain("Use a publishable key or legacy anon key");
        expect(String(error)).not.toContain(key);
      }
    }
  });
});
