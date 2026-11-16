import { profiles } from "@picks/db";
import {
  type Me,
  type NotificationSettings,
  updateNotificationsSchema,
  updateProfileSchema,
} from "@picks/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { type AuthVariables, requireAuth } from "./auth";
import { type AppDeps, body, fail, isOperator } from "./context";
import { leagueRoutes } from "./leagues";
import { logError, requestLogger } from "./logging";
import { messageRoutes } from "./messages";
import { operatorRoutes } from "./operator";
import { pushRoutes } from "./push";
import { unsubscribeRoutes } from "./unsubscribe";
import { weekRoutes } from "./weeks";

export type { AppDeps } from "./context";

/** Largest request body accepted. The biggest real one, a 5,000-character message, is well under it. */
export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Headers on every API response. The API only answers JSON, so nothing may frame it, run it as script or load it
 * cross-site. HSTS is six months for this host only: no `includeSubDomains`, no preload.
 */
const apiSecurityHeaders = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
  strictTransportSecurity: "max-age=15552000",
  xFrameOptions: "DENY",
  referrerPolicy: "no-referrer",
});

/** Responses carry players' own data, so nothing caches them unless a route says otherwise. */
const noStoreByDefault = createMiddleware(async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

/** Refuses oversized bodies before they are read, so a huge post can't eat the request's CPU budget. */
const requestBodyLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ error: "That request is too large." }, 413),
});

const notificationsOf = (profile?: typeof profiles.$inferSelect): NotificationSettings => ({
  newThreads: profile?.emailNewThreads ?? true,
  pickReminders: profile?.emailPickReminders ?? true,
});

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
      const me: Me = {
        ...c.var.user,
        displayName: profile?.displayName ?? null,
        isOperator: isOperator(deps, c.var.user.id),
        notifications: notificationsOf(profile),
      };
      return c.json(me);
    })
    .put("/me", auth, body(updateProfileSchema), async (c) => {
      const { displayName } = c.req.valid("json");
      const [profile] = await db
        .insert(profiles)
        .values({ userId: c.var.user.id, displayName })
        .onConflictDoUpdate({ target: profiles.userId, set: { displayName } })
        .returning();
      const me: Me = {
        ...c.var.user,
        displayName,
        isOperator: isOperator(deps, c.var.user.id),
        notifications: notificationsOf(profile),
      };
      return c.json(me);
    })
    .put("/me/notifications", auth, body(updateNotificationsSchema), async (c) => {
      const { newThreads, pickReminders } = c.req.valid("json");
      const [profile] = await db
        .update(profiles)
        .set({ emailNewThreads: newThreads, emailPickReminders: pickReminders })
        .where(eq(profiles.userId, c.var.user.id))
        .returning();
      if (!profile) fail(409, "Choose a display name first.");
      return c.json(notificationsOf(profile));
    })
    .route("/", leagueRoutes(deps))
    .route("/", weekRoutes(deps))
    .route("/", messageRoutes(deps))
    .route("/", operatorRoutes(deps))
    .route("/", unsubscribeRoutes(deps))
    .route("/", pushRoutes(deps));

  const app = new Hono<{ Variables: AuthVariables }>()
    .use(requestLogger)
    .use(apiSecurityHeaders)
    .use(noStoreByDefault)
    .use(requestBodyLimit)
    .route("/api", api);
  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    logError("request", err, c.get("requestId"));
    return c.json({ error: "Internal server error" }, 500);
  });
  return app;
}

/** Typed client contract: `hc<ApiType>(baseUrl)` from "hono/client" in web/mobile. */
export type ApiType = ReturnType<typeof createApp>;
