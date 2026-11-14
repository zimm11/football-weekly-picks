import { createHmac, timingSafeEqual } from "node:crypto";

/** One email, ready to hand to a provider. */
export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** One-click unsubscribe (RFC 8058): sets `List-Unsubscribe` and `List-Unsubscribe-Post`. */
  listUnsubscribeUrl?: string;
};

export type Mailer = { send(email: OutgoingEmail): Promise<void> };

/** What a failed send means for the outbox. */
type Outcome =
  /** The message or address can't be sent, so retrying is pointless. Not sent. */
  | "rejected"
  /** The provider's daily quota is spent: wait for tomorrow. Not sent. */
  | "quota"
  /** Try again later: rate limited, or a setup problem (e.g. the domain isn't verified yet). Not sent. */
  | "retry"
  /** Try again later, but the provider may have sent it, so it still counts against the budget. */
  | "unknown";

/**
 * Cloudflare Email Service's error codes (https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
 * They are fixed identifiers, so they are safe to log and store; anything else becomes `EMAIL_PROVIDER_UNAVAILABLE`.
 */
const CLOUDFLARE_ERRORS = {
  E_VALIDATION_ERROR: "rejected",
  E_FIELD_MISSING: "rejected",
  E_TOO_MANY_RECIPIENTS: "rejected",
  E_TOO_MANY_ATTACHMENTS: "rejected",
  E_CONTENT_TOO_LARGE: "rejected",
  E_HEADER_NOT_ALLOWED: "rejected",
  E_HEADER_USE_API_FIELD: "rejected",
  E_HEADER_VALUE_INVALID: "rejected",
  E_HEADER_VALUE_TOO_LONG: "rejected",
  E_HEADER_NAME_INVALID: "rejected",
  E_HEADERS_TOO_LARGE: "rejected",
  E_HEADERS_TOO_MANY: "rejected",
  /** The address hard-bounced or complained before, so Cloudflare won't send to it. */
  E_RECIPIENT_SUPPRESSED: "rejected",
  /** The binding's destination allowlist, or an account that can only send to verified addresses. */
  E_RECIPIENT_NOT_ALLOWED: "rejected",
  E_DAILY_LIMIT_EXCEEDED: "quota",
  E_RATE_LIMIT_EXCEEDED: "retry",
  E_SENDER_NOT_VERIFIED: "retry",
  E_SENDER_DOMAIN_NOT_AVAILABLE: "retry",
  E_ACCOUNT_SUSPENDED: "retry",
  E_DELIVERY_FAILED: "unknown",
  E_INTERNAL_SERVER_ERROR: "unknown",
} as const satisfies Record<string, Outcome>;

export type CloudflareEmailErrorCode = keyof typeof CLOUDFLARE_ERRORS;
export const CLOUDFLARE_EMAIL_ERROR_CODES = Object.keys(CLOUDFLARE_ERRORS) as CloudflareEmailErrorCode[];

export type EmailErrorCode =
  | "EMAIL_REJECTED"
  | "EMAIL_PROVIDER_UNAVAILABLE"
  | "EMAIL_QUOTA_EXCEEDED"
  | CloudflareEmailErrorCode;

/** A provider's answer, reduced to a known code. Provider prose stays out of logs and the database. */
export class EmailSendError extends Error {
  readonly permanent: boolean;
  readonly notSent: boolean;
  readonly quota: boolean;
  constructor(
    readonly code: EmailErrorCode,
    outcome: Outcome,
  ) {
    super("Sending an email failed");
    /** True when retrying the same message can't succeed (a bad address or message). */
    this.permanent = outcome === "rejected";
    /** True when the provider said it did not send, so the send doesn't count against our budget. */
    this.notSent = outcome !== "unknown";
    /** True when the provider's own quota is used up for the day. */
    this.quota = outcome === "quota";
  }
}

/** `POW Pick'em <noreply@pow-pickem.com>` → its parts. */
export function parseAddress(from: string): { name?: string; email: string } {
  const match = from.match(/^\s*(.*?)\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  return match ? { name: match[1] || undefined, email: match[2] ?? "" } : { email: from.trim() };
}

function unsubscribeHeaders(url?: string): Record<string, string> {
  return url ? { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {};
}

/**
 * The part of Cloudflare's `send_email` binding this app uses. Declared here rather than taken from the
 * generated Worker types so the Node build (tests, local dev) compiles too; `worker.ts` forwards to the real
 * binding, so the Worker typecheck holds each call to Cloudflare's own types.
 */
export type EmailBinding = {
  send(message: {
    from: string | { email: string; name: string };
    to: string;
    subject: string;
    html: string;
    text: string;
    headers: Record<string, string>;
  }): Promise<{ messageId: string }>;
};

/**
 * Cloudflare Email Service, through the Worker's `send_email` binding (wrangler.jsonc). No API key: the binding
 * is the credential. Errors are thrown with a `code`; only that code is read, never the message.
 */
export function cloudflareMailer(binding: EmailBinding, from: string): Mailer {
  const { email: address, name } = parseAddress(from);
  const sender = name ? { email: address, name } : address;
  return {
    async send(email) {
      try {
        await binding.send({
          from: sender,
          to: email.to,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: unsubscribeHeaders(email.listUnsubscribeUrl),
        });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
        if (typeof code === "string" && Object.hasOwn(CLOUDFLARE_ERRORS, code)) {
          const known = code as CloudflareEmailErrorCode;
          throw new EmailSendError(known, CLOUDFLARE_ERRORS[known]);
        }
        throw new EmailSendError("EMAIL_PROVIDER_UNAVAILABLE", "unknown");
      }
    },
  };
}

/** The local Supabase stack's test inbox (Mailpit). Local development and tests only. */
export function mailpitMailer(baseUrl: string, from: string, fetchImpl: typeof fetch = fetch): Mailer {
  const sender = parseAddress(from);
  return {
    async send(email) {
      const res = await fetchImpl(new URL("/api/v1/send", baseUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: sender.email, Name: sender.name ?? "" },
          To: [{ Email: email.to }],
          Subject: email.subject,
          HTML: email.html,
          Text: email.text,
          Headers: unsubscribeHeaders(email.listUnsubscribeUrl),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return;
      const rejected = res.status === 400 || res.status === 422;
      throw new EmailSendError(
        rejected ? "EMAIL_REJECTED" : "EMAIL_PROVIDER_UNAVAILABLE",
        rejected ? "rejected" : res.status < 500 ? "retry" : "unknown",
      );
    },
  };
}

// ---------- Unsubscribe tokens ----------

export type EmailKind = "new_thread" | "pick_reminder";
const KINDS: EmailKind[] = ["new_thread", "pick_reminder"];

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(`unsubscribe:${payload}`).digest("base64url");

/** A link-safe token that lets its holder turn off one kind of email for one player, and nothing else. */
export function unsubscribeToken(secret: string, userId: string, kind: EmailKind): string {
  const payload = `${userId}.${kind}`;
  return `${payload}.${sign(secret, payload)}`;
}

export function verifyUnsubscribeToken(
  secret: string,
  token: string,
): { userId: string; kind: EmailKind } | null {
  const [userId, kind, signature, ...rest] = token.split(".");
  if (!userId || !kind || !signature || rest.length || !KINDS.includes(kind as EmailKind)) return null;
  const expected = Buffer.from(sign(secret, `${userId}.${kind}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { userId, kind: kind as EmailKind };
}
