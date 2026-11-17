import { randomUUID } from "node:crypto";
import {
  createDb,
  emailOutbox,
  games,
  leagues,
  profiles,
  seasons,
  survivorPicks,
  weekParticipants,
  weeks,
} from "@picks/db";
import {
  type CreateLeagueResult,
  estimatedWeekStart,
  type LeagueDetail,
  type SurvivorView,
} from "@picks/shared";
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { type AutomationContext, advanceLeagues } from "../src/automation";
import type { NflProvider, ProviderGame } from "../src/nfl";
import type { EmailDeps } from "../src/outbox";
import { survivorReminders } from "../src/reminders/survivor";
import { survivorHooks } from "../src/survivor";
import { providerWeeks } from "../src/weekOps";

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };

/*
 * Survivor end to end on the API: a pool started on create, run by automation from a scripted feed on a fixed clock
 * through the regular season's last weeks and into the playoffs, to a winner. Every step is checked for the
 * reveal point: no route says anything about another player's pick before its team's game kicks off.
 */
describe.skipIf(!process.env.DATABASE_URL)("survivor (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  const [ADMIN, ANN, BOB, CAT, STRANGER, DAN] = Array.from({ length: 6 }, () => randomUUID()) as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const users = [ADMIN, ANN, BOB, CAT, STRANGER, DAN];
  const names = ["Commish", "Ann", "Bob", "Cat", "Stranger", "Dan"];
  const verifyToken = async (token: string) => (users.includes(token) ? { id: token } : null);
  let clock = new Date("2026-11-18T15:00:00Z");
  const email: EmailDeps = {
    mailer: { send: async () => {} },
    appUrl: "https://picks.test",
    unsubscribeSecret: "test-unsubscribe-secret-that-is-long-enough",
    limits: { daily: 10_000, monthly: 100_000 },
  };

  // The scripted feed, by "year:week". `asked` lists the weeks the provider was asked for.
  const feed = new Map<string, ProviderGame[]>();
  const asked: string[] = [];
  const nfl: NflProvider = {
    async getWeek(year, week) {
      asked.push(`${year}:${week}`);
      return (feed.get(`${year}:${week}`) ?? []).map((g) => ({ ...g }));
    },
  };
  const game = (id: string, home: string, away: string, kickoff: Date): ProviderGame => ({
    externalId: id,
    homeTeam: home,
    awayTeam: away,
    kickoff,
    spread: -3,
    homeScore: null,
    awayScore: null,
  });
  /** Sunday of week `n` of `year`'s season (by the calendar estimate), at `hour` UTC. */
  const sunday = (year: number, n: number, hour = 18) => {
    const thursday = estimatedWeekStart(year, n);
    return new Date(
      Date.UTC(thursday.getUTCFullYear(), thursday.getUTCMonth(), thursday.getUTCDate() + 3, hour),
    );
  };
  /** Marks feed games final: `scores` maps an external id to [home, away]. */
  const finish = (year: number, week: number, scores: Record<string, [number, number]>) => {
    for (const g of feed.get(`${year}:${week}`) ?? []) {
      const score = scores[g.externalId];
      if (score) [g.homeScore, g.awayScore] = score;
    }
  };
  /** `count` games on one Sunday, `${prefix}-0`…, each pairing the next two of `teams`. */
  const slate = (year: number, week: number, prefix: string, teams: string[]) =>
    Array.from({ length: teams.length / 2 }, (_, i) =>
      game(`${prefix}-${i}`, teams[2 * i] ?? "", teams[2 * i + 1] ?? "", sunday(year, week, 18 + i)),
    );

  const pending: Promise<unknown>[] = [];
  const app = createApp({
    db,
    verifyToken,
    publicConfig,
    nfl,
    now: () => clock,
    email,
    background: (task) => pending.push(task()),
  });
  const call = async <T = unknown>(user: string, method: string, path: string, json?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  /** The cron's automation run at the current clock (its own results cache, as each run has). */
  const cron = (results?: AutomationContext["results"]) =>
    advanceLeagues({
      db,
      nfl,
      now: clock,
      results: results ?? providerWeeks(nfl, () => clock),
      notify: { email },
    });
  /** Moves the clock on, at least past the one-minute throttle on reads. */
  const at = (iso: string | Date) => {
    clock = new Date(iso);
  };

  const created: string[] = [];
  const create = async (user: string, json: Record<string, unknown>) => {
    const res = await call<CreateLeagueResult>(user, "POST", "/leagues", { type: "survivor", ...json });
    if (res.status === 201) created.push(res.body.id);
    return res;
  };
  const join = async (user: string, leagueId: string) => {
    const [league] = await db
      .select({ code: leagues.inviteCode })
      .from(leagues)
      .where(eq(leagues.id, leagueId));
    expect((await call(user, "POST", `/invites/${league?.code}/join`)).status).toBe(200);
  };
  const view = async (user: string, leagueId: string) => {
    const res = await call<SurvivorView>(user, "GET", `/leagues/${leagueId}/survivor`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const pick = (user: string, weekId: string, gameId: string, side: "home" | "away", userId?: string) =>
    call<{ error?: string }>(user, "PUT", `/weeks/${weekId}/survivor-pick`, { gameId, side, userId });
  const weekRow = async (leagueId: string, number: number) => {
    const [row] = await db
      .select({ week: weeks })
      .from(weeks)
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .where(and(eq(seasons.leagueId, leagueId), eq(weeks.number, number)));
    return row?.week;
  };
  const slateOf = (weekId: string) =>
    db.select().from(games).where(eq(games.weekId, weekId)).orderBy(asc(games.kickoff), asc(games.id));
  const gameId = async (weekId: string, home: string) =>
    (await slateOf(weekId)).find((g) => g.homeTeam === home)?.id ?? "";
  const events = (leagueId: string, event: string) =>
    db
      .select({ userId: emailOutbox.userId, message: emailOutbox.message })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `league_event:${leagueId}:%:${event}`));

  beforeAll(async () => {
    for (const [i, id] of users.entries()) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}, ${`survivor-${i}@example.com`})`,
      );
    }
    await db
      .insert(profiles)
      .values(users.map((userId, i) => ({ userId, displayName: names[i] ?? "Player" })));
  });
  afterAll(async () => {
    await Promise.allSettled(pending);
    if (created.length) await db.delete(leagues).where(inArray(leagues.id, created));
    await db.execute(
      sql`delete from auth.users where id in (${sql.join(
        users.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    await db.$close();
  });

  describe("a simulated season from a start week through the playoffs to a winner", () => {
    let leagueId = "";
    let week17 = "";
    let week18 = "";

    it("starts the pool on create, and the first read imports and opens the start week", async () => {
      feed.set("2026:17", [
        game("w17-kc", "KC", "LV", sunday(2026, 17, 18)),
        game("w17-buf", "BUF", "NYJ", sunday(2026, 17, 21)),
      ]);
      // A start week that has begun can't be chosen.
      expect((await create(ADMIN, { name: "Too late", settings: { startWeek: 3 } })).status).toBe(409);
      const res = await create(ADMIN, { name: "Last One Standing", settings: { lives: 1, startWeek: 17 } });
      expect(res.status).toBe(201);
      leagueId = res.body.id;
      for (const user of [ANN, BOB]) await join(user, leagueId);

      const [season] = await db.select().from(seasons).where(eq(seasons.leagueId, leagueId));
      expect(season).toMatchObject({ year: 2026, settings: { lives: 1, startWeek: 17 } });
      const start = await weekRow(leagueId, 17);
      expect(start?.status).toBe("draft");
      expect(await slateOf(start?.id ?? "")).toEqual([]);

      // The first read fills the slate and opens the week: there are no spreads to wait for.
      const first = await view(ANN, leagueId);
      week17 = first.current?.weekId ?? "";
      expect(first.current).toMatchObject({ number: 17, myPick: null, used: [] });
      expect(first.weeks.map((w) => [w.number, w.status, w.games.length])).toEqual([[17, "open", 2]]);
      expect(first.players.map((p) => [p.displayName, p.alive])).toEqual([
        // Joined at the same moment, so in name order.
        ["Ann", true],
        ["Bob", true],
        ["Commish", true],
      ]);
      expect(first).toMatchObject({ started: false, over: false, watching: false, settings: { lives: 1 } });
    });

    it("saves picks, an admin's for a player too, and reveals each at its team's kickoff", async () => {
      const kc = await gameId(week17, "KC");
      const buf = await gameId(week17, "BUF");
      expect((await pick(ANN, week17, buf, "home")).status).toBe(200);
      expect((await pick(ADMIN, week17, kc, "home")).status).toBe(200);
      // An admin enters Bob's pick; a member can't enter anyone's.
      expect((await pick(ANN, week17, kc, "home", BOB)).status).toBe(403);
      expect((await pick(ADMIN, week17, kc, "home", BOB)).status).toBe(200);
      expect((await view(BOB, leagueId)).current?.myPick).toEqual({
        gameId: kc,
        side: "home",
        byAdmin: true,
      });
      expect((await pick(STRANGER, week17, kc, "home")).status).toBe(404);
      expect((await call(STRANGER, "GET", `/leagues/${leagueId}/survivor`)).status).toBe(404);

      // Before kickoff, nobody sees anyone else's pick, the admin who entered Bob's included.
      at("2026-11-18T16:00:00Z");
      for (const user of [ADMIN, ANN, BOB]) {
        const seen = await view(user, leagueId);
        expect(seen.picks.map((p) => p.userId)).toEqual([user]);
        expect(JSON.stringify(seen.players)).not.toMatch(/KC|BUF|pick/i);
      }
      expect((await call<LeagueDetail>(ANN, "GET", `/leagues/${leagueId}`)).body.weeks[0]?.myPickCount).toBe(
        0,
      );

      // The Chiefs have kicked off, the Bills haven't: the Chiefs picks show, Ann's Bills pick still doesn't.
      at(sunday(2026, 17, 19));
      const admin = await view(ADMIN, leagueId);
      expect(admin.picks.map((p) => [p.userId, p.team]).sort()).toEqual(
        [
          [ADMIN, "KC"],
          [BOB, "KC"],
        ].sort(),
      );
      expect((await view(ANN, leagueId)).picks).toHaveLength(3);
      // A pick locks at its team's kickoff, and moves only to a game still to start.
      expect((await pick(ADMIN, week17, buf, "away")).body.error).toBe(
        "Your pick is locked: Raiders at Chiefs has kicked off.",
      );
      expect((await pick(ANN, week17, kc, "away")).body.error).toBe(
        "Raiders at Chiefs has already kicked off.",
      );
      expect((await pick(ADMIN, week17, kc, "home", ANN)).status).toBe(409);
    });

    it("fills in final scores, never over a typed one, finalizes once and opens the next week", async () => {
      const kc = await gameId(week17, "KC");
      // The admin types the Chiefs' score; the feed later says otherwise.
      expect(
        (await call(ADMIN, "PATCH", `/survivor-games/${kc}`, { homeScore: 27, awayScore: 20 })).status,
      ).toBe(200);
      finish(2026, 17, { "w17-kc": [10, 20], "w17-buf": [24, 3] });
      feed.set("2026:18", [
        game("w18-den", "DEN", "LAC", sunday(2026, 18, 18)),
        game("w18-phi", "PHI", "DAL", sunday(2026, 18, 21)),
        game("w18-min", "MIN", "CHI", sunday(2026, 18, 18)),
      ]);
      at(sunday(2026, 17, 30));
      // The cron and a player's read at once, then the cron again: the same state each time.
      await Promise.all([cron(), cron(), view(ANN, leagueId)]);
      await cron();

      const closed = await weekRow(leagueId, 17);
      expect(closed).toMatchObject({ status: "final" });
      expect((await slateOf(week17)).find((g) => g.id === kc)).toMatchObject({
        homeScore: 27,
        awayScore: 20,
      });
      const recorded = await db.select().from(weekParticipants).where(eq(weekParticipants.weekId, week17));
      expect(recorded.map((r) => r.userId).sort()).toEqual([ADMIN, ANN, BOB].sort());
      const next = await weekRow(leagueId, 18);
      week18 = next?.id ?? "";
      expect(next?.status).toBe("open");
      expect(await slateOf(week18)).toHaveLength(3);
      const final = await events(leagueId, `week-final:${week17}`);
      expect(final.map((e) => e.userId).sort()).toEqual([ADMIN, ANN, BOB].sort());
      expect(final[0]?.message.subject).toBe("Last One Standing: Week 17 is final");
      // No pick, no team, nothing about who is in or out.
      for (const { message } of final) {
        expect(`${message.subject}\n${message.text.split("\n--")[0]}`).not.toMatch(
          /Chiefs|Bills|Raiders|Jets|KC|BUF|alive|out\b|eliminated/i,
        );
      }
      // Everyone won, and Ann is recapped the closed week.
      const after = await view(ANN, leagueId);
      expect(after.players.every((p) => p.alive)).toBe(true);
      expect(after.current?.number).toBe(18);
      expect(after.current?.used).toEqual([{ team: "BUF", weekNumber: 17 }]);
      expect((await call<LeagueDetail>(ANN, "GET", `/leagues/${leagueId}`)).body.recapWeekId).toBe(week17);
    });

    it("lets a late joiner watch, not play", async () => {
      await join(CAT, leagueId);
      const cat = await view(CAT, leagueId);
      expect(cat.watching).toBe(true);
      expect(cat.players.map((p) => p.userId)).not.toContain(CAT);
      const den = await gameId(week18, "DEN");
      expect((await pick(CAT, week18, den, "home")).body.error).toBe(
        "You joined after this pool began. You can play next season.",
      );
    });

    it("follows flexed kickoffs, removes a cancelled game, and refuses used teams", async () => {
      at(sunday(2026, 18, 0).toISOString());
      const min = await gameId(week18, "MIN");
      expect((await pick(ANN, week18, min, "away")).status).toBe(200);
      expect((await pick(ADMIN, week18, await gameId(week18, "DEN"), "home")).status).toBe(200);
      // Two saves of Ann's at once: the advisory lock takes them in turn, and one pick is kept.
      const phi = await gameId(week18, "PHI");
      const saves = await Promise.all([pick(ANN, week18, phi, "home"), pick(ANN, week18, min, "away")]);
      expect(saves.map((r) => r.status)).toEqual([200, 200]);
      expect(await db.select().from(survivorPicks).where(eq(survivorPicks.weekId, week18))).toHaveLength(2);
      expect((await pick(ANN, week18, min, "away")).status).toBe(200);

      // The Eagles game is flexed to Sunday night; the next read follows it.
      const flexed = sunday(2026, 18, 25);
      const feedPhi = feed.get("2026:18")?.find((g) => g.externalId === "w18-phi");
      if (feedPhi) feedPhi.kickoff = flexed;
      at(new Date(clock.getTime() + 2 * 60_000));
      await view(ADMIN, leagueId);
      expect((await slateOf(week18)).find((g) => g.homeTeam === "PHI")?.kickoff).toEqual(flexed);

      // The Vikings game is cancelled: the admin removes it, Ann's pick on it goes, and she can pick again.
      expect((await call(ANN, "DELETE", `/survivor-games/${min}`)).status).toBe(403);
      expect((await call(ADMIN, "DELETE", `/survivor-games/${min}`)).status).toBe(200);
      expect((await view(ANN, leagueId)).current?.myPick).toBeNull();
      expect((await pick(ANN, week18, await gameId(week18, "PHI"), "home")).status).toBe(200);
      // A week keeps at least one game.
      at(new Date(clock.getTime() + 2 * 60_000));
      await cron();
      expect(await slateOf(week18)).toHaveLength(2);
    });

    it("reminds alive players with no pick, at 7pm the evening before", async () => {
      // Saturday 7pm in New York, the evening before Week 18's Sunday.
      at(new Date(sunday(2026, 18, 0).getTime()));
      const targets = (await survivorReminders.due(db, clock)).filter((t) => t.league.id === leagueId);
      expect(targets.flatMap((t) => t.players.map((p) => p.userId))).toEqual([BOB]);
      expect(targets[0]?.players[0]?.message).toMatchObject({
        kind: "text",
        heading: "Make your Week 18 pick",
      });
      const ref = { subjectId: week18, date: targets[0]?.date ?? "", userId: BOB };
      expect(await survivorReminders.stillDue(db, ref, clock)).not.toBeNull();
      expect(await survivorReminders.stillDue(db, { ...ref, userId: ANN }, clock)).toBeNull();
      expect(await survivorReminders.stillDue(db, { ...ref, userId: CAT }, clock)).toBeNull();
    });

    it("strikes a missed pick when the week ends, and waits for the whole Wild Card slate", async () => {
      finish(2026, 18, { "w18-den": [20, 10], "w18-phi": [24, 17] });
      // The feed lists five Wild Card games: the sixth's teams aren't known yet.
      const wildCard = slate(2026, 19, "wc", [
        "KC",
        "PIT",
        "BUF",
        "HOU",
        "BAL",
        "CLE",
        "SF",
        "SEA",
        "GB",
        "DET",
      ]);
      feed.set("2026:19", wildCard);
      at(sunday(2026, 18, 40));
      // A read advances the pool by itself.
      const read = await view(ANN, leagueId);
      expect((await weekRow(leagueId, 18))?.status).toBe("final");
      expect(read.players.find((p) => p.userId === BOB)).toMatchObject({
        alive: false,
        outWeek: 18,
        outReason: { kind: "missed" },
      });
      // The cancelled game wasn't imported back, and Week 19 waits for its slate.
      expect(await slateOf(week18)).toHaveLength(2);
      expect((await weekRow(leagueId, 19))?.status).toBe("draft");
      expect(read.current).toBeNull();

      feed.set("2026:19", [...wildCard, game("wc-5", "LAR", "TB", sunday(2026, 19, 23))]);
      at(new Date(clock.getTime() + 2 * 60_000));
      await cron();
      expect((await weekRow(leagueId, 19))?.status).toBe("open");
      expect(await slateOf((await weekRow(leagueId, 19))?.id ?? "")).toHaveLength(6);
    });

    it("resets used teams for the playoffs, and cancels a week that would put out everyone", async () => {
      const week19 = (await weekRow(leagueId, 19))?.id ?? "";
      expect((await view(ADMIN, leagueId)).current).toMatchObject({ number: 19, used: [] });
      // Both used their Week 17 teams in the regular season: the playoffs start afresh.
      expect((await pick(ADMIN, week19, await gameId(week19, "KC"), "home")).status).toBe(200);
      expect((await pick(ANN, week19, await gameId(week19, "BUF"), "home")).status).toBe(200);
      expect((await pick(BOB, week19, await gameId(week19, "SF"), "home")).body.error).toBe(
        "You're out of this pool.",
      );
      finish(2026, 19, {
        "wc-0": [10, 20],
        "wc-1": [10, 20],
        "wc-2": [20, 10],
        "wc-3": [20, 10],
        "wc-4": [20, 10],
        "wc-5": [20, 10],
      });
      feed.set("2026:20", slate(2026, 20, "div", ["KC", "PIT", "GB", "HOU", "BAL", "SF", "DET", "LAR"]));
      at(sunday(2026, 19, 40));
      await cron();
      const v = await view(ANN, leagueId);
      expect(v.weeks.find((w) => w.number === 19)).toMatchObject({
        status: "final",
        cancelled: true,
        out: [],
      });
      expect(
        v.players
          .filter((p) => p.alive)
          .map((p) => p.userId)
          .sort(),
      ).toEqual([ADMIN, ANN].sort());
      expect(v.current?.number).toBe(20);
    });

    it("ends the pool with one player left, and imports nothing more", async () => {
      const week20 = (await weekRow(leagueId, 20))?.id ?? "";
      // The Chiefs were the admin's Wild Card team.
      expect((await pick(ADMIN, week20, await gameId(week20, "KC"), "home")).body.error).toBe(
        "You used the Chiefs in Wild Card.",
      );
      expect((await pick(ADMIN, week20, await gameId(week20, "GB"), "home")).status).toBe(200);
      expect((await pick(ANN, week20, await gameId(week20, "GB"), "away")).status).toBe(200);
      finish(2026, 20, { "div-0": [20, 10], "div-1": [30, 3], "div-2": [20, 10], "div-3": [20, 10] });
      feed.set("2026:21", slate(2026, 21, "conf", ["GB", "BAL", "DET", "SEA"]));
      at(sunday(2026, 20, 40));
      await cron();
      await cron();
      const end = await view(ANN, leagueId);
      expect(end).toMatchObject({ over: true, winners: [ADMIN], current: null });
      expect(end.players.map((p) => [p.userId, p.alive, p.outWeek, p.winner])).toEqual([
        [ADMIN, true, null, true],
        [ANN, false, 20, false],
        [BOB, false, 18, false],
      ]);
      expect(end.players.find((p) => p.userId === ANN)?.outReason).toEqual({ kind: "lost", team: "HOU" });
      expect(await weekRow(leagueId, 21)).toBeUndefined();
      expect(await events(leagueId, `week-final:${week20}`)).toEqual([]);
      const over = await events(leagueId, "pool-over:%:20");
      expect(over.map((e) => e.userId).sort()).toEqual([ADMIN, ANN, BOB, CAT].sort());
      expect(over[0]?.message.subject).toBe("Last One Standing: The survivor pool is over");
      // Nothing more happens, however often it runs.
      at(new Date(clock.getTime() + 10 * 60_000));
      const before = asked.length;
      await cron();
      await view(ADMIN, leagueId);
      expect(await weekRow(leagueId, 21)).toBeUndefined();
      // A finished pool doesn't even ask the feed.
      expect(asked.slice(before).filter((key) => key.startsWith("2026:2"))).toEqual([]);
      expect(await events(leagueId, "pool-over:%")).toHaveLength(4);
      // The grid: every pick shows now, each with its outcome.
      expect(end.picks.filter((p) => p.userId === ANN).map((p) => [p.team, p.outcome])).toEqual([
        ["BUF", "won"],
        ["PHI", "won"],
        ["BUF", "lost"],
        ["HOU", "lost"],
      ]);
    });
  });

  it("shares the title among players still in after the Super Bowl, then stops", async () => {
    at("2027-08-01T12:00:00Z");
    const res = await create(DAN, { name: "Everybody Wins", settings: { startWeek: 18 } });
    const leagueId = res.body.id;
    await join(ANN, leagueId);
    const teams = ["KC", "PIT", "BUF", "HOU", "BAL", "CLE", "SF", "SEA", "GB", "DET", "LAR", "TB"];
    const sizes: Record<number, number> = { 18: 6, 19: 6, 20: 4, 21: 2, 22: 1 };
    // Each week: Dan's and Ann's picks (game index, side), and which side wins every game.
    type Side = "home" | "away";
    const plan: Record<number, { dan: [number, Side]; ann: [number, Side]; wins: Side }> = {
      18: { dan: [0, "home"], ann: [1, "home"], wins: "home" },
      // The used teams reset: the Chiefs and the Bills again.
      19: { dan: [0, "home"], ann: [1, "home"], wins: "home" },
      20: { dan: [2, "home"], ann: [3, "home"], wins: "home" },
      21: { dan: [0, "away"], ann: [1, "away"], wins: "away" },
      // Dan has used both Super Bowl teams, so he may pick either.
      22: { dan: [0, "home"], ann: [0, "home"], wins: "home" },
    };
    for (let n = 18; n <= 22; n++) {
      feed.set(`2027:${n}`, slate(2027, n, `y27-${n}`, teams.slice(0, 2 * (sizes[n] ?? 1))));
      at(sunday(2027, n, 0));
      await cron();
      const week = await weekRow(leagueId, n);
      expect(week?.status).toBe("open");
      const rows = await slateOf(week?.id ?? "");
      const step = plan[n];
      if (!step) throw new Error("no plan");
      for (const [user, [index, side]] of [
        [DAN, step.dan],
        [ANN, step.ann],
      ] as const) {
        expect((await pick(user, week?.id ?? "", rows[index]?.id ?? "", side)).body).toEqual({ ok: true });
      }
      const score: [number, number] = step.wins === "home" ? [30, 10] : [10, 30];
      finish(2027, n, Object.fromEntries(rows.map((g) => [g.externalId ?? "", score])));
      at(sunday(2027, n, 40));
      await cron();
    }
    const end = await view(DAN, leagueId);
    expect(end.over).toBe(true);
    expect([...end.winners].sort()).toEqual([ANN, DAN].sort());
    expect(await events(leagueId, "pool-over:%")).toHaveLength(2);
    at(new Date(clock.getTime() + 24 * 60 * 60_000));
    await cron();
    const all = await db
      .select({ id: weeks.id })
      .from(weeks)
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .where(eq(seasons.leagueId, leagueId));
    expect(all).toHaveLength(5);
  });

  it("catches one league's failure on its own, and the others still advance", async () => {
    at("2028-08-01T12:00:00Z");
    const broken = await create(DAN, { name: "Broken feed", settings: { startWeek: 5 } });
    const fine = await create(DAN, { name: "Fine feed", settings: { startWeek: 6 } });
    feed.set("2028:6", [game("y28-6", "KC", "LV", sunday(2028, 6))]);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const run = await cron(async (year, week) => {
      if (week === 5) throw new Error("feed exploded");
      return nfl.getWeek(year, week);
    });
    expect(run.failed).toBeGreaterThanOrEqual(1);
    expect(errors.mock.calls.some(([line]) => String(line).includes('"operation":"automation_league"'))).toBe(
      true,
    );
    errors.mockRestore();
    expect((await weekRow(broken.body.id, 5))?.status).toBe("draft");
    expect((await weekRow(fine.body.id, 6))?.status).toBe("open");
  });

  it("starts or re-sets a season through the hook until it begins, and answers 404 for another type", async () => {
    at("2029-07-01T12:00:00Z");
    const pool = await create(DAN, { name: "Hooked", settings: { lives: 1 } });
    const [league] = await db.select().from(leagues).where(eq(leagues.id, pool.body.id));
    if (!league) throw new Error("no league");
    // Created in July: the next week is Week 1.
    expect((await weekRow(league.id, 1))?.status).toBe("draft");
    const start = (settings: unknown) =>
      db.transaction(async (tx) => {
        await survivorHooks.startSeason?.(tx, { league, year: 2029, settings, at: clock, actorId: DAN });
      });
    await start({ lives: 3, startWeek: 4 });
    const [season] = await db.select().from(seasons).where(eq(seasons.leagueId, league.id));
    expect(season?.settings).toEqual({ lives: 3, startWeek: 4 });
    expect(await weekRow(league.id, 1)).toBeUndefined();
    expect((await weekRow(league.id, 4))?.status).toBe("draft");
    // Once the start week has kicked off, the settings are fixed.
    feed.set("2029:4", [game("y29-4", "KC", "LV", sunday(2029, 4))]);
    await cron();
    at(sunday(2029, 4, 20));
    await expect(start({ lives: 1 })).rejects.toThrow("This pool has started");

    // Another type's league and week: every survivor route is a 404, and the pick'em routes refuse survivor.
    const weekly = await call<CreateLeagueResult>(DAN, "POST", "/leagues", { name: "Weekly" });
    created.push(weekly.body.id);
    const weeklyWeek = await call<{ id: string }>(DAN, "POST", `/leagues/${weekly.body.id}/weeks`, {
      year: 2029,
      number: 3,
      importGames: false,
    });
    await call(DAN, "POST", `/weeks/${weeklyWeek.body.id}/games`, {
      homeTeam: "KC",
      awayTeam: "LV",
      kickoff: "2029-09-30T17:00:00Z",
      spread: -3,
    });
    const [weeklyGame] = await slateOf(weeklyWeek.body.id);
    expect((await call(DAN, "GET", `/leagues/${weekly.body.id}/survivor`)).status).toBe(404);
    expect((await pick(DAN, weeklyWeek.body.id, weeklyGame?.id ?? "", "home")).status).toBe(404);
    expect((await call(DAN, "DELETE", `/survivor-games/${weeklyGame?.id}`)).status).toBe(404);
    const correct = { homeScore: 1, awayScore: 0 };
    expect((await call(DAN, "PATCH", `/survivor-games/${weeklyGame?.id}`, correct)).status).toBe(404);
    const survivorWeek = (await weekRow(league.id, 4))?.id;
    expect((await call(DAN, "GET", `/weeks/${survivorWeek}`)).status).toBe(404);
  });
});
