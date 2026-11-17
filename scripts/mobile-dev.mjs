#!/usr/bin/env node
// `pnpm mobile`: one command for testing on a phone against local data. Discovers the LAN address and this
// checkout's ports, then starts Supabase, the API and Expo. `pnpm dev` is `pnpm mobile --web`: the same, plus
// Expo's browser preview, which is the website in development. Addresses reach the servers through their
// environment only; neither the root nor the mobile .env is rewritten.
import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, isIP } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";
import { getPorts } from "./ports.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

export function lanHost(interfaces, preferredInterface, override) {
  const candidates = Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."))
      .map((entry) => ({ name, address: entry.address })),
  );
  if (override) {
    if (isIP(override) !== 4 || !candidates.some((entry) => entry.address === override))
      throw new Error("MOBILE_DEV_HOST must be an IPv4 address assigned to this computer.");
    return override;
  }
  const preferred = candidates.filter(
    (entry) =>
      entry.name === preferredInterface && !/^(utun|tun|tap|docker|bridge|veth|virbr|vmnet)/.test(entry.name),
  );
  if (preferred.length === 1) return preferred[0].address;
  // Ignore virtual bridges and VPN interfaces when default-route discovery isn't available.
  const physical = candidates.filter((entry) => /^(en\d|eth\d|wlan\d|wl\w|en[opxs]\w)/.test(entry.name));
  const choices = physical.length ? physical : candidates;
  if (choices.length === 1) return choices[0].address;
  throw new Error(
    choices.length
      ? "Several networks are available. Choose your Wi-Fi interface with MOBILE_DEV_INTERFACE (for example, en0)."
      : "No LAN IPv4 address found. Connect this computer to the same Wi-Fi as your phone.",
  );
}

function defaultInterface() {
  if (process.env.MOBILE_DEV_INTERFACE) return process.env.MOBILE_DEV_INTERFACE;
  try {
    if (process.platform === "darwin")
      return execFileSync("route", ["-n", "get", "default"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).match(/interface:\s*(\S+)/)?.[1];
    if (process.platform === "linux")
      return JSON.parse(
        execFileSync("ip", ["-json", "route", "get", "1.1.1.1"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      )[0]?.dev;
  } catch {}
}

export function localEnvironment(ports, host, stack, inherited = process.env, overrides = {}) {
  // Derive service credentials from this checkout's Supabase status, never an inherited remote DB.
  let database;
  let auth;
  try {
    database = new URL(stack.DATABASE_URL);
    auth = new URL(stack.SUPABASE_URL);
  } catch {
    throw new Error("Could not read the local Supabase configuration.");
  }
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) ||
    Number(database.port) !== ports.supabase.db ||
    !["localhost", "127.0.0.1", "[::1]"].includes(auth.hostname) ||
    Number(auth.port) !== ports.supabase.api ||
    !stack.SUPABASE_PUBLISHABLE_KEY
  )
    throw new Error("Supabase configuration does not match this checkout's local ports.");
  const apiUrl = `http://${host}:${ports.api}`;
  const authUrl = `http://${host}:${ports.supabase.api}`;
  const metroPort = ports.metro;
  const webOrigin = `http://${host}:${metroPort}`;
  const expoEnv = { ...inherited, EXPO_PUBLIC_API_URL: apiUrl, REACT_NATIVE_PACKAGER_HOSTNAME: host };
  for (const key of Object.keys(expoEnv)) {
    if (/^(DATABASE_URL|DB_URL|SUPABASE_.+|VAPID_.+|UNSUBSCRIBE_SECRET|EXPO_ACCESS_TOKEN)$/.test(key))
      delete expoEnv[key];
  }
  return {
    apiUrl,
    authUrl,
    metroPort,
    webOrigin,
    apiEnv: {
      ...overrides,
      ...inherited,
      ...stack,
      PORT: String(ports.api),
      SUPABASE_URL: authUrl,
      NODE_ENV: "development",
      MOBILE_DEV_ORIGIN: webOrigin,
    },
    // Only public addresses are added to Expo. No DB connection or service secrets are copied here.
    expoEnv,
  };
}

export function requireFreePort(port, name) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () =>
      reject(
        new Error(
          `The ${name} port (${port}) is already in use. Stop the other \`pnpm dev\` or \`pnpm mobile\` in this checkout, then try again.`,
        ),
      ),
    );
    server.listen({ host: "0.0.0.0", port, exclusive: true }, () => server.close(resolve));
  });
}

export const USAGE = `Usage: pnpm mobile [--web] [--dev-client] [--clear]

Starts everything for testing on your phone against local data: this checkout's Supabase
(applying new migrations, keeping data), the API and Expo. Scan the QR code with your
iPhone's Camera on the same Wi-Fi. Ctrl+C stops it all except Supabase.

  --web         also open the Expo browser preview (the website; \`pnpm dev\` adds this)
  --dev-client  target an installed development build instead of Expo Go
  --clear       clear Metro's cache (automatic when your network changes)

MOBILE_DEV_INTERFACE=en0 picks the network if this computer is on several.`;

export function parseArgs(args) {
  const known = {
    "--web": "web",
    "--dev-client": "devClient",
    "--clear": "clear",
    "--help": "help",
    "-h": "help",
  };
  const options = { web: false, devClient: false, clear: false, help: false };
  for (const arg of args) {
    if (!(arg in known)) throw new Error(`Unknown option ${arg}. Run pnpm mobile --help.`);
    options[known[arg]] = true;
  }
  return options;
}

function dockerRunning() {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** The last lines of a log, to show why a background server stopped. */
function tail(file, lines = 25) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/** Kill the process group too, so pnpm/tsx/Metro descendants cannot survive a failed launch. */
export async function stopProcesses(children) {
  for (const { child } of children) {
    try {
      process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGTERM");
    } catch {}
  }
  const force = setTimeout(() => {
    for (const { child } of children) {
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
      } catch {}
    }
  }, 3000);
  force.unref();
  await Promise.all(children.map(({ done }) => done));
  clearTimeout(force);
}

export async function waitForApi(url, record, signal) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !signal.aborted) {
    if (record.child.exitCode !== null || record.child.signalCode !== null)
      throw new Error("The local API stopped before it was ready.");
    try {
      const response = await fetch(`${url}/api/health`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {}
    await delay(250, undefined, { signal });
  }
  throw new Error("The local API did not become healthy. Check Docker and the API logs above.");
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) return console.log(USAGE);
  if (!dockerRunning())
    throw new Error("Docker isn't running. Open Docker Desktop, wait for it to start, then try again.");
  const ports = getPorts();
  const interfaceName = defaultInterface();
  const interfaces = networkInterfaces();
  if (process.env.MOBILE_DEV_INTERFACE && !interfaces[interfaceName])
    throw new Error("MOBILE_DEV_INTERFACE does not name a network interface on this computer.");
  const host = lanHost(interfaces, interfaceName, process.env.MOBILE_DEV_HOST);
  await requireFreePort(ports.api, "API");
  await requireFreePort(ports.metro, "Expo");
  const logDir = path.join(ROOT, "apps/mobile/.expo/logs");
  mkdirSync(logDir, { recursive: true });
  const logs = {
    supabase: path.join(logDir, "supabase.log"),
    api: path.join(logDir, "api.log"),
  };
  const children = [];
  const abort = new AbortController();
  const shutdown = () => abort.abort();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  /** Background servers write to a log file, so their output doesn't push Expo's QR code off the screen. */
  const launch = (command, parameters, { env = process.env, log, append = false } = {}) => {
    const out = log ? openSync(log, append ? "a" : "w") : "inherit";
    const child = spawn(command, parameters, {
      cwd: ROOT,
      env,
      stdio: [log ? "ignore" : "inherit", out, out],
      detached: process.platform !== "win32",
      shell: process.platform === "win32",
    });
    if (typeof out === "number") closeSync(out);
    const done = new Promise((resolve) => {
      child.once("error", () => resolve(1));
      child.once("close", (code) => resolve(code ?? 1));
    });
    const record = { child, done, log };
    children.push(record);
    return record;
  };
  const cancelled = new Promise((resolve) =>
    abort.signal.addEventListener("abort", () => resolve(0), { once: true }),
  );
  const step = async (label, parameters, append) => {
    process.stdout.write(`${label}… `);
    const result = await Promise.race([
      launch(process.execPath, parameters, { log: logs.supabase, append }).done,
      cancelled,
    ]);
    if (abort.signal.aborted) throw new Error("Cancelled");
    if (result !== 0)
      throw new Error(`failed.\n${tail(logs.supabase)}\n\nFull log: ${path.relative(ROOT, logs.supabase)}`);
    console.log("done");
  };
  try {
    console.log(`POW Pick'em local stack (checkout slot ${ports.slot})`);
    await step("Starting local Supabase (the first run downloads images)", ["scripts/supabase.mjs", "start"]);
    await step("Applying new migrations", ["scripts/supabase.mjs", "migration", "up"], true);
    let stack;
    try {
      stack = parseEnv(
        execFileSync(process.execPath, ["scripts/supabase-env.mjs"], {
          cwd: ROOT,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      throw new Error("Could not read local Supabase status. Run pnpm db:status to check it.");
    }
    let overrides = {};
    try {
      overrides = parseEnv(readFileSync(path.join(ROOT, ".env"), "utf8"));
    } catch {}
    const settings = localEnvironment(ports, host, stack, process.env, overrides);
    // The API address is inlined into the bundle, so Metro's cache goes stale when the network changes.
    const lastUrl = path.join(logDir, "last-api-url");
    let clear = options.clear;
    try {
      clear ||= readFileSync(lastUrl, "utf8") !== settings.apiUrl;
    } catch {
      clear = true;
    }
    writeFileSync(lastUrl, settings.apiUrl);
    process.stdout.write("Starting the API… ");
    const api = launch("pnpm", ["--filter", "@picks/api", "dev"], { env: settings.apiEnv, log: logs.api });
    try {
      await waitForApi(`http://127.0.0.1:${ports.api}`, api, abort.signal);
    } catch (error) {
      if (abort.signal.aborted) throw error;
      throw new Error(`failed.\n${tail(logs.api)}\n\nFull log: ${path.relative(ROOT, logs.api)}`);
    }
    console.log("done");
    console.log(`
  Phone     scan the QR code below (same Wi-Fi as this computer)
  Web       http://localhost:${settings.metroPort}   (Expo's browser preview)
  API       ${settings.apiUrl}
  Studio    http://127.0.0.1:${ports.supabase.studio}
  Inbox     http://127.0.0.1:${ports.supabase.mail}   (local emails land here)
  Sign in   admin@example.com / password123   (README lists the other test accounts)
  Logs      ${path.relative(ROOT, logDir)}/

Ctrl+C stops the API and Expo. Supabase keeps running (pnpm db:stop).
`);
    const expo = launch(
      "pnpm",
      [
        "--filter",
        "@picks/mobile",
        "exec",
        "expo",
        "start",
        options.devClient ? "--dev-client" : "--go",
        "--lan",
        "--port",
        String(settings.metroPort),
        ...(clear ? ["--clear"] : []),
        ...(options.web ? ["--web"] : []),
      ],
      { env: settings.expoEnv },
    );
    const stopped = await Promise.race([
      api.done.then(() => api),
      expo.done.then(() => expo),
      cancelled.then(() => undefined),
    ]);
    if (stopped && !abort.signal.aborted && (stopped !== expo || stopped.child.exitCode !== 0)) {
      const name = stopped === api ? "The API" : "Expo";
      throw new Error(
        stopped.log
          ? `${name} stopped.\n${tail(stopped.log)}\n\nFull log: ${path.relative(ROOT, stopped.log)}`
          : `${name} stopped. See its output above.`,
      );
    }
  } finally {
    abort.abort();
    await stopProcesses(children);
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
}

if (import.meta.main)
  main().catch((error) => {
    if (error.message !== "Cancelled" && error.name !== "AbortError") {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
