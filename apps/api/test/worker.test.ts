// The Worker entrypoint's Cron Trigger handler, without the Workers runtime or a database: `cloudflare:workers`,
// the Hyperdrive client and the jobs are fakes, so this checks only the wiring in src/worker.ts.

import { afterEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  env: {} as Record<string, string>,
  connection: { $close: vi.fn(async () => {}), marker: () => "this run's connection" },
  runScheduledJobs: vi.fn(async (_db: unknown, _deps: unknown, _now: Date) => {}),
}));

vi.mock("cloudflare:workers", () => ({ env: fakes.env }));
vi.mock("@picks/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createHyperdriveDb: vi.fn(() => fakes.connection),
}));
vi.mock("../src/jobs", () => ({ runScheduledJobs: fakes.runScheduledJobs }));

type Handler = {
  scheduled(controller: unknown, env: unknown, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void>;
};

/** Loads src/worker.ts afresh with these vars and secrets (it builds the app at module load). */
async function loadWorker(vars: Record<string, string>): Promise<Handler> {
  vi.resetModules();
  for (const key of Object.keys(fakes.env)) delete fakes.env[key];
  Object.assign(fakes.env, vars);
  // A computed specifier keeps tsc (Node types) from checking worker.ts, which tsconfig.worker.json covers.
  const path = "../src/worker";
  return (await import(/* @vite-ignore */ path)).default as Handler;
}

const base = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  NODE_ENV: "production",
};
const bindings = { HYPERDRIVE: { connectionString: "postgresql://u:p@hyperdrive.local:5432/db" } };

describe("Worker scheduled handler", () => {
  afterEach(() => {
    fakes.runScheduledJobs.mockReset();
    fakes.connection.$close.mockClear();
  });

  it("does nothing when neither email nor push is configured", async () => {
    const worker = await loadWorker(base);
    const waitUntil = vi.fn();
    await worker.scheduled({}, bindings, { waitUntil });
    expect(fakes.runScheduledJobs).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("runs the jobs on this run's own connection and closes it afterwards", async () => {
    const worker = await loadWorker({
      ...base,
      APP_URL: "https://www.pow-pickem.com",
      UNSUBSCRIBE_SECRET: "u".repeat(32),
    });
    let seen = "";
    fakes.runScheduledJobs.mockImplementation(async (db) => {
      // The routes' stand-in forwards to the connection opened for this run.
      seen = (db as typeof fakes.connection).marker();
    });
    const waited: Promise<unknown>[] = [];
    await worker.scheduled({}, bindings, { waitUntil: (p) => waited.push(p) });

    expect(fakes.runScheduledJobs).toHaveBeenCalledOnce();
    const [, deps, now] = fakes.runScheduledJobs.mock.calls[0] ?? [];
    expect(deps).toMatchObject({ email: { appUrl: "https://www.pow-pickem.com" }, push: undefined });
    expect(now).toBeInstanceOf(Date);
    expect(seen).toBe("this run's connection");
    await Promise.all(waited);
    expect(fakes.connection.$close).toHaveBeenCalledOnce();
  });

  it("closes the connection even when the jobs throw", async () => {
    const worker = await loadWorker({
      ...base,
      APP_URL: "https://www.pow-pickem.com",
      UNSUBSCRIBE_SECRET: "u".repeat(32),
    });
    fakes.runScheduledJobs.mockRejectedValue(new Error("boom"));
    const waited: Promise<unknown>[] = [];
    await expect(worker.scheduled({}, bindings, { waitUntil: (p) => waited.push(p) })).rejects.toThrow(
      "boom",
    );
    await Promise.all(waited);
    expect(fakes.connection.$close).toHaveBeenCalledOnce();
  });
});
