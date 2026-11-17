import type { PushPayload } from "@picks/shared";
import { expoPushTokenSchema, isPushEndpoint } from "@picks/shared";
import { logError, type PUSH_ERROR_CODES } from "./logging";
import { encryptPushPayload, type Vapid, vapidAuthorization, vapidKeysMatch } from "./webPush";

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type PushSendResult = "sent" | "gone" | "retry" | "failed" | { receiptId: string };
export type PushSender = {
  publicKey: string;
  /**
   * Whether this sender can send at all (its VAPID keys form a pair). The drain checks it first, so a bad
   * configuration leaves notifications waiting instead of failing every one. Absent means always ready.
   */
  ready?(): Promise<boolean>;
  send(target: PushTarget, payload: PushPayload, ttl: number): Promise<PushSendResult>;
  /** Query an accepted native ticket; resend means the provider rejected it transiently. */
  receipt?(id: string): Promise<"sent" | "gone" | "retry" | "failed" | "resend">;
};

type PushErrorCode = (typeof PUSH_ERROR_CODES)[number];

/** The fixed code for a push service's permanent answer (a 4xx other than 404, 410 and 429). */
export function permanentPushCode(status: number): PushErrorCode {
  if (status === 400) return "PUSH_BAD_REQUEST";
  if (status === 401 || status === 403) return "PUSH_UNAUTHORIZED";
  if (status === 413) return "PUSH_PAYLOAD_TOO_LARGE";
  return "PUSH_REJECTED";
}

/** Logs a permanent failure by its fixed code only: never the endpoint or the push service's response. */
function logPermanent(code: PushErrorCode) {
  logError("push_delivery", { code });
}

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
  // Checked on first use, not at build: a Worker can't sign at module load. Only the settled answer is kept, so
  // no request ever awaits a check another request started.
  let keysMatch: boolean | undefined;
  return {
    publicKey: vapid.publicKey,
    async ready() {
      if (keysMatch === undefined) {
        const match = await vapidKeysMatch(vapid, now());
        if (keysMatch === undefined && !match) logError("push_config", { code: "VAPID_KEY_MISMATCH" });
        keysMatch = match;
      }
      return keysMatch;
    },
    async send(target, payload, ttl) {
      if (!isPushEndpoint(target.endpoint)) {
        logPermanent("PUSH_SUBSCRIPTION_INVALID");
        return "failed";
      }
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
        logPermanent("PUSH_SUBSCRIPTION_INVALID");
        return "failed";
      }
      try {
        const res = await fetchImpl(target.endpoint, { ...request, signal: AbortSignal.timeout(5000) });
        await res.body?.cancel();
        if (res.ok) return "sent";
        if (res.status === 404 || res.status === 410) return "gone";
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          logPermanent(permanentPushCode(res.status));
          return "failed";
        }
        return "retry";
      } catch {
        return "retry";
      }
    },
  };
}

/** Expo gateway uses fixed URLs only. Tickets are persisted and receipts checked by the durable queue. */
export function expoPushSender(accessToken?: string, fetchImpl: typeof fetch = fetch): PushSender {
  const headers = {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
  async function call(
    endpoint: "send" | "getReceipts",
    body: unknown,
  ): Promise<{ data?: unknown } | "retry" | "failed"> {
    try {
      const res = await fetchImpl(`https://exp.host/--/api/v2/push/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel();
        return "retry";
      }
      if (!res.ok) {
        await res.body?.cancel();
        logPermanent(permanentPushCode(res.status));
        return "failed";
      }
      return (await res.json()) as { data?: unknown };
    } catch {
      return "retry";
    }
  }
  function classify(value: unknown): "sent" | "gone" | "resend" | "failed" | "retry" {
    if (!value || typeof value !== "object") return "retry";
    const item = value as { status?: unknown; details?: { error?: unknown } };
    if (item.status === "ok") return "sent";
    if (item.status !== "error") return "retry";
    const code = item.details?.error;
    if (code === "DeviceNotRegistered") return "gone";
    if (code === "MessageRateExceeded") return "resend";
    logPermanent(
      code === "MessageTooBig"
        ? "PUSH_PAYLOAD_TOO_LARGE"
        : code === "InvalidCredentials"
          ? "PUSH_UNAUTHORIZED"
          : "PUSH_REJECTED",
    );
    return "failed";
  }
  return {
    publicKey: "",
    async send(target, payload, ttl) {
      if (!expoPushTokenSchema.safeParse(target.endpoint).success) {
        logPermanent("PUSH_SUBSCRIPTION_INVALID");
        return "failed";
      }
      const response = await call("send", {
        to: target.endpoint,
        title: payload.title,
        body: payload.body,
        data: { url: payload.url },
        ttl,
        sound: "default",
        priority: "normal",
        channelId: "default",
        collapseId: payload.tag,
        tag: payload.tag,
      });
      if (typeof response === "string") return response;
      const ticket = Array.isArray(response.data) ? response.data[0] : response.data;
      const result = classify(ticket);
      if (result === "sent") {
        const id = (ticket as { id?: unknown }).id;
        return typeof id === "string" && /^[A-Za-z0-9-]{1,100}$/.test(id) ? { receiptId: id } : "retry";
      }
      return result === "resend" ? "retry" : result;
    },
    async receipt(id) {
      const response = await call("getReceipts", { ids: [id] });
      if (typeof response === "string") return response;
      if (!response.data || typeof response.data !== "object") return "retry";
      return classify((response.data as Record<string, unknown>)[id]);
    },
  };
}
