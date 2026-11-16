import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function worker({ subscription = null, clients = [] } = {}) {
  const handlers = {},
    shown = [],
    opened = [],
    subscribed = [],
    stored = new Map(),
    posted = [];
  const self = {
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
    location: { origin: "https://www.pow-pickem.com" },
    registration: {
      showNotification: async (...args) => {
        shown.push(args);
      },
      pushManager: {
        getSubscription: async () => subscription,
        subscribe: async (options) => {
          subscribed.push(options);
          return { endpoint: "https://updates.push.services.mozilla.com/new" };
        },
      },
    },
    caches: {
      open: async (name) => ({
        put: async (path, response) => {
          stored.set(`${name}${path}`, await response.json());
        },
      }),
    },
    clients: {
      matchAll: async () => clients.map((id) => ({ postMessage: (message) => posted.push([id, message]) })),
      openWindow: async (url) => {
        opened.push(url);
      },
    },
  };
  vm.runInNewContext(readFileSync(new URL("../apps/web/public/push-sw.js", import.meta.url), "utf8"), {
    self,
    URL,
    Response,
  });
  return { handlers, shown, opened, subscribed, stored, posted };
}

async function fire(handler, event) {
  let done;
  handler({ ...event, waitUntil: (value) => (done = value) });
  await done;
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
test("a replaced subscription is renewed and its old endpoint left for the app to report", async () => {
  const { handlers, subscribed, stored, posted } = worker({ clients: ["tab"] });
  const oldEndpoint = "https://updates.push.services.mozilla.com/old";
  await fire(handlers.pushsubscriptionchange, {
    oldSubscription: { endpoint: oldEndpoint, options: { applicationServerKey: "key" } },
  });
  // Objects made inside the worker's context compare by value once copied out of it.
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(subscribed), [{ userVisibleOnly: true, applicationServerKey: "key" }]);
  assert.deepEqual(stored.get("pow-push-rotation/push-rotation"), { oldEndpoint });
  assert.deepEqual(plain(posted), [["tab", { type: "push-subscription-changed" }]]);
});
test("a subscription the browser already renewed is kept, and nothing is stored without an old endpoint", async () => {
  const { handlers, subscribed, stored, posted } = worker({
    subscription: { endpoint: "https://updates.push.services.mozilla.com/kept" },
  });
  await fire(handlers.pushsubscriptionchange, {});
  assert.deepEqual(subscribed, []);
  assert.equal(stored.size, 0);
  assert.deepEqual(posted, []);
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
