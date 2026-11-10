import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

/*
 * Source of truth for the database schema.
 * After editing: `pnpm db:generate --name <desc>` → review the SQL in supabase/migrations → `pnpm db:reset`.
 *
 * Every table has RLS enabled with no policies. The API connects as a privileged role and
 * bypasses RLS; this stops clients holding the public publishable key from reading or writing
 * tables directly through Supabase's auto-generated REST API.
 */

/** PLACEHOLDER table to exercise migrations, auth-scoped queries, and tests. Replace with real tables. */
export const examples = pgTable(
  "examples",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("examples_user_idx").on(t.userId)],
).enableRLS();
