import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { test } from "node:test";
import postgres from "postgres";
import {
  checkDatabaseConnection,
  databaseOptions,
  parseDatabaseUrl,
  SUPABASE_CA,
} from "../src/connection.ts";

test("remote startup checks reject an unencrypted pooler backend or an unavailable TLS status", async () => {
  for (const rows of [[{ ssl: false }], []]) {
    const client = async () => rows;
    await assert.rejects(() => checkDatabaseConnection(client, "postgresql://u:p@db.example.com/db"), {
      code: "DATABASE_TLS_REQUIRED",
    });
  }
  await assert.doesNotReject(() =>
    checkDatabaseConnection(async () => [{ ssl: true }], "postgresql://u:p@db.example.com/db"),
  );
  await assert.doesNotReject(() =>
    checkDatabaseConnection(async () => [{ ssl: false }], "postgresql://u:p@localhost/db"),
  );
});

test("Supabase hosts use the pinned public CA with verification; unrelated hosts retain default trust", () => {
  const cert = new X509Certificate(SUPABASE_CA);
  assert.equal(cert.ca, true);
  assert.equal(
    cert.fingerprint256,
    "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
  );
  assert.deepEqual(databaseOptions("postgresql://u:p@aws-0-us-east-1.pooler.supabase.com/db").ssl, {
    rejectUnauthorized: true,
    ca: SUPABASE_CA,
  });
  assert.deepEqual(databaseOptions("postgresql://u:p@pooler.supabase.com.attacker.invalid/db").ssl, {
    rejectUnauthorized: true,
  });
});

test("remote databases always negotiate certificate-verified TLS, including URL downgrade attempts", async () => {
  for (const suffix of ["", "?sslmode=disable", "?ssl=false", "?sslmode=require"]) {
    const url = `postgresql://u:p@db.example.com/db${suffix}`;
    const client = postgres(url, databaseOptions(url));
    assert.deepEqual(client.options.ssl, { rejectUnauthorized: true });
    await client.end();
  }
});

test("loopback databases retain local non-TLS support", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(databaseOptions(`postgresql://u:p@${host}/db`).ssl, false);
  }
  assert.deepEqual(databaseOptions("postgresql://u:p@localhost.example.com/db").ssl, {
    rejectUnauthorized: true,
  });
});

test("URL validation rejects routing overrides and never includes credential-bearing input in errors", () => {
  const secret = "synthetic-password";
  for (const value of [
    `not-a-url-${secret}`,
    `https://u:${secret}@db.example.com/db`,
    `postgresql://u:${secret}\n@db.example.com/db`,
    `postgresql://u:${secret}@localhost/db?host=remote.example.com`,
  ]) {
    assert.throws(
      () => parseDatabaseUrl(value),
      (error) => !String(error).includes(secret) && !error.input,
    );
  }
});
