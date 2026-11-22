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
    const runs: { at: Date; nfl: NflProvider; only: string[] }[] = [];
    const harness = devHarness(
      async (at, nfl, onlyLeagues) => {
        runs.push({ at, nfl, only: [...onlyLeagues] });
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

    // A jobs run advances only the leagues it names, so the future clock never plays the seeded ones forward.
    await call("POST", "/api/dev/jobs");
    expect(runs[0]?.at).toEqual(harness.now());
    expect(runs[0]?.only).toEqual([]);
    expect(await runs[0]?.nfl.getWeek(2027, 19)).toHaveLength(1);
    const league = "2f0c1a52-7c5e-4d5c-9f8e-1b1a4f0e9c11";
    expect((await call("POST", "/api/dev/jobs", { leagueIds: [league] })).status).toBe(200);
    expect(runs[1]?.only).toEqual([league]);
    expect((await call("POST", "/api/dev/jobs", { leagueIds: ["not-a-uuid"] })).status).toBe(400);
    expect(runs).toHaveLength(2);

    // A game being played keeps its scripted clock and state ("3rd quarter, 4:12"), which an unknown key would lose.
    const live = {
      externalId: "402",
      homeTeam: "PHI",
      awayTeam: "DAL",
      kickoff: "2027-01-16T18:00:00Z",
      status: "in_progress",
      period: 3,
      liveScore: { home: 17, away: 10 },
      liveState: "playing",
      clock: "4:12",
    };
    expect((await call("PUT", "/api/dev/feed/2027/20", { games: [live] })).status).toBe(200);
    expect((await harness.nfl.getWeek(2027, 20))[0]).toMatchObject({
      status: "in_progress",
      period: 3,
      liveScore: { home: 17, away: 10 },
      liveState: "playing",
      clock: "4:12",
    });
    expect((await call("PUT", "/api/dev/feed/2027/20", { games: [{ ...live, clock: "soon" }] })).status).toBe(
      400,
    );
    expect(
      (await call("PUT", "/api/dev/feed/2027/20", { games: [{ ...live, liveState: "delayed" }] })).status,
    ).toBe(400);

    expect((await call("PUT", "/api/dev/feed/2027/23", { games: [] })).status).toBe(400);
    expect((await call("PUT", "/api/dev/clock", { now: "tomorrow" })).status).toBe(400);

    await call("DELETE", "/api/dev/harness");
    expect(harness.now()).toEqual(real);
    expect(await harness.nfl.getWeek(2027, 19)).toEqual([]);
  });
});
