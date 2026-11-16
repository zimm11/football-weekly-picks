import { describe, expect, it } from "vitest";
import { isPushEndpoint, pushSubscriptionSchema } from "./push";

describe("push subscription validation", () => {
  it("accepts the browser push providers", () => {
    for (const host of [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
      "wns2-par02p.notify.windows.com",
    ])
      expect(isPushEndpoint(`https://${host}/token`)).toBe(true);
  });
  it("rejects arbitrary hosts, credentials, ports, fragments and lookalike providers", () => {
    for (const url of [
      "http://fcm.googleapis.com/token",
      "https://127.0.0.1/x",
      "https://localhost/x",
      "https://fcm.googleapis.com.evil.test/x",
      "https://fcm.googleapis.com:8443/x",
      "https://me@fcm.googleapis.com/x",
      "https://evil.test/web.push.apple.com/x",
      "https://fcm.googleapis.com/x#secret",
      "https://push.apple.com.evil.test/x",
    ])
      expect(isPushEndpoint(url)).toBe(false);
  });
  it("requires encryption keys and explicit boolean preferences", () => {
    const value = {
      endpoint: "https://web.push.apple.com/token",
      keys: { p256dh: `B${"a".repeat(86)}`, auth: "a".repeat(22) },
      newThreads: true,
      pickReminders: false,
    };
    expect(pushSubscriptionSchema.safeParse(value).success).toBe(true);
    expect(pushSubscriptionSchema.safeParse({ ...value, keys: {} }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...value, newThreads: "true" }).success).toBe(false);
  });
});
