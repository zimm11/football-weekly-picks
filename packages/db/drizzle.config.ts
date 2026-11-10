import { defineConfig } from "drizzle-kit";

// Drizzle generates SQL into supabase/migrations; the Supabase CLI applies it
// (`pnpm db:reset` locally, `supabase db push` in production).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "../../supabase/migrations",
  migrations: { prefix: "supabase" },
  schemaFilter: ["public"],
  casing: "snake_case",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  },
});
