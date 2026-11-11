import type { Sql } from "postgres";

/** Parse without ever attaching the credential-bearing input to an error. */
export function parseDatabaseUrl(value: string): URL {
  if (/\s/.test(value)) throw new Error("Database URL contains a line break, tab or space.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Database URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) {
    throw new Error("Database URL must be a valid PostgreSQL URL.");
  }
  // URL routing overrides must not turn a loopback TLS exemption into a remote connection.
  if (["host", "hostaddr", "port"].some((key) => url.searchParams.has(key))) {
    throw new Error("Put the database host and port in the URL authority, not query parameters.");
  }
  return url;
}

/** Shared by the API and deployment diagnostic. URL options cannot disable remote TLS. */
export function databaseOptions(value: string) {
  const url = parseDatabaseUrl(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const supabase =
    url.hostname.endsWith(".pooler.supabase.com") || /^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname);
  return {
    prepare: false as const,
    ssl: local ? (false as const) : { rejectUnauthorized: true, ...(supabase ? { ca: SUPABASE_CA } : {}) },
    // Server notices can contain SQL values, just like query errors.
    onnotice: () => {},
  };
}

/** Verify both the client link and the database leg behind a pooler before serving requests. */
export async function checkDatabaseConnection(client: Sql, value: string) {
  const url = parseDatabaseUrl(value);
  await client`select 1`;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    const [row] = await client`select ssl from pg_stat_ssl where pid = pg_backend_pid()`;
    if (row?.ssl !== true) {
      throw Object.assign(new Error("The pooler database connection requires TLS."), {
        code: "DATABASE_TLS_REQUIRED",
      });
    }
  }
}

// Public Supabase Root 2021 CA, not a private key. Scoped to Supabase database hosts above.
// Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
// PEM SHA256: 700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7
export const SUPABASE_CA = `-----BEGIN CERTIFICATE-----
MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL
BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l
dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh
c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow
azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD
YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug
Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW
QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q
DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2
GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi
cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4
O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt
NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX
uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt
aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU
tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b
VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6
jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx
Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2
CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P
o/bKiIz+Fq8=
-----END CERTIFICATE-----`;
