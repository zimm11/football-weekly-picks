import { zValidator } from "@hono/zod-validator";
import { type Db, examples } from "@picks/db";
import { createExampleSchema, type Example } from "@picks/shared";
import { desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { type AuthVariables, requireAuth, type VerifyToken } from "./auth";

export type AppDeps = {
  db: Db;
  verifyToken: VerifyToken;
  /** Public config handed to clients at runtime (so the web build needs no baked-in env). */
  publicConfig: { supabaseUrl: string; supabasePublishableKey: string };
};

const toExample = (row: typeof examples.$inferSelect): Example => ({
  id: row.id,
  title: row.title,
  createdAt: row.createdAt.toISOString(),
});

export function createApp({ db, verifyToken, publicConfig }: AppDeps) {
  const auth = requireAuth(verifyToken);

  const api = new Hono<{ Variables: AuthVariables }>()
    .get("/health", async (c) => {
      try {
        await db.execute(sql`select 1`);
        return c.json({ ok: true, db: "up" as const });
      } catch (err) {
        // Log the reason (never the connection string) so a failing health check is diagnosable from host logs.
        console.error("Health check: database query failed:", err instanceof Error ? err.message : err);
        return c.json({ ok: false, db: "down" as const }, 503);
      }
    })
    .get("/config", (c) => c.json(publicConfig))
    .get("/me", auth, (c) => c.json(c.var.user))
    // PLACEHOLDER routes: replace with real domain routes.
    .get("/examples", auth, async (c) => {
      const rows = await db
        .select()
        .from(examples)
        .where(eq(examples.userId, c.var.user.id))
        .orderBy(desc(examples.createdAt));
      return c.json(rows.map(toExample));
    })
    .post("/examples", auth, zValidator("json", createExampleSchema), async (c) => {
      const [row] = await db
        .insert(examples)
        .values({ userId: c.var.user.id, title: c.req.valid("json").title })
        .returning();
      if (!row) throw new HTTPException(500, { message: "Insert failed" });
      return c.json(toExample(row), 201);
    });

  const app = new Hono().use(logger()).route("/api", api);
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}

/** Typed client contract: `hc<ApiType>(baseUrl)` from "hono/client" in web/mobile. */
export type ApiType = ReturnType<typeof createApp>;
