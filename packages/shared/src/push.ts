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
export const pushPreferencesSchema = z.object({ newThreads: z.boolean(), pickReminders: z.boolean() });
export const pushSubscriptionSchema = z.object({
  endpoint: pushEndpointSchema,
  keys: z.object({
    p256dh: z.string().regex(/^B[A-Za-z0-9_-]{86}$/, "Invalid push key."),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/, "Invalid push secret."),
  }),
  ...pushPreferencesSchema.shape,
});
export const pushDeviceSchema = z.object({ endpoint: pushEndpointSchema });
export type PushPreferences = z.infer<typeof pushPreferencesSchema>;
export type PushSettings = { configured: boolean; publicKey: string | null };
export type PushDevice = PushPreferences & { id: string };
export type PushPayload = { title: string; body: string; url: string; tag: string };
