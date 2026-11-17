import { z } from "zod";

/** Restrict sends to known browser push services; subscriptions must never become arbitrary API fetches. */
export function isPushEndpoint(value: string): boolean {
  return (
    z.url().safeParse(value).success &&
    /^https:\/\/(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)+push\.apple\.com|(?:[a-z0-9-]+\.)+notify\.windows\.com)\/[^\s#]+$/i.test(
      value,
    )
  );
}

export const pushEndpointSchema = z.string().max(2048).refine(isPushEndpoint, "Unsupported push service.");
/**
 * A device's notification switches. `leagueEvents` (results and updates) is optional so clients from before it
 * keep working: a device they save keeps its current value, and a new one starts with it on.
 */
export const pushPreferencesSchema = z.object({
  newThreads: z.boolean(),
  pickReminders: z.boolean(),
  leagueEvents: z.boolean().optional(),
});
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/, "Invalid push key."),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/, "Invalid push secret."),
  }),
  ...pushPreferencesSchema.shape,
  /**
   * The subscription this one replaces, when the browser swapped it out on its own. The server drops that row
   * (if it is this player's) and keeps its preferences. Optional, so older clients still work.
   */
  oldEndpoint: pushEndpointSchema.optional(),
});
export const pushDeviceSchema = z.object({ endpoint: pushEndpointSchema });
/** A device's switches as a client holds them. `leagueEvents` is absent in what older clients stored: read it as on. */
export type PushPreferences = { newThreads: boolean; pickReminders: boolean; leagueEvents?: boolean };
export type PushSettings = { configured: boolean; publicKey: string | null };
export type PushDevice = { id: string; newThreads: boolean; pickReminders: boolean; leagueEvents: boolean };
export type PushPayload = { title: string; body: string; url: string; tag: string };

/** Native tokens are opaque Expo destinations, never arbitrary fetch URLs. */
export const expoPushTokenSchema = z
  .string()
  .max(256)
  .regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{1,200}\]$/, "Invalid Expo push token.");
export const nativePushDeviceSchema = z.object({ token: expoPushTokenSchema });
export const nativePushSubscriptionSchema = nativePushDeviceSchema.extend({
  ...pushPreferencesSchema.shape,
  oldToken: expoPushTokenSchema.optional(),
});
