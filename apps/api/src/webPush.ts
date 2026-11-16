// Web Push with nothing but WebCrypto and fetch, so it runs the same on Node (tests, local dev) and in the
// Cloudflare Worker, which has neither `crypto.createECDH` nor a Node HTTPS agent for the `web-push` package.
//
//   RFC 8291  Message Encryption for Web Push (ECDH P-256 + HKDF, `aes128gcm` content coding of RFC 8188)
//   RFC 8292  VAPID: an ES256 JWT that identifies this app to the browser's push service

const encoder = new TextEncoder();

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** An ArrayBuffer-backed copy, the only kind every runtime's WebCrypto types accept. */
function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** What `generateKey` returns for an asymmetric algorithm (the DOM's `CryptoKeyPair`, absent from Node's types). */
type KeyPair = { publicKey: CryptoKey; privateKey: CryptoKey };

/** A P-256 key pair as Web Push carries it: the 65-byte uncompressed public point and the 32-byte private scalar. */
export type RawKeyPair = { publicKey: string; privateKey: string };

/** The JWK for a P-256 key from its raw base64url parts (`x` and `y` are the public point's halves). */
function p256Jwk(publicKey: string, privateKey?: string) {
  const point = base64UrlDecode(publicKey);
  if (point.length !== 65 || point[0] !== 4) throw new Error("Invalid P-256 public key");
  return {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(point.slice(1, 33)),
    y: base64UrlEncode(point.slice(33, 65)),
    ...(privateKey && { d: privateKey }),
    ext: true,
  };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) {
  const key = await crypto.subtle.importKey("raw", copy(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: copy(salt), info: copy(info) },
      key,
      length * 8,
    ),
  );
}

/** The record size the body declares. Payloads here are a few hundred bytes, so there is always one record. */
const RECORD_SIZE = 4096;

/**
 * Encrypts `plaintext` for one browser subscription (RFC 8291 §3.4, a single `aes128gcm` record). The sender key
 * pair and salt are fresh for every message; tests pass fixed ones to reproduce the RFC's worked example.
 */
export async function encryptPushPayload(
  plaintext: Uint8Array,
  subscription: { p256dh: string; auth: string },
  fixed?: { senderKeys: RawKeyPair; salt: Uint8Array },
): Promise<Uint8Array<ArrayBuffer>> {
  const receiverPublic = base64UrlDecode(subscription.p256dh);
  const authSecret = base64UrlDecode(subscription.auth);
  if (authSecret.length !== 16) throw new Error("Invalid push auth secret");
  if (plaintext.length > RECORD_SIZE - 17 - 86) throw new Error("Push payload too large");

  const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;
  const receiverKey = await crypto.subtle.importKey("jwk", p256Jwk(subscription.p256dh), ecdh, false, []);
  let senderPrivate: CryptoKey;
  let senderPublic: Uint8Array;
  if (fixed) {
    senderPrivate = await crypto.subtle.importKey(
      "jwk",
      p256Jwk(fixed.senderKeys.publicKey, fixed.senderKeys.privateKey),
      ecdh,
      false,
      ["deriveBits"],
    );
    senderPublic = base64UrlDecode(fixed.senderKeys.publicKey);
  } else {
    const pair = (await crypto.subtle.generateKey(ecdh, true, ["deriveBits"])) as KeyPair;
    senderPrivate = pair.privateKey;
    senderPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const sharedSecret = new Uint8Array(
    // The standard's field is `public`. Cloudflare's generated types spell it `$public` (a reserved-word escape
    // in their generator), but the runtime reads `public`, as Node does, so the object is cast rather than renamed.
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverKey } as never, senderPrivate, 256),
  );
  // RFC 8291 §3.4: mix in the subscription's auth secret and both public keys.
  const ikm = await hkdf(
    authSecret,
    sharedSecret,
    concat(encoder.encode("WebPush: info\0"), receiverPublic, senderPublic),
    32,
  );
  // RFC 8188 §2.2–2.3: the content encryption key and nonce for the (only) record.
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", copy(cek), "AES-GCM", false, ["encrypt"]);
  // The last (and only) record ends with the delimiter 0x02 and no further padding.
  const record = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: copy(nonce) },
      key,
      concat(plaintext, Uint8Array.of(2)),
    ),
  );
  // Header: salt (16) | record size (uint32) | key id length (1) | key id = the sender's public key (65).
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, record);
}

export type Vapid = RawKeyPair & {
  /** A `mailto:` or `https:` contact the push service can reach if this app misbehaves. */
  subject: string;
};

/** The `Authorization` header for one push service (RFC 8292 §2–3): an ES256 JWT for its origin, valid 12 hours. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid, now: Date): Promise<string> {
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: vapid.subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    p256Jwk(vapid.publicKey, vapid.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto signs in the raw r|s form a JWS wants, so no DER conversion is needed.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(`${header}.${claims}`),
  );
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`;
}
