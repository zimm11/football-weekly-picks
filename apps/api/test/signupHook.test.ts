import { createDb } from "@picks/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

// Supabase Auth's "Before User Created" hook (supabase/migrations/*_reject_test_signups.sql), which production
// turns on so a test that reaches it by mistake can't create an account or send a confirmation email.
describe.skipIf(!process.env.DATABASE_URL)("the sign-up hook (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  afterAll(() => db.$close());

  const decide = async (email: string | null) => {
    const event = { metadata: { name: "before-user-created" }, user: { email } };
    const rows = await db.execute<{ result: unknown }>(
      sql`select public.hook_reject_test_signups(${JSON.stringify(event)}::jsonb) as result`,
    );
    return rows[0]?.result;
  };
  const refused = { error: { http_code: 400, message: "This email address can't be used to sign up." } };

  it.each([
    "e2e-1794882889349-7m8bia@example.com",
    "someone@EXAMPLE.ORG",
    "someone@example.net",
    "someone@mail.example.com",
    "someone@example.com.",
    "someone@picks.test",
    "someone@test",
    "someone@site.example",
    "someone@nowhere.invalid",
    "someone@localhost",
  ])("refuses %s", async (email) => {
    expect(await decide(email)).toEqual(refused);
  });

  it.each([
    "player@gmail.com",
    "player@example.co.uk",
    "player@myexample.com",
    "player@contest.com",
    "player@testing.io",
    "player@example.com.au",
  ])("allows %s", async (email) => {
    expect(await decide(email)).toEqual({});
  });

  it("allows a sign-up without an email address", async () => {
    expect(await decide(null)).toEqual({});
  });

  it("can be called by Supabase Auth and by no client role", async () => {
    const rows = await db.execute<{ role: string; allowed: boolean }>(sql`
      select role, has_function_privilege(role, 'public.hook_reject_test_signups(jsonb)', 'execute') as allowed
      from unnest(array['supabase_auth_admin', 'anon', 'authenticated']) as role`);
    expect(Object.fromEntries(rows.map((r) => [r.role, r.allowed]))).toEqual({
      supabase_auth_admin: true,
      anon: false,
      authenticated: false,
    });
  });
});
