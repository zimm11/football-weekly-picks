import { describe, expect, it, vi } from "vitest";
import {
  CLOUDFLARE_EMAIL_ERROR_CODES,
  cloudflareMailer,
  EmailSendError,
  mailpitMailer,
  parseAddress,
  unsubscribeToken,
  verifyUnsubscribeToken,
} from "../src/email";
import { loadEnv, loadWorkerEnv } from "../src/env";
import { knownErrorCode, logError, logJobRun } from "../src/logging";
import { escapeHtml, excerpt } from "../src/templates";

const message = {
  to: "fan@example.com",
  subject: "Subject",
  html: "<p>Hi</p>",
  text: "Hi",
  listUnsubscribeUrl: "https://picks.test/api/unsubscribe?token=t",
};

/** A stand-in for the Worker's `send_email` binding that fails with `code` when given one. */
function fakeBinding(code?: unknown) {
  return {
    send: vi.fn(async () => {
      if (code !== undefined) throw Object.assign(new Error("provider prose with fan@example.com"), { code });
      return { messageId: "m-1" };
    }),
  };
}

describe("cloudflareMailer", () => {
  it("sends one message with the sender's name and one-click unsubscribe headers", async () => {
    const binding = fakeBinding();
    await cloudflareMailer(binding, "POW Pick'em <noreply@pow-pickem.com>").send(message);
    expect(binding.send).toHaveBeenCalledWith({
      from: { email: "noreply@pow-pickem.com", name: "POW Pick'em" },
      to: "fan@example.com",
      subject: "Subject",
      html: "<p>Hi</p>",
      text: "Hi",
      headers: {
        "List-Unsubscribe": "<https://picks.test/api/unsubscribe?token=t>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  });

  it.each([
    ["E_RECIPIENT_SUPPRESSED", { permanent: true, notSent: true, quota: false }],
    ["E_VALIDATION_ERROR", { permanent: true, notSent: true, quota: false }],
    ["E_DAILY_LIMIT_EXCEEDED", { permanent: false, notSent: true, quota: true }],
    ["E_RATE_LIMIT_EXCEEDED", { permanent: false, notSent: true, quota: false }],
    ["E_SENDER_NOT_VERIFIED", { permanent: false, notSent: true, quota: false }],
    ["E_INTERNAL_SERVER_ERROR", { permanent: false, notSent: false, quota: false }],
  ])("reduces %s to what the outbox should do", async (code, outcome) => {
    const error = await cloudflareMailer(fakeBinding(code), "a@b.c")
      .send(message)
      .catch((e) => e);
    expect(error).toBeInstanceOf(EmailSendError);
    expect(error).toMatchObject({ code, ...outcome });
    expect(String(error.message)).not.toContain("fan@example.com");
  });

  it("treats an unknown failure as possibly sent, without repeating the provider's words", async () => {
    for (const code of ["E_SOMETHING_NEW", undefined]) {
      const binding = code ? fakeBinding(code) : { send: vi.fn(async () => Promise.reject("boom")) };
      const error = await cloudflareMailer(binding, "a@b.c")
        .send(message)
        .catch((e) => e);
      expect(error).toMatchObject({ code: "EMAIL_PROVIDER_UNAVAILABLE", permanent: false, notSent: false });
    }
  });

  it("logs Cloudflare's codes, which are fixed identifiers", () => {
    for (const code of CLOUDFLARE_EMAIL_ERROR_CODES) {
      expect(knownErrorCode(new EmailSendError(code, "retry"))).toBe(code);
    }
  });
});

describe("mailpitMailer", () => {
  it("posts to the test inbox's send API", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    await mailpitMailer("http://127.0.0.1:54324", "POW Pick'em <noreply@pow-pickem.com>", fetch).send(
      message,
    );
    const [url, init] = fetch.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:54324/api/v1/send");
    expect(JSON.parse(String(init.body))).toMatchObject({
      From: { Email: "noreply@pow-pickem.com", Name: "POW Pick'em" },
      To: [{ Email: "fan@example.com" }],
      Headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
  });
});

describe("parseAddress", () => {
  it("splits a display name from the address", () => {
    expect(parseAddress("POW Pick'em <noreply@pow-pickem.com>")).toEqual({
      name: "POW Pick'em",
      email: "noreply@pow-pickem.com",
    });
    expect(parseAddress("noreply@pow-pickem.com")).toEqual({ email: "noreply@pow-pickem.com" });
  });
});

describe("unsubscribe tokens", () => {
  const secret = "s".repeat(32);
  const user = "00000000-0000-4000-8000-000000000001";

  it("round-trips, and only with the right secret", () => {
    const token = unsubscribeToken(secret, user, "pick_reminder");
    expect(verifyUnsubscribeToken(secret, token)).toEqual({ userId: user, kind: "pick_reminder" });
    expect(verifyUnsubscribeToken("t".repeat(32), token)).toBeNull();
  });

  it("rejects tokens whose user or kind was changed", () => {
    const token = unsubscribeToken(secret, user, "new_thread");
    expect(verifyUnsubscribeToken(secret, token.replace("new_thread", "pick_reminder"))).toBeNull();
    expect(verifyUnsubscribeToken(secret, token.replace("0001", "0002"))).toBeNull();
    expect(verifyUnsubscribeToken(secret, "")).toBeNull();
    expect(verifyUnsubscribeToken(secret, `${token}.extra`)).toBeNull();
  });
});

describe("templates", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("shortens long text at a word boundary", () => {
    expect(excerpt("short")).toBe("short");
    expect(excerpt(`${"word ".repeat(200)}`, 50)).toMatch(/^(word ){9}word…$/);
  });
});

describe("email logging", () => {
  it("logs provider failures by code only", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new EmailSendError("E_SENDER_NOT_VERIFIED", "retry");
    expect(knownErrorCode(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }))).toBe(
      "ECONNREFUSED",
    );
    logError("email_send", error);
    expect(JSON.parse(log.mock.calls[0]?.[0])).toMatchObject({
      operation: "email_send",
      code: "E_SENDER_NOT_VERIFIED",
      message: "The sender's domain isn't verified for Cloudflare Email Sending.",
    });
    log.mockRestore();
  });

  it("summarizes a job run by its counts, and stays quiet when it did nothing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    logJobRun("email_jobs", { queued: 0, sent: 0, failed: 0 });
    expect(log).not.toHaveBeenCalled();
    logJobRun("email_jobs", { queued: 2, sent: 2, failed: 0 });
    expect(JSON.parse(log.mock.calls[0]?.[0])).toEqual({
      event: "email_jobs",
      queued: 2,
      sent: 2,
      failed: 0,
    });
    log.mockRestore();
  });
});

describe("email environment", () => {
  const shared = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  };
  const base = { ...shared, DATABASE_URL: "postgresql://u:p@db.example.com:5432/postgres" };

  it("leaves email off until an unsubscribe secret is set", () => {
    const env = loadEnv(base);
    expect(env.UNSUBSCRIBE_SECRET).toBeUndefined();
    expect(env.EMAIL_FROM).toBe("POW Pick'em <noreply@pow-pickem.com>");
    // A safety cap, well above normal use.
    expect([env.EMAIL_DAILY_LIMIT, env.EMAIL_MONTHLY_LIMIT]).toEqual([1000, 10000]);
    expect(loadEnv({ ...base, EMAIL_DAILY_LIMIT: "20" }).EMAIL_DAILY_LIMIT).toBe(20);
    expect(() => loadEnv({ ...base, EMAIL_DAILY_LIMIT: "-1" })).toThrow(/EMAIL_DAILY_LIMIT/);
  });

  it("requires a link origin with the secret, and the secret with the test inbox", () => {
    expect(() => loadEnv({ ...base, UNSUBSCRIBE_SECRET: "u".repeat(32) })).toThrow(/APP_URL/);
    expect(() =>
      loadEnv({ ...base, INBOX_URL: "http://127.0.0.1:54324", APP_URL: "http://localhost:5173" }),
    ).toThrow(/UNSUBSCRIBE_SECRET/);
    const env = loadEnv({
      ...base,
      APP_URL: "https://www.pow-pickem.com/",
      UNSUBSCRIBE_SECRET: "u".repeat(32),
    });
    expect(env.APP_URL).toBe("https://www.pow-pickem.com");
  });

  it("applies the same rules to the Worker", () => {
    const production = { ...shared, NODE_ENV: "production", APP_URL: "https://www.pow-pickem.com" };
    expect(loadWorkerEnv(production).UNSUBSCRIBE_SECRET).toBeUndefined();
    expect(loadWorkerEnv({ ...production, UNSUBSCRIBE_SECRET: "u".repeat(32) }).APP_URL).toBe(
      "https://www.pow-pickem.com",
    );
    expect(() => loadWorkerEnv({ ...shared, UNSUBSCRIBE_SECRET: "u".repeat(32) })).toThrow(/APP_URL/);
    expect(() =>
      loadWorkerEnv({
        ...production,
        UNSUBSCRIBE_SECRET: "u".repeat(32),
        INBOX_URL: "http://127.0.0.1:54324",
      }),
    ).toThrow(/INBOX_URL/);
  });

  it("refuses the local test inbox in production", () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: "production",
        INBOX_URL: "http://127.0.0.1:54324",
        APP_URL: "https://x.test",
        UNSUBSCRIBE_SECRET: "u".repeat(32),
      }),
    ).toThrow(/INBOX_URL/);
  });
});
