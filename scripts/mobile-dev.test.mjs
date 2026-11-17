import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { lanHost, localEnvironment, parseArgs, requireFreePort } from "./mobile-dev.mjs";
import { getPorts } from "./ports.mjs";

const adapter = (address, internal = false) => [{ address, family: "IPv4", internal }];

test("uses the default LAN interface and ignores loopback/VPN interfaces", () => {
  assert.equal(
    lanHost(
      { lo0: adapter("127.0.0.1", true), en0: adapter("192.168.1.20"), utun0: adapter("10.0.0.2") },
      "en0",
    ),
    "192.168.1.20",
  );
  assert.equal(
    lanHost({ en0: adapter("192.168.1.20"), utun0: adapter("10.0.0.2") }, "utun-missing"),
    "192.168.1.20",
  );
});
test("selects the physical LAN when the default route is a VPN", () => {
  assert.equal(
    lanHost({ en0: adapter("192.168.1.20"), utun0: adapter("10.0.0.2") }, "utun0"),
    "192.168.1.20",
  );
});
test("requires an explicit choice when multiple LAN adapters are ambiguous", () => {
  const interfaces = { en0: adapter("192.168.1.20"), en1: adapter("192.168.2.20") };
  assert.throws(() => lanHost(interfaces), /MOBILE_DEV_INTERFACE/);
  assert.equal(lanHost(interfaces, "en1"), "192.168.2.20");
  assert.throws(() => lanHost(interfaces, undefined, "203.0.113.9"), /assigned to this computer/);
  assert.throws(() => lanHost({ lo0: adapter("127.0.0.1", true) }), /No LAN/);
});
test("uses checkout ports, overrides inherited production settings, and keeps stack secrets out of Expo", () => {
  const ports = getPorts(3);
  const stack = {
    DATABASE_URL: `postgresql://postgres:synthetic-local-secret@127.0.0.1:${ports.supabase.db}/postgres`,
    SUPABASE_URL: `http://127.0.0.1:${ports.supabase.api}`,
    SUPABASE_PUBLISHABLE_KEY: "synthetic-public-key",
  };
  const inherited = {
    DATABASE_URL: "postgresql://prod/production",
    SUPABASE_URL: "https://production.supabase.co",
    EXPO_PUBLIC_API_URL: "https://www.pow-pickem.com",
  };
  const settings = localEnvironment(ports, "192.168.1.20", stack, inherited);
  assert.equal(settings.apiEnv.DATABASE_URL, stack.DATABASE_URL);
  assert.equal(settings.apiEnv.SUPABASE_URL, `http://192.168.1.20:${ports.supabase.api}`);
  assert.equal(settings.expoEnv.EXPO_PUBLIC_API_URL, `http://192.168.1.20:${ports.api}`);
  assert.equal(settings.metroPort, 8084);
  assert.equal(settings.metroPort, ports.metro);
  // The API lets only this checkout's Expo origin (the browser preview) call it across origins.
  assert.equal(settings.apiEnv.MOBILE_DEV_ORIGIN, `http://192.168.1.20:${ports.metro}`);
  assert.equal(settings.expoEnv.SUPABASE_PUBLISHABLE_KEY, undefined);
  assert.equal(settings.expoEnv.DATABASE_URL, undefined);
  assert.equal(settings.expoEnv.SUPABASE_URL, undefined);
  assert.ok(!JSON.stringify(settings.expoEnv).includes("synthetic-local-secret"));
  assert.throws(
    () => localEnvironment(ports, "192.168.1.20", { ...stack, DATABASE_URL: inherited.DATABASE_URL }),
    /checkout's local ports/,
  );
  assert.throws(
    () => localEnvironment(ports, "192.168.1.20", { ...stack, SUPABASE_URL: "http://localhost:9999" }),
    /checkout's local ports/,
  );
});
test("does not silently switch ports or reuse an unrelated server", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(requireFreePort(server.address().port, "API"), /already in use/);
});
test("accepts only the documented options", () => {
  assert.deepEqual(parseArgs([]), { web: false, devClient: false, clear: false, help: false });
  assert.deepEqual(parseArgs(["--web", "--clear"]), {
    web: true,
    devClient: false,
    clear: true,
    help: false,
  });
  assert.equal(parseArgs(["-h"]).help, true);
  assert.throws(() => parseArgs(["--prod"]), /Unknown option --prod/);
});
