import type { PushPayload } from "@picks/shared";
import { isPushEndpoint } from "@picks/shared";
import { encryptPushPayload, type Vapid, vapidAuthorization } from "./webPush";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushSender = {
  publicKey: string;
  send(target: PushTarget, payload: PushPayload, ttl: number): Promise<"sent" | "gone" | "retry" | "failed">;
};

/**
 * Standards-based Web Push with this app's VAPID keys, not a paid notification vendor. Runs on WebCrypto and
 * fetch (`webPush.ts`), so the Worker can send. Never logs response bodies or endpoints: an endpoint is a
 * capability to notify that device.
 */
export function webPushSender(
  vapid: Vapid,
  fetchImpl: typeof fetch = fetch,
  now = () => new Date(),
): PushSender {
  return {
    publicKey: vapid.publicKey,
    async send(target, payload, ttl) {
      if (!isPushEndpoint(target.endpoint)) return "failed";
      let request: RequestInit;
      try {
        request = {
          method: "POST",
          headers: {
            Authorization: await vapidAuthorization(target.endpoint, vapid, now()),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: String(ttl),
            Urgency: "normal",
            // A later notification with the same topic replaces this one while it waits on the push service.
            Topic: payload.tag.replaceAll("-", "").slice(0, 32),
          },
          body: await encryptPushPayload(new TextEncoder().encode(JSON.stringify(payload)), target),
        };
      } catch {
        // The subscription's keys are malformed, so no retry can help.
        return "failed";
      }
      try {
        const res = await fetchImpl(target.endpoint, { ...request, signal: AbortSignal.timeout(5000) });
        await res.body?.cancel();
        if (res.ok) return "sent";
        if (res.status === 404 || res.status === 410) return "gone";
        if (res.status >= 400 && res.status < 500 && res.status !== 429) return "failed";
        return "retry";
      } catch {
        return "retry";
      }
    },
  };
}
