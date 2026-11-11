#!/usr/bin/env node
import postgres from "../packages/db/node_modules/postgres/src/index.js";
// Validate and connect with the API's TLS policy. Never log input values or arbitrary errors.
// DB_URL=... node scripts/check-db-url.mjs, or pipe a URL. --quiet remains accepted for CI.
import { checkDatabaseConnection, databaseOptions, parseDatabaseUrl } from "../packages/db/src/connection.ts";

let raw = process.env.DB_URL;
if (!raw) {
  if (process.stdin.isTTY) {
    console.error("Set DB_URL or pipe a PostgreSQL URL on stdin.");
    process.exit(2);
  }
  raw = "";
  for await (const chunk of process.stdin) raw += chunk;
}

let sql;
let ok = false;
try {
  const value = raw.trim();
  const url = parseDatabaseUrl(value);
  if (!url.password || /YOUR[-_]?PASSWORD|\[.*\]|<.*>/i.test(url.password)) {
    throw new Error("Missing password or placeholder.");
  }
  const options = databaseOptions(value);
  console.log(
    options.ssl ? "Checking database connection with verified TLS." : "Checking local database connection.",
  );
  sql = postgres(value, { ...options, connect_timeout: 10, max: 1 });
  await checkDatabaseConnection(sql, value);
  console.log("Database connection succeeded.");
  ok = true;
} catch (error) {
  console.error(
    error?.code === "DATABASE_TLS_REQUIRED"
      ? "Database check failed: pooler-to-database TLS is disabled. Enable database SSL enforcement."
      : "Database check failed. Verify the PostgreSQL URL, credentials, network access, and TLS certificate.",
  );
} finally {
  try {
    await sql?.end({ timeout: 1 });
  } catch {
    console.error("Database disconnect failed.");
    ok = false;
  }
}
process.exit(ok ? 0 : 1);
