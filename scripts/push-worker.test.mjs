import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function worker() {
  const handlers = {},
    shown = [],
    opened = [];
  const self = {
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    location: { origin: "https://www.pow-pickem.com" },
    registration: {
      showNotification: async (...args) => {
        shown.push(args);
      },
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (url) => {
        opened.push(url);
      },
    },
  };
  vm.runInNewContext(readFileSync(new URL("../apps/web/public/push-sw.js", import.meta.url), "utf8"), {
    self,
    URL,
  });
  return { handlers, shown, opened };
}

test("push displays a visible fallback even for malformed payloads and never caches pages", async () => {
  const { handlers, shown } = worker();
  let done;
  handlers.push({
    data: {
      json() {
        throw new Error("bad data");
      },
    },
    waitUntil: (value) => {
      done = value;
    },
  });
  await done;
  assert.equal(shown[0][0], "POW Pick'em");
  assert.equal(handlers.fetch, undefined);
});
test("notification clicks only open app destinations, never external or executable URLs", async () => {
  const { handlers, opened } = worker();
  for (const url of [
    "https://evil.test",
    "//evil.test",
    "javascript:alert(1)",
    "/reset-password#token=secret",
    "/weeks/11111111-1111-4111-8111-111111111111",
  ]) {
    let done;
    handlers.notificationclick({
      notification: { close() {}, data: { url } },
      waitUntil: (value) => {
        done = value;
      },
    });
    await done;
  }
  assert.deepEqual(opened, [
    ...Array(4).fill("https://www.pow-pickem.com/"),
    "https://www.pow-pickem.com/weeks/11111111-1111-4111-8111-111111111111",
  ]);
});
