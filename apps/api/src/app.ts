import { profiles } from "@picks/db";
import { type Me, updateProfileSchema } from "@picks/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type AuthVariables, requireAuth } from "./auth";
import { type AppDeps, body } from "./context";
import { leagueRoutes } from "./leagues";
import { logError, requestLogger } from "./logging";
import { weekRoutes } from "./weeks";

export type { AppDeps } from "./context";

export function createApp(deps: AppDeps) {
  const { db, verifyToken, publicConfig } = deps;
  const auth = requireAuth(verifyToken);

  // Keep everything chained (and sub-apps mounted with `.route`), or `ApiType` loses the route types.
  const api = new Hono<{ Variables: AuthVariables }>()
    .get("/health", async (c) => {
      try {
        await db.$check();
        return c.json({ ok: true, db: "up" as const });
      } catch (err) {
        logError("health", err, c.get("requestId"));
        return c.json({ ok: false, db: "down" as const }, 503);
      }
    })
    .get("/config", (c) => c.json(publicConfig))
    .get("/me", auth, async (c) => {
      const [profile] = await db.select().from(profiles).where(eq(profiles.userId, c.var.user.id));
      const me: Me = { ...c.var.user, displayName: profile?.displayName ?? null };
      return c.json(me);
    })
    .put("/me", auth, body(updateProfileSchema), async (c) => {
      const { displayName } = c.req.valid("json");
      await db
        .insert(profiles)
        .values({ userId: c.var.user.id, displayName })
        .onConflictDoUpdate({ target: profiles.userId, set: { displayName } });
      const me: Me = { ...c.var.user, displayName };
      return c.json(me);
    })
    .route("/", leagueRoutes(deps))
    .route("/", weekRoutes(deps));

  const app = new Hono<{ Variables: AuthVariables }>().use(requestLogger).route("/api", api);
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    logError("request", err, c.get("requestId"));
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}

/** Typed client contract: `hc<ApiType>(baseUrl)` from "hono/client" in web/mobile. */
export type ApiType = ReturnType<typeof createApp>;
