import { type Env, Hono, type Schema } from "hono";
import { cors } from "hono/cors";

/** Node development only: allow this checkout's Expo preview, never arbitrary browser origins. */
export function withLocalWeb<E extends Env, S extends Schema, P extends string>(
  app: Hono<E, S, P>,
  origin?: string,
) {
  if (!origin) return app;
  const port = new URL(origin).port;
  return new Hono<E>()
    .use(
      "/api/*",
      cors({
        origin: [origin, `http://localhost:${port}`, `http://127.0.0.1:${port}`],
        allowHeaders: ["Authorization", "Content-Type"],
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      }),
    )
    .route("/", app);
}
