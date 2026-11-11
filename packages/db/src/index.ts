import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { checkDatabaseConnection, databaseOptions } from "./connection";
import * as schema from "./schema";

export { databaseOptions, parseDatabaseUrl } from "./connection";
export * from "./schema";
export { schema };

export function createDb(url: string) {
  // prepare: false keeps this compatible with Supabase's transaction-mode pooler.
  const client = postgres(url, databaseOptions(url));
  return Object.assign(drizzle({ client, schema, casing: "snake_case" }), {
    $close: () => client.end(),
    $check: () => checkDatabaseConnection(client, url),
  });
}

export type Db = ReturnType<typeof createDb>;
