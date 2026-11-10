import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * from "./schema";
export { schema };

export function createDb(url: string) {
  // prepare: false keeps this compatible with Supabase's transaction-mode pooler.
  const client = postgres(url, { prepare: false });
  return Object.assign(drizzle({ client, schema, casing: "snake_case" }), { $close: () => client.end() });
}

export type Db = ReturnType<typeof createDb>;
