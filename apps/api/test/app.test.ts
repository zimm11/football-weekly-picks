import { createDb, examples } from "@picks/db";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };
const TEST_USER = "00000000-0000-4000-8000-000000000001";
// Tests inject a fake verifier: the token *is* the user id.
const verifyToken = async (token: string) => (token === TEST_USER ? { id: token } : null);
const authed = { Authorization: `Bearer ${TEST_USER}`, "Content-Type": "application/json" };

describe("without a database", () => {
  const app = createApp({ db: {} as never, verifyToken, publicConfig });

  it("rejects requests without a token", async () => {
    expect((await app.request("/api/me")).status).toBe(401);
  });

  it("rejects requests with an invalid token", async () => {
    const res = await app.request("/api/me", { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it("returns the authenticated user", async () => {
    const res = await app.request("/api/me", { headers: authed });
    expect(await res.json()).toEqual({ id: TEST_USER });
  });

  it("reports the database as down when it is unreachable", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(503);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("with a database (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL ?? "");
  const app = createApp({ db, verifyToken, publicConfig });

  // Only touch rows this suite creates.
  beforeAll(async () => {
    await db.execute(
      sql`insert into auth.users (id, email) values (${TEST_USER}, 'api-test@example.com') on conflict do nothing`,
    );
    await db.delete(examples).where(eq(examples.userId, TEST_USER));
  });

  afterAll(async () => {
    await db.delete(examples).where(eq(examples.userId, TEST_USER));
    await db.$close();
  });

  it("reports healthy", async () => {
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({ ok: true, db: "up" });
  });

  it("creates and lists the user's examples", async () => {
    const created = await app.request("/api/examples", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ title: "  first  " }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ title: "first" });

    const list = await app.request("/api/examples", { headers: authed });
    expect(await list.json()).toMatchObject([{ title: "first" }]);
  });

  it("validates input", async () => {
    const res = await app.request("/api/examples", {
      method: "POST",
      headers: authed,
      body: JSON.stringify({ title: "" }),
    });
    expect(res.status).toBe(400);
  });
});
