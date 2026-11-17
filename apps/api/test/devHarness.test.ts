import { describe, expect, it } from "vitest";
import { devHarness } from "../src/devHarness";
import { loadWorkerEnv } from "../src/env";
import type { NflProvider } from "../src/nfl";

const worker = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
};

describe("dev harness", () => {
  it("is refused unless the Worker runs in development", () => {
    expect(() => loadWorkerEnv({ ...worker, NODE_ENV: "production", DEV_HARNESS: "1" })).toThrow(
      /DEV_HARNESS/,
    );
    expect(() => loadWorkerEnv({ ...worker, DEV_HARNESS: "1" })).toThrow(/DEV_HARNESS/);
    expect(loadWorkerEnv({ ...worker, NODE_ENV: "development", DEV_HARNESS: "1" }).DEV_HARNESS).toBe("1");
    expect(loadWorkerEnv({ ...worker, NODE_ENV: "production" }).DEV_HARNESS).toBeUndefined();
  });

  it("moves the clock, scripts the feed and runs the jobs at its own time", async () => {
    const real = new Date("2026-11-17T12:00:00Z");
    const runs: { at: Date; nfl: NflProvider }[] = [];
    const harness = devHarness(
      async (at, nfl) => {
        runs.push({ at, nfl });
      },
      () => real,
    );
    const call = (method: string, path: string, body?: object) =>
      harness.routes.request(path, {
        method,
        ...(body && { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
      });

    expect(await harness.nfl.getWeek(2027, 19)).toEqual([]);
    expect((await call("PUT", "/api/dev/clock", { now: "2027-01-16T12:00:00-05:00" })).status).toBe(200);
    expect(harness.now().toISOString()).toBe("2027-01-16T17:00:00.000Z");
    expect(harness.clockOffsetMs()).toBe(Date.parse("2027-01-16T17:00:00Z") - real.getTime());

    const put = await call("PUT", "/api/dev/feed/2027/19", {
      games: [
        {
          externalId: "401",
          homeTeam: "KC",
          awayTeam: "BUF",
          kickoff: "2027-01-16T21:30:00Z",
          spread: -2.5,
          periodScores: { q1: { home: 7, away: 3 } },
        },
      ],
    });
    expect(put.status).toBe(200);
    const [game] = await harness.nfl.getWeek(2027, 19);
    expect(game).toMatchObject({ externalId: "401", spread: -2.5, homeScore: null, awayScore: null });
    expect(game?.kickoff).toEqual(new Date("2027-01-16T21:30:00Z"));
    // A caller can't change what the next read sees.
    if (game) game.homeTeam = "XXX";
    expect((await harness.nfl.getWeek(2027, 19))[0]?.homeTeam).toBe("KC");

    await call("POST", "/api/dev/jobs");
    expect(runs[0]?.at).toEqual(harness.now());
    expect(await runs[0]?.nfl.getWeek(2027, 19)).toHaveLength(1);

    expect((await call("PUT", "/api/dev/feed/2027/23", { games: [] })).status).toBe(400);
    expect((await call("PUT", "/api/dev/clock", { now: "tomorrow" })).status).toBe(400);

    await call("DELETE", "/api/dev/harness");
    expect(harness.now()).toEqual(real);
    expect(await harness.nfl.getWeek(2027, 19)).toEqual([]);
  });
});
