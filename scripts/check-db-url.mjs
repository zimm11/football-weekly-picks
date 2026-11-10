#!/usr/bin/env node
// Checks a Postgres connection string without ever printing the password.
// Reports how the string parses, flags common mistakes, and tries a real connection.
//
//   pbpaste | node scripts/check-db-url.mjs        (macOS: check the string on your clipboard)
//   DB_URL=... node scripts/check-db-url.mjs
//   node scripts/check-db-url.mjs --quiet           (CI: print nothing about the password's shape)
import postgres from "../packages/db/node_modules/postgres/src/index.js";

const quiet = process.argv.includes("--quiet");

async function readInput() {
  if (process.env.DB_URL) return { raw: process.env.DB_URL, source: "DB_URL" };
  if (process.stdin.isTTY) {
    console.error("Pipe the connection string in, e.g. `pbpaste | node scripts/check-db-url.mjs`.");
    process.exit(2);
  }
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  return { raw, source: "stdin" };
}

const { raw, source } = await readInput();
if (quiet) {
  const first = raw.trimStart()[0];
  console.log(
    `  First character: ${first === undefined ? "(empty value)" : /[a-z]/i.test(first) ? "a letter" : JSON.stringify(first)}`,
  );
}
const problems = [];
const note = (msg) => problems.push(msg);

if (/^\s|\s$/.test(raw)) {
  note(
    `The value has leading or trailing whitespace (${JSON.stringify(raw.match(/^\s*/)[0])} … ${JSON.stringify(raw.match(/\s*$/)[0])}).`,
  );
}
const value = raw.trim();
if (/^["']|["']$/.test(value)) note("The value is wrapped in quotes. Store it without quotes.");
if (/^[A-Z_]+=/.test(value))
  note("The value starts with a variable name (e.g. `DATABASE_URL=`). Store only the URL.");

let url;
try {
  url = new URL(value.replace(/^["']|["']$/g, ""));
} catch {
  console.log(`Source: ${source}`);
  console.log("✗ Not a valid URL at all.");
  const text = value.replace(/^["']|["']$/g, "");
  if (!quiet) console.log(`  Length: ${text.length} characters, ${text.split("\n").length} line(s)`);
  else console.log(`  Lines: ${text.split("\n").length}`);
  const scheme = text.match(/^([a-z]+):\/\//i)?.[1];
  console.log(`  Starts with: ${scheme ? `${scheme}://` : "(no scheme; not a connection string?)"}`);
  if (scheme) {
    // Everything between "://" and the last "@" is user:password.
    const rest = text.slice(scheme.length + 3);
    const at = rest.lastIndexOf("@");
    if (at === -1) {
      note("There is no `@` separating the user and password from the host.");
    } else {
      const userinfo = rest.slice(0, at);
      const pw = userinfo.slice(userinfo.indexOf(":") + 1);
      const host = rest.slice(at + 1).split(/[:/?]/)[0];
      console.log(`  Host after the last @: ${host || "(empty)"}`);
      const bad = [..."/?#@[]:"].filter((ch) => pw.includes(ch));
      if (bad.length) {
        note(
          `The password contains ${bad.map((c) => `\`${c}\``).join(", ")}, which must be percent-encoded inside a URL. Either encode them (/ → %2F, ? → %3F, # → %23, @ → %40, : → %3A, [ → %5B, ] → %5D) or reset the password to letters and numbers only.`,
        );
      }
      if (/\s/.test(pw)) note("The password contains whitespace.");
    }
  }
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}

const rawPassword = (() => {
  // The password exactly as written in the string, before percent-decoding.
  const m = value.match(/^[a-z]+:\/\/[^:/@]*:(.*)@[^@]*$/i);
  return m ? m[1] : url.password;
})();
let password;
try {
  password = decodeURIComponent(rawPassword);
} catch {
  password = rawPassword;
  note("The password contains a `%` that isn't valid percent-encoding.");
}

console.log(`Source:   ${source}`);
console.log(`Scheme:   ${url.protocol.replace(":", "")}`);
console.log(`Host:     ${url.hostname}`);
console.log(`Port:     ${url.port || "(default 5432)"}`);
console.log(`User:     ${decodeURIComponent(url.username) || "(none)"}`);
console.log(`Database: ${url.pathname.slice(1) || "(none)"}`);

if (!["postgres:", "postgresql:"].includes(url.protocol)) note("The scheme should be postgresql://.");
if (!password) note("There is no password in the string.");
if (/YOUR[-_]?PASSWORD|\[.*\]|<.*>/i.test(rawPassword)) note("The password still looks like a placeholder.");
if (/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)) {
  note("This is Supabase's direct connection (IPv6 only). Use the session pooler string instead.");
}
if (url.hostname.endsWith("pooler.supabase.com") && !decodeURIComponent(url.username).includes(".")) {
  note("Pooler connections need the user `postgres.<project-ref>`, not just `postgres`.");
}
if (/%[0-9a-f]{2}/i.test(rawPassword)) {
  note(
    "The password contains percent-encoded characters (like %40). These are decoded before use, which is right only if you encoded them on purpose.",
  );
}

if (!quiet && password) {
  const kinds = [
    /[a-z]/.test(password) && "lowercase",
    /[A-Z]/.test(password) && "uppercase",
    /[0-9]/.test(password) && "digits",
    /[^a-zA-Z0-9]/.test(password) && "symbols",
  ].filter(Boolean);
  console.log(`Password: ${password.length} characters (${kinds.join(", ")}); never printed`);
  if (/\s/.test(password)) note("The password contains whitespace.");
}

const sql = postgres({
  host: url.hostname,
  port: Number(url.port || 5432),
  user: decodeURIComponent(url.username),
  password,
  database: url.pathname.slice(1) || "postgres",
  ssl: url.hostname === "127.0.0.1" || url.hostname === "localhost" ? false : "require",
  connect_timeout: 10,
  max: 1,
  onnotice: () => {},
});

let ok = false;
try {
  const [row] = await sql`select current_user as user, version() as version`;
  console.log(`✓ Connected as ${row.user} (${row.version.split(" ").slice(0, 2).join(" ")})`);
  ok = true;
} catch (err) {
  console.log(`✗ Connection failed: ${err.code ? `${err.code} ` : ""}${err.message}`);
} finally {
  await sql.end({ timeout: 1 });
}

if (problems.length) {
  console.log("Problems found:");
  for (const p of problems) console.log(`  - ${p}`);
}
process.exit(ok ? 0 : 1);
