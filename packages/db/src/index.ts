import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { checkDatabaseConnection, databaseOptions } from "./connection";
import * as schema from "./schema";

export { databaseOptions, parseDatabaseUrl } from "./connection";
export * from "./schema";
export { schema };

function wrap(client: Sql, url: string, requireTls?: boolean) {
  return Object.assign(drizzle({ client, schema, casing: "snake_case" }), {
    $close: () => client.end(),
    $check: () => checkDatabaseConnection(client, url, requireTls),
  });
}

/** A long-lived pool for a Node process (local dev, tests). */
export function createDb(url: string) {
  // prepare: false keeps this compatible with Supabase's transaction-mode pooler.
  return wrap(postgres(url, databaseOptions(url)), url);
}

/**
 * One request's connection through Cloudflare Hyperdrive, which keeps the real pool. Create one per request
 * and close it when the request ends. Hyperdrive verifies the database's certificate on its side (the config
 * is created with `--sslmode verify-full` and the Supabase CA), so the Worker-to-Hyperdrive hop takes no TLS
 * options. `$check` still confirms the database leg is encrypted, unless `requireTls` is false: `wrangler dev`
 * stands in for Hyperdrive with a plain connection to the local database.
 */
export function createHyperdriveDb(connectionString: string, { requireTls }: { requireTls: boolean }) {
  const client = postgres(connectionString, {
    // Hyperdrive supports prepared statements and handles them more reliably than unnamed ones.
    prepare: true,
    // No array or custom column types, so skip the type-lookup round trip on each new connection.
    fetch_types: false,
    // Workers cap concurrent outbound connections per request.
    max: 5,
    // Server notices can contain SQL values, just like query errors.
    onnotice: () => {},
  });
  return wrap(client, connectionString, requireTls);
}

export type Db = ReturnType<typeof createDb>;
