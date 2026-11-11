/** Browser captures must never run against a production database or authentication service. */
export function assertLocalTestEnv(env: Record<string, string | undefined>) {
  for (const name of ["DATABASE_URL", "SUPABASE_URL"] as const) {
    let url: URL;
    try {
      url = new URL(env[name] ?? "");
    } catch {
      throw new Error(`E2E requires a local ${name}. Run pnpm env:local first.`);
    }
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      ["host", "hostaddr", "port"].some((key) => url.searchParams.has(key))
    ) {
      throw new Error(`E2E requires a local ${name}; remote services are not allowed.`);
    }
  }
}
