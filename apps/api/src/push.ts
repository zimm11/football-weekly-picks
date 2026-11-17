import { pushSubscriptions } from "@picks/db";
import {
  nativePushDeviceSchema,
  nativePushSubscriptionSchema,
  type PushDevice,
  type PushSettings,
  pushDeviceSchema,
  pushSubscriptionSchema,
} from "@picks/shared";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthVariables, requireAuth } from "./auth";
import { type AppDeps, body, fail } from "./context";

export function pushRoutes({ db, verifyToken, push, nativePush }: AppDeps) {
  const auth = requireAuth(verifyToken);
  return new Hono<{ Variables: AuthVariables }>()
    .get("/push/config", auth, (c) =>
      c.json<PushSettings>({ configured: !!push, publicKey: push?.publicKey ?? null }),
    )
    .post("/push/device", auth, body(pushDeviceSchema), async (c) => {
      const [device] = await db
        .select({
          id: pushSubscriptions.id,
          newThreads: pushSubscriptions.newThreads,
          pickReminders: pushSubscriptions.pickReminders,
          leagueEvents: pushSubscriptions.leagueEvents,
        })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, c.var.user.id),
            eq(pushSubscriptions.endpoint, c.req.valid("json").endpoint),
          ),
        );
      return c.json<{ device: PushDevice | null }>({ device: device ?? null });
    })
    .put("/push/device", auth, body(pushSubscriptionSchema), async (c) => {
      if (!push) fail(503, "Notifications aren't available yet. Please try again later.");
      const value = c.req.valid("json");
      const device = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('push-device'), hashtext(${c.var.user.id}))`,
        );
        const devices = await tx
          .select({
            endpoint: pushSubscriptions.endpoint,
            newThreads: pushSubscriptions.newThreads,
            pickReminders: pushSubscriptions.pickReminders,
            leagueEvents: pushSubscriptions.leagueEvents,
          })
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, c.var.user.id));
        // A browser that replaced its subscription names the old one. Only this player's own row is swapped
        // out, so naming someone else's endpoint changes nothing.
        const replaced =
          value.oldEndpoint && value.oldEndpoint !== value.endpoint
            ? devices.find((d) => d.endpoint === value.oldEndpoint)
            : undefined;
        if (replaced) {
          await tx
            .delete(pushSubscriptions)
            .where(
              and(
                eq(pushSubscriptions.userId, c.var.user.id),
                eq(pushSubscriptions.endpoint, replaced.endpoint),
              ),
            );
        }
        // A client from before the third switch sends no `leagueEvents`: the device keeps what it has.
        const same = devices.find((d) => d.endpoint === value.endpoint);
        const preferences = replaced
          ? {
              newThreads: replaced.newThreads,
              pickReminders: replaced.pickReminders,
              leagueEvents: replaced.leagueEvents,
            }
          : {
              newThreads: value.newThreads,
              pickReminders: value.pickReminders,
              leagueEvents: value.leagueEvents ?? same?.leagueEvents ?? true,
            };
        const others = devices.filter((d) => d !== replaced);
        if (others.length >= 10 && !others.some((d) => d.endpoint === value.endpoint))
          fail(409, "You can enable up to 10 devices. Disable notifications on another device first.");
        const [saved] = await tx
          .insert(pushSubscriptions)
          .values({
            userId: c.var.user.id,
            endpoint: value.endpoint,
            p256dh: value.keys.p256dh,
            auth: value.keys.auth,
            ...preferences,
          })
          .onConflictDoUpdate({
            target: pushSubscriptions.endpoint,
            set: {
              p256dh: value.keys.p256dh,
              auth: value.keys.auth,
              ...preferences,
            },
            setWhere: eq(pushSubscriptions.userId, c.var.user.id),
          })
          .returning({
            id: pushSubscriptions.id,
            newThreads: pushSubscriptions.newThreads,
            pickReminders: pushSubscriptions.pickReminders,
            leagueEvents: pushSubscriptions.leagueEvents,
          });
        if (!saved)
          fail(
            409,
            "This browser is subscribed to another account. Turn off notifications on this device and try again.",
          );
        return saved;
      });
      return c.json<{ device: PushDevice }>({ device });
    })
    .get("/push/native/config", auth, (c) => c.json({ configured: !!nativePush }))
    .post("/push/native/device", auth, body(nativePushDeviceSchema), async (c) => {
      const [device] = await db
        .select({
          id: pushSubscriptions.id,
          newThreads: pushSubscriptions.newThreads,
          pickReminders: pushSubscriptions.pickReminders,
          leagueEvents: pushSubscriptions.leagueEvents,
        })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, c.var.user.id),
            eq(pushSubscriptions.transport, "expo"),
            eq(pushSubscriptions.endpoint, c.req.valid("json").token),
          ),
        );
      return c.json<{ device: PushDevice | null }>({ device: device ?? null });
    })
    .put("/push/native/device", auth, body(nativePushSubscriptionSchema), async (c) => {
      if (!nativePush) fail(503, "Notifications aren't available yet. Please try again later.");
      const value = c.req.valid("json");
      const device = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('push-device'), hashtext(${c.var.user.id}))`,
        );
        const devices = await tx
          .select()
          .from(pushSubscriptions)
          .where(eq(pushSubscriptions.userId, c.var.user.id));
        const replaced =
          value.oldToken && value.oldToken !== value.token
            ? devices.find((d) => d.transport === "expo" && d.endpoint === value.oldToken)
            : undefined;
        const same = devices.find((d) => d.transport === "expo" && d.endpoint === value.token);
        const preferences = replaced
          ? {
              newThreads: replaced.newThreads,
              pickReminders: replaced.pickReminders,
              leagueEvents: replaced.leagueEvents,
            }
          : {
              newThreads: value.newThreads,
              pickReminders: value.pickReminders,
              leagueEvents: value.leagueEvents ?? same?.leagueEvents ?? true,
            };
        if (replaced)
          await tx
            .delete(pushSubscriptions)
            .where(and(eq(pushSubscriptions.id, replaced.id), eq(pushSubscriptions.userId, c.var.user.id)));
        const others = devices.filter((d) => d !== replaced);
        if (others.length >= 10 && !others.some((d) => d.endpoint === value.token))
          fail(409, "You can enable up to 10 devices. Disable notifications on another device first.");
        const [saved] = await tx
          .insert(pushSubscriptions)
          .values({
            userId: c.var.user.id,
            transport: "expo",
            endpoint: value.token,
            p256dh: "",
            auth: "",
            ...preferences,
          })
          .onConflictDoUpdate({
            target: pushSubscriptions.endpoint,
            set: { ...preferences },
            setWhere: and(
              eq(pushSubscriptions.userId, c.var.user.id),
              eq(pushSubscriptions.transport, "expo"),
            ),
          })
          .returning({
            id: pushSubscriptions.id,
            newThreads: pushSubscriptions.newThreads,
            pickReminders: pushSubscriptions.pickReminders,
            leagueEvents: pushSubscriptions.leagueEvents,
          });
        if (!saved)
          fail(
            409,
            "This device is subscribed to another account. Sign out of that account on this device first.",
          );
        return saved;
      });
      return c.json<{ device: PushDevice }>({ device });
    })
    .delete("/push/native/device", auth, body(nativePushDeviceSchema), async (c) => {
      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, c.var.user.id),
            eq(pushSubscriptions.transport, "expo"),
            eq(pushSubscriptions.endpoint, c.req.valid("json").token),
          ),
        );
      return c.json({ ok: true });
    })
    .delete("/push/device", auth, body(pushDeviceSchema), async (c) => {
      await db
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, c.var.user.id),
            eq(pushSubscriptions.endpoint, c.req.valid("json").endpoint),
          ),
        );
      return c.json({ ok: true });
    });
}
