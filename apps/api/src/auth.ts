import { createClient } from "@supabase/supabase-js";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

export type AuthUser = { id: string; email?: string };
export type VerifyToken = (token: string) => Promise<AuthUser | null>;

export type AuthVariables = { user: AuthUser };

/** Verifies Supabase access tokens (JWKS-backed via getClaims, falling back to the Auth server). */
export function supabaseTokenVerifier(supabaseUrl: string, publishableKey: string): VerifyToken {
  const supabase = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async (token) => {
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims.sub) return null;
    return { id: data.claims.sub, email: data.claims.email };
  };
}

export function requireAuth(verify: VerifyToken) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new HTTPException(401, { message: "Missing bearer token" });
    const user = await verify(token);
    if (!user) throw new HTTPException(401, { message: "Invalid or expired token" });
    c.set("user", user);
    await next();
  });
}
