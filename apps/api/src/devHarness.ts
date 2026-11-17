import { Hono } from "hono";
import { z } from "zod";
import type { NflProvider, ProviderGame } from "./nfl";

/*
 * The local E2E harness: a scripted schedule feed and a movable clock for the Worker under `pnpm worker:dev`, so
 * an end-to-end test can play a whole week, round, board or pool with nobody pressing Open or Finalize. It is on
 * only with DEV_HARNESS=1 and NODE_ENV=development (env validation refuses it in production), and its routes are
 * served outside the API (`/api/dev/*`, src/worker.ts), so they never reach `ApiType`.
 *
 * While it is on, the feed is the harness alone: a week the test hasn't scripted has no games, and ESPN is never
 * asked. The state is plain values in this isolate (`pnpm worker:dev` runs one), never a promise.
 *
 * A jobs run advances only the leagues the test names: the clock is in the future, so running every league in
 * the local database would play the seeded ones forward (finalizing their weeks, drawing their boards).
 */

const periodScore = z.object({ home: z.number().int().min(0), away: z.number().int().min(0) });

const gameSchema = z.object({
  externalId: z.string().min(1),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  kickoff: z.iso.datetime({ offset: true }),
  spread: z.number().nullable().default(null),
  homeScore: z.number().int().min(0).nullable().default(null),
  awayScore: z.number().int().min(0).nullable().default(null),
  status: z.enum(["scheduled", "in_progress", "final"]).optional(),
  period: z.number().int().min(0).optional(),
  periodScores: z
    .object({ q1: periodScore, half: periodScore, q3: periodScore, final: periodScore })
    .partial()
    .optional(),
});

/** One scripted game as a test sends it: kickoff as an ISO string, the rest as `ProviderGame`. */
export type HarnessGame = z.input<typeof gameSchema>;

export type DevHarness = {
  /** The harness's clock: real time shifted by the offset the test set. */
  now: () => Date;
  /** The scripted feed. */
  nfl: NflProvider;
  clockOffsetMs: () => number;
  /** `/api/dev/*`. */
  routes: Hono;
};

export function devHarness(
  runJobs: (now: Date, nfl: NflProvider, onlyLeagues: ReadonlySet<string>) => Promise<unknown>,
  realNow: () => Date = () => new Date(),
): DevHarness {
  let offsetMs = 0;
  const feed = new Map<string, ProviderGame[]>();
  const key = (year: number, week: number) => `${year}:${week}`;
  const now = () => new Date(realNow().getTime() + offsetMs);

  const nfl: NflProvider = {
    async getWeek(year, week) {
      // Copies, so a caller can't change what the next read sees.
      return (feed.get(key(year, week)) ?? []).map((game) => ({
        ...game,
        kickoff: new Date(game.kickoff),
        ...(game.periodScores && { periodScores: { ...game.periodScores } }),
      }));
    },
  };

  const state = () => ({ now: now().toISOString(), offsetMs, weeks: [...feed.keys()].sort() });

  const routes = new Hono()
    .get("/api/dev/state", (c) => c.json(state()))
    /** Moves the clock to `now`; it keeps running from there. Only move it forward of the real time (see e2e). */
    .put("/api/dev/clock", async (c) => {
      const body = z.object({ now: z.iso.datetime({ offset: true }) }).safeParse(await c.req.json());
      if (!body.success) return c.json({ error: "Send { now: ISO 8601 with an offset }" }, 400);
      offsetMs = Date.parse(body.data.now) - realNow().getTime();
      return c.json(state());
    })
    /** Replaces one NFL week's slate (the app's week line: 1–18, then 19–22 for the postseason). */
    .put("/api/dev/feed/:year/:week", async (c) => {
      const year = Number(c.req.param("year")),
        week = Number(c.req.param("week"));
      const body = z.object({ games: z.array(gameSchema) }).safeParse(await c.req.json());
      if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 22 || !body.success) {
        return c.json({ error: "Send { games: [...] } to /api/dev/feed/<year>/<1-22>" }, 400);
      }
      feed.set(
        key(year, week),
        body.data.games.map((game) => ({ ...game, kickoff: new Date(game.kickoff) })),
      );
      return c.json(state());
    })
    /**
     * Runs the scheduled jobs (automation, then email and push) once, at the harness's time. Automation advances
     * only `leagueIds`; with none it advances nothing.
     */
    .post("/api/dev/jobs", async (c) => {
      const body = z
        .object({ leagueIds: z.array(z.uuid()).default([]) })
        .safeParse(await c.req.json().catch(() => ({})));
      if (!body.success) return c.json({ error: "Send { leagueIds: [uuid, ...] }" }, 400);
      await runJobs(now(), nfl, new Set(body.data.leagueIds));
      return c.json(state());
    })
    /** Back to real time and an empty feed. */
    .delete("/api/dev/harness", (c) => {
      offsetMs = 0;
      feed.clear();
      return c.json(state());
    });

  return { now, nfl, clockOffsetMs: () => offsetMs, routes };
}
