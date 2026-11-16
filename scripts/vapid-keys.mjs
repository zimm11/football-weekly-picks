#!/usr/bin/env node
// Prints a new VAPID key pair for Web Push as JSON: { "publicKey", "privateKey" }, both base64url, in the raw
// form browsers and the API read (README, "Push notifications"). Generate one pair per environment and keep it:
// a new pair orphans every device that subscribed with the old one. The private key is a secret, so pipe it
// straight into `wrangler secret put` rather than printing it where it will be kept.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url");
const { d: privateKey } = await crypto.subtle.exportKey("jwk", pair.privateKey);
process.stdout.write(`${JSON.stringify({ publicKey, privateKey })}\n`);
