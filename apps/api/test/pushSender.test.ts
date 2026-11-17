import type { Db } from "@picks/db";
import { describe, expect, it, vi } from "vitest";
import { loadEnv, loadWorkerEnv } from "../src/env";
import { runPushJobs } from "../src/pushQueue";
import { expoPushSender, type PushSender, permanentPushCode, webPushSender } from "../src/pushSender";
import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPushPayload,
  vapidAuthorization,
  vapidKeysMatch,
} from "../src/webPush";

/** A P-256 key pair in Web Push's raw base64url form, as `pnpm vapid-keys` prints it. */
async function rawKeyPair() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    publicKey: base64UrlEncode(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privateKey: jwk.d ?? "",
  };
}

/** A browser's subscription keys. */
async function subscription() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  return {
    p256dh: base64UrlEncode(await crypto.subtle.exportKey("raw", pair.publicKey)),
    auth: base64UrlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
}

describe("Web Push encryption (RFC 8291)", () => {
  it("reproduces the RFC's worked example byte for byte", async () => {
    // RFC 8291, Appendix A.
    const body = await encryptPushPayload(
      new TextEncoder().encode("When I grow up, I want to be a watermelon"),
      {
        p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
        auth: "BTBZMqHH6r4Tts7J_aSIgg",
      },
      {
        senderKeys: {
          publicKey:
            "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
          privateKey: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
        },
        salt: base64UrlDecode("DGv6ra1nlYgDCS1FRnbzlw"),
      },
    );
    expect(base64UrlEncode(body)).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });

  it("uses a fresh key and salt for every message", async () => {
    const keys = await subscription();
    const message = new TextEncoder().encode("same");
    const [a, b] = await Promise.all([encryptPushPayload(message, keys), encryptPushPayload(message, keys)]);
    expect(base64UrlEncode(a.slice(0, 16))).not.toBe(base64UrlEncode(b.slice(0, 16)));
    expect(base64UrlEncode(a)).not.toBe(base64UrlEncode(b));
  });

  it("refuses malformed subscription keys", async () => {
    const message = new TextEncoder().encode("x");
    await expect(
      encryptPushPayload(message, { p256dh: "AAAA", auth: "BTBZMqHH6r4Tts7J_aSIgg" }),
    ).rejects.toThrow();
    await expect(encryptPushPayload(message, { ...(await subscription()), auth: "AAAA" })).rejects.toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a 12-hour ES256 token for the push service's origin that verifies with the public key", async () => {
    const keys = await rawKeyPair();
    const now = new Date("2026-11-15T12:00:00Z");
    const header = await vapidAuthorization(
      "https://web.push.apple.com/some/device",
      { ...keys, subject: "mailto:admin@example.com" },
      now,
    );
    const match = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
    expect(match?.[4]).toBe(keys.publicKey);
    const [, head = "", claims = "", signature = ""] = match ?? [];
    expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(claims)))).toEqual({
      aud: "https://web.push.apple.com",
      exp: now.getTime() / 1000 + 12 * 60 * 60,
      sub: "mailto:admin@example.com",
    });
    const publicKey = await crypto.subtle.importKey(
      "raw",
      base64UrlDecode(keys.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      base64UrlDecode(signature),
      new TextEncoder().encode(`${head}.${claims}`),
    );
    expect(valid).toBe(true);
  });
});

const payload = {
  title: "New thread",
  body: "League update",
  url: "/",
  tag: "11111111-1111-4111-8111-111111111111",
};

describe("push transport", () => {
  async function sender(fetchImpl: typeof fetch) {
    return webPushSender({ ...(await rawKeyPair()), subject: "mailto:test@example.com" }, fetchImpl);
  }

  it("posts an encrypted payload with TTL, a replacement topic and VAPID authorization", async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 201 }),
    );
    const target = { endpoint: "https://web.push.apple.com/synthetic", ...(await subscription()) };
    expect(await (await sender(fetch)).send(target, payload, 90)).toBe("sent");
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(target.endpoint);
    expect(init?.headers).toMatchObject({
      "Content-Encoding": "aes128gcm",
      TTL: "90",
      Topic: "11111111111141118111111111111111",
      Authorization: expect.stringMatching(/^vapid t=.+, k=.+$/),
    });
    const body = new TextDecoder("latin1").decode(init?.body as Uint8Array);
    expect(body).not.toContain(payload.body);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("never calls an arbitrary endpoint", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const target = { endpoint: "https://localhost/private", ...(await subscription()) };
    expect(await (await sender(fetch)).send(target, payload, 90)).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("classifies expired subscriptions, permanent failures and retryable failures", async () => {
    const target = { endpoint: "https://web.push.apple.com/synthetic", ...(await subscription()) };
    for (const [status, result] of [
      [404, "gone"],
      [410, "gone"],
      [400, "failed"],
      [403, "failed"],
      [429, "retry"],
      [503, "retry"],
    ] as const) {
      const fetch = vi.fn(async () => new Response("private-endpoint-response", { status }));
      expect(await (await sender(fetch)).send(target, payload, 90)).toBe(result);
    }
    const offline = vi.fn(async () => Promise.reject(new TypeError("fetch failed")));
    expect(await (await sender(offline)).send(target, payload, 90)).toBe("retry");
    const broken = { ...target, p256dh: "not-a-key" };
    expect(await (await sender(offline)).send(broken, payload, 90)).toBe("failed");
  });
});

describe("push configuration and failure logging", () => {
  const subject = "mailto:test@example.com";
  const now = new Date("2026-11-15T12:00:00Z");

  it("accepts a matching VAPID pair and refuses a mismatched or malformed one", async () => {
    const [a, b] = await Promise.all([rawKeyPair(), rawKeyPair()]);
    expect(await vapidKeysMatch({ ...a, subject }, now)).toBe(true);
    expect(await vapidKeysMatch({ publicKey: a.publicKey, privateKey: b.privateKey, subject }, now)).toBe(
      false,
    );
    expect(await vapidKeysMatch({ publicKey: "BAAA", privateKey: a.privateKey, subject }, now)).toBe(false);
  });

  it("reports a mismatched pair once, by code, and stays not ready", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const [a, b] = await Promise.all([rawKeyPair(), rawKeyPair()]);
    const good = webPushSender({ ...a, subject }, vi.fn<typeof fetch>());
    expect(await good.ready?.()).toBe(true);
    expect(log).not.toHaveBeenCalled();
    const bad = webPushSender(
      { publicKey: a.publicKey, privateKey: b.privateKey, subject },
      vi.fn<typeof fetch>(),
    );
    expect(await Promise.all([bad.ready?.(), bad.ready?.()])).toEqual([false, false]);
    expect(await bad.ready?.()).toBe(false);
    expect(log).toHaveBeenCalledOnce();
    const record = JSON.parse(log.mock.calls[0]?.[0]);
    expect(record).toMatchObject({ operation: "push_config", code: "VAPID_KEY_MISMATCH" });
    expect(JSON.stringify(record)).not.toContain(b.privateKey);
    log.mockRestore();
  });

  it("logs a fixed code for each class of permanent failure, never the endpoint or response", async () => {
    expect([400, 401, 403, 413, 422].map(permanentPushCode)).toEqual([
      "PUSH_BAD_REQUEST",
      "PUSH_UNAUTHORIZED",
      "PUSH_UNAUTHORIZED",
      "PUSH_PAYLOAD_TOO_LARGE",
      "PUSH_REJECTED",
    ]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const target = { endpoint: "https://web.push.apple.com/secret-device", ...(await subscription()) };
    const keys = { ...(await rawKeyPair()), subject };
    for (const status of [403, 503]) {
      const fetch = vi.fn(async () => new Response("private-endpoint-response", { status }));
      await webPushSender(keys, fetch).send(target, payload, 90);
    }
    // Only the permanent one is logged; the retry is counted by the job instead.
    expect(log).toHaveBeenCalledOnce();
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ operation: "push_delivery", code: "PUSH_UNAUTHORIZED" });
    expect(line).not.toContain("secret-device");
    expect(line).not.toContain("private-endpoint-response");
    log.mockRestore();
  });
});

describe("scheduled push job", () => {
  it("still runs the send step when queueing reminders fails, and leaves the queue alone when not ready", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // Every database call fails, so queueing does; a sender that isn't ready never touches the database.
    const db = new Proxy({} as Db, {
      get: () => () => {
        throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
      },
    });
    const send = vi.fn<PushSender["send"]>();
    const result = await runPushJobs(db, { publicKey: "k", ready: async () => false, send }, new Date());
    expect(result).toEqual({ queued: 0, sent: 0, skipped: 0, retrying: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0]?.[0])).toMatchObject({
      operation: "push_queue",
      code: "ECONNREFUSED",
    });
    log.mockRestore();
  });
});

describe("push environment", () => {
  const shared = { SUPABASE_URL: "http://127.0.0.1:54341", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test" };
  const base = { ...shared, DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54342/postgres" };

  it("needs all three VAPID settings, on Node and in the Worker", async () => {
    const keys = await rawKeyPair();
    const vapid = {
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_PRIVATE_KEY: keys.privateKey,
      VAPID_SUBJECT: "mailto:a@b.c",
    };
    expect(() => loadEnv({ ...base, VAPID_PRIVATE_KEY: keys.privateKey })).toThrow(
      "Set all three VAPID variables",
    );
    expect(loadEnv({ ...base, ...vapid }).VAPID_PUBLIC_KEY).toBe(keys.publicKey);
    expect(() => loadWorkerEnv({ ...shared, VAPID_PUBLIC_KEY: keys.publicKey })).toThrow(
      "Set all three VAPID variables",
    );
    expect(loadWorkerEnv({ ...shared, ...vapid }).VAPID_SUBJECT).toBe("mailto:a@b.c");
  });
});

describe("Expo push transport", () => {
  const target = { endpoint: "ExponentPushToken[synthetic-device]", p256dh: "", auth: "" };
  it("posts only to the fixed Expo gateway and retains a ticket until its receipt is checked", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ data: { status: "ok", id: "ticket-123" } }))
      .mockResolvedValueOnce(Response.json({ data: { "ticket-123": { status: "ok" } } }));
    const sender = expoPushSender("secret-access-token", fetch);
    expect(await sender.send(target, payload, 90)).toEqual({ receiptId: "ticket-123" });
    expect(await sender.receipt?.("ticket-123")).toBe("sent");
    expect(fetch.mock.calls[0]?.[0]).toBe("https://exp.host/--/api/v2/push/send");
    expect(fetch.mock.calls[1]?.[0]).toBe("https://exp.host/--/api/v2/push/getReceipts");
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ Authorization: "Bearer secret-access-token" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      to: target.endpoint,
      ttl: 90,
      data: { url: payload.url },
    });
  });
  it("removes a native device only for DeviceNotRegistered, including receipt failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [error, result] of [
      ["DeviceNotRegistered", "gone"],
      ["InvalidCredentials", "failed"],
      ["MessageTooBig", "failed"],
      ["MessageRateExceeded", "resend"],
    ] as const) {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(
        Response.json({
          data: {
            "ticket-123": { status: "error", message: "private-provider-message", details: { error } },
          },
        }),
      );
      expect(await expoPushSender(undefined, fetch).receipt?.("ticket-123")).toBe(result);
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-provider-message");
    log.mockRestore();
  });
  it("retries missing receipts, timeouts and gateway outages without dropping tokens", async () => {
    for (const response of [
      Response.json({ data: {} }),
      new Response(null, { status: 429 }),
      new Response(null, { status: 503 }),
    ]) {
      expect(
        await expoPushSender(
          undefined,
          vi.fn(async () => response),
        ).receipt?.("ticket-123"),
      ).toBe("retry");
    }
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("private transport error"));
    expect(await expoPushSender(undefined, fetch).send(target, payload, 90)).toBe("retry");
  });
  it("refuses arbitrary URLs and malformed tokens before any network request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(
      await expoPushSender(undefined, fetch).send(
        { ...target, endpoint: "https://localhost/private" },
        payload,
        90,
      ),
    ).toBe("failed");
    expect(fetch).not.toHaveBeenCalled();
  });
});
