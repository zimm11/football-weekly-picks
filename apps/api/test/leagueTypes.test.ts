import { randomUUID } from "node:crypto";
import {
  createDb,
  SQUARE_PERIODS as DB_SQUARE_PERIODS,
  emailOutbox,
  LEAGUE_MANAGEMENT_VALUES,
  LEAGUE_TYPE_VALUES,
  leagues,
  profiles,
  pushDeliveries,
  pushSubscriptions,
  seasons,
  squareBoards,
  weeks,
} from "@picks/db";
import {
  type CreateLeagueResult,
  LEAGUE_MANAGEMENT,
  LEAGUE_TYPES,
  type LeagueDetail,
  type LeagueSummary,
  SQUARE_PERIODS,
} from "@picks/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { AUTOMATION } from "../src/automation";
import type { OutgoingEmail } from "../src/email";
import { queueLeagueEvent } from "../src/leagueEvents";
import { espnProvider, espnScoreboardUrl, parseEspnScoreboard, superBowlWeek } from "../src/nfl";
import { drainOutbox, type EmailDeps, parseDedupeKey } from "../src/outbox";
import { drainPush } from "../src/pushQueue";
import type { PushSender } from "../src/pushSender";

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };

describe("league type lists", () => {
  it("are the same in the database schema and the shared registry", () => {
    expect([...LEAGUE_TYPE_VALUES]).toEqual([...LEAGUE_TYPES]);
    expect([...LEAGUE_MANAGEMENT_VALUES]).toEqual([...LEAGUE_MANAGEMENT]);
    expect([...DB_SQUARE_PERIODS]).toEqual([...SQUARE_PERIODS]);
  });

  it("parse a league event's dedupe key, whose event name may hold colons", () => {
    const [league, user] = [randomUUID(), randomUUID()];
    expect(parseDedupeKey(`league_event:${league}:${user}:week-final:abc:1`)).toEqual({
      kind: "league_event",
      leagueId: league,
      userId: user,
      event: "week-final:abc:1",
    });
    expect(parseDedupeKey(`league_event:${league}:${user}:`)).toBeNull();
    expect(parseDedupeKey(`league_event:nope:${user}:added`)).toBeNull();
  });
});

describe("schedule provider: the postseason", () => {
  const competitor = (
    homeAway: "home" | "away",
    abbreviation: string,
    score?: string,
    linescores?: number[],
    id = "1",
  ) => ({ homeAway, score, team: { abbreviation, id }, linescores: linescores?.map((value) => ({ value })) });
  const event = (
    id: string,
    competitors: ReturnType<typeof competitor>[],
    status: { period?: number; completed?: boolean; state?: string; name?: string } = {},
  ) => ({
    id,
    date: "2027-01-16T21:30Z",
    competitions: [
      {
        competitors,
        status: {
          period: status.period,
          type: { completed: status.completed ?? false, state: status.state, name: status.name },
        },
      },
    ],
  });

  it("maps weeks 19–22 onto ESPN's postseason, regular weeks onto the regular season", () => {
    const params = (url: string) => Object.fromEntries(new URL(url).searchParams);
    expect(params(espnScoreboardUrl(2026, 7))).toEqual({ dates: "2026", seasontype: "2", week: "7" });
    expect(params(espnScoreboardUrl(2026, 19))).toMatchObject({ seasontype: "3", week: "1" });
    expect(params(espnScoreboardUrl(2026, 20))).toMatchObject({ seasontype: "3", week: "2" });
    expect(params(espnScoreboardUrl(2026, 21))).toMatchObject({ seasontype: "3", week: "3" });
    // The Super Bowl is week 5 after a Pro Bowl week, unless the calendar says otherwise.
    expect(params(espnScoreboardUrl(2026, 22))).toMatchObject({ seasontype: "3", week: "5" });
    expect(params(espnScoreboardUrl(2026, 22, 4))).toMatchObject({ seasontype: "3", week: "4" });
  });

  it("reads the Super Bowl's week from the feed's calendar", async () => {
    const calendar = (entries: [string, string][]) => ({
      leagues: [{ calendar: [{ value: "3", entries: entries.map(([label, value]) => ({ label, value })) }] }],
    });
    expect(
      superBowlWeek(
        calendar([
          ["Wild Card", "1"],
          ["Pro Bowl", "4"],
          ["Super Bowl", "5"],
        ]),
      ),
    ).toBe(5);
    expect(
      superBowlWeek(
        calendar([
          ["Wild Card", "1"],
          ["Super Bowl", "4"],
        ]),
      ),
    ).toBe(4);
    expect(superBowlWeek({})).toBeNull();

    const asked: string[] = [];
    const provider = espnProvider(async (input) => {
      const url = String(input);
      asked.push(new URL(url).searchParams.get("week") ?? "");
      return Response.json(
        url.includes("week=3")
          ? { ...calendar([["Super Bowl", "4"]]), events: [] }
          : { events: [event("sb", [competitor("home", "SEA"), competitor("away", "KC")])] },
      );
    });
    expect((await provider.getWeek(2026, 22)).map((g) => g.externalId)).toEqual(["sb"]);
    expect(asked).toEqual(["3", "4"]);
  });

  it("drops placeholder games until both teams are known", () => {
    const games = parseEspnScoreboard({
      events: [
        event("tbd", [competitor("home", "TBD", "0", [], "-1"), competitor("away", "TBD", "0", [], "-2")]),
        event("half", [competitor("home", "BUF"), competitor("away", "TBD", undefined, [], "-2")]),
        event("real", [competitor("home", "BUF"), competitor("away", "MIA")]),
      ],
    });
    expect(games.map((g) => g.externalId)).toEqual(["real"]);
  });

  it("gives the cumulative score for each settled quarter, with overtime in the final", () => {
    const [halftime] = parseEspnScoreboard({
      events: [
        event("g", [competitor("home", "DEN", "20", [3, 17]), competitor("away", "BUF", "10", [7, 3])], {
          period: 2,
          state: "in",
          name: "STATUS_HALFTIME",
        }),
      ],
    });
    expect(halftime).toMatchObject({
      status: "in_progress",
      period: 2,
      homeScore: null,
      periodScores: { q1: { home: 3, away: 7 }, half: { home: 20, away: 10 } },
    });
    expect(halftime?.periodScores?.q3).toBeUndefined();

    const [third] = parseEspnScoreboard({
      events: [
        event(
          "g",
          [competitor("home", "DEN", "23", [3, 17, 3]), competitor("away", "BUF", "17", [7, 3, 7])],
          {
            period: 3,
            state: "in",
            name: "STATUS_IN_PROGRESS",
          },
        ),
      ],
    });
    // Q3 is still being played: only Q1 and the half count.
    expect(Object.keys(third?.periodScores ?? {})).toEqual(["q1", "half"]);

    const [overtime] = parseEspnScoreboard({
      events: [
        event(
          "g",
          [
            competitor("home", "DEN", "33", [3, 17, 3, 7, 3]),
            competitor("away", "BUF", "30", [7, 3, 7, 13, 0]),
          ],
          { period: 5, completed: true, state: "post", name: "STATUS_FINAL" },
        ),
      ],
    });
    expect(overtime).toMatchObject({
      status: "final",
      period: 5,
      homeScore: 33,
      awayScore: 30,
      periodScores: {
        q1: { home: 3, away: 7 },
        half: { home: 20, away: 10 },
        q3: { home: 23, away: 17 },
        final: { home: 33, away: 30 },
      },
    });
  });
});

describe.skipIf(!process.env.DATABASE_URL)("league types with a database (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  const OPERATOR = randomUUID();
  const ADMIN = randomUUID();
  const PAT = randomUUID();
  const SAM = randomUUID();
  const FULL = randomUUID();
  const STRANGER = randomUUID();
  const users: string[] = [OPERATOR, ADMIN, PAT, SAM, FULL, STRANGER];
  const names = ["Op", "Commish", "Pat", "Sam", "Full", "Stranger"];
  const verifyToken = async (token: string) => (users.includes(token) ? { id: token } : null);
  const now = new Date("2026-11-18T15:00:00Z");
  let sent: OutgoingEmail[] = [];
  const email: EmailDeps = {
    mailer: { send: async (message) => void sent.push(message) },
    appUrl: "https://picks.test",
    unsubscribeSecret: "test-unsubscribe-secret-that-is-long-enough",
    limits: { daily: 10_000, monthly: 100_000 },
  };
  const pushSend = vi.fn<PushSender["send"]>(async () => "sent");
  const push: PushSender = { publicKey: `B${"a".repeat(86)}`, send: pushSend };
  const pending: Promise<unknown>[] = [];
  const settle = async () => {
    while (pending.length) await Promise.all(pending.splice(0));
  };
  const build = (limits = { membersPerLeague: 100, leaguesPerUser: 25 }) =>
    createApp({
      db,
      verifyToken,
      publicConfig,
      nfl: { getWeek: async () => [] },
      now: () => now,
      email,
      push,
      limits,
      operatorUserIds: [OPERATOR],
      background: (task) => pending.push(task()),
    });
  const app = build();
  const callOn =
    (target: ReturnType<typeof createApp>) =>
    async <T = unknown>(user: string, method: string, path: string, json?: unknown) => {
      const res = await target.request(`/api${path}`, {
        method,
        headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
        body: json === undefined ? undefined : JSON.stringify(json),
      });
      return { status: res.status, body: (await res.json()) as T };
    };
  const call = callOn(app);
  const created: string[] = [];
  const create = async (user: string, json: Record<string, unknown>, on = call) => {
    const res = await on<CreateLeagueResult>(user, "POST", "/leagues", json);
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

  /** A week on a league's first season, inserted directly (the type's own routes will create them). */
  async function weekOf(leagueId: string, number: number) {
    await db.insert(seasons).values({ leagueId, year: 2026 }).onConflictDoNothing();
    const [season] = await db.select().from(seasons).where(eq(seasons.leagueId, leagueId));
    const [week] = await db
      .insert(weeks)
      .values({ seasonId: season?.id ?? "", number, status: "open" })
      .returning();
    return week?.id ?? "";
  }

  beforeAll(async () => {
    for (const [i, id] of users.entries()) {
      await db.execute(sql`insert into auth.users (id, email) values (${id}, ${`types-${i}@example.com`})`);
    }
    await db
      .insert(profiles)
      .values(users.map((userId, i) => ({ userId, displayName: names[i] ?? "Player" })));
  });
  afterAll(async () => {
    await settle();
    if (created.length) await db.delete(leagues).where(inArray(leagues.id, created));
    await db.execute(
      sql`delete from auth.users where id in (${sql.join(
        users.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    await db.$close();
  });

  it("creates weekly leagues hands-on by default, or Automatic when asked", async () => {
    const plain = await create(ADMIN, { name: "Plain" });
    expect(plain.status).toBe(201);
    expect(plain.body).toMatchObject({ added: 0, skipped: [] });
    const summary = (await call<LeagueSummary[]>(ADMIN, "GET", "/leagues")).body.find(
      (l) => l.id === plain.body.id,
    );
    expect(summary).toMatchObject({ type: "weekly", management: "manual" });
    expect((await call<LeagueDetail>(ADMIN, "GET", `/leagues/${plain.body.id}`)).body).toMatchObject({
      type: "weekly",
      management: "manual",
    });

    const auto = await create(ADMIN, { name: "Auto", management: "auto" });
    expect(auto.status).toBe(201);
    expect((await call<LeagueDetail>(ADMIN, "GET", `/leagues/${auto.body.id}`)).body.management).toBe("auto");
  });

  it("creates every type for everyone, and starts their first season with its settings", async () => {
    expect((await create(STRANGER, { name: "Bad", type: "squares", management: "manual" })).status).toBe(400);
    expect((await create(STRANGER, { name: "Bad", type: "survivor", settings: { lives: 5 } })).status).toBe(
      400,
    );

    const pool = await create(STRANGER, { name: "Pool", type: "survivor", settings: { lives: 2 } });
    expect(pool.status).toBe(201);
    const detail = (await call<LeagueDetail>(STRANGER, "GET", `/leagues/${pool.body.id}`)).body;
    expect(detail).toMatchObject({ type: "survivor", management: "auto" });
    const [season] = await db.select().from(seasons).where(eq(seasons.leagueId, pool.body.id));
    expect(season).toMatchObject({ year: 2026, settings: { lives: 2 } });

    const playoff = await create(STRANGER, { name: "Bracket", type: "playoff" });
    const [playoffSeason] = await db.select().from(seasons).where(eq(seasons.leagueId, playoff.body.id));
    expect(playoffSeason?.settings).toEqual({ format: "traditional" });
  });

  it("tells the app which seasons a playoff or survivor league has started, before any week exists", async () => {
    // A playoff season has no round until January, and members aren't sent a pool's draft start week: the
    // started years are how the app knows to open on this season rather than last year's finished one.
    const playoff = await create(STRANGER, { name: "Started bracket", type: "playoff" });
    const path = `/leagues/${playoff.body.id}`;
    const fresh = (await call<LeagueDetail>(STRANGER, "GET", path)).body;
    expect(fresh.weeks).toEqual([]);
    expect(fresh.startedSeasons).toEqual([2026]);
    // Start season adds next year's, newest first.
    expect(
      (await call(STRANGER, "POST", `${path}/seasons`, { year: 2027, settings: { format: "guillotine" } }))
        .status,
    ).toBe(201);
    expect((await call<LeagueDetail>(STRANGER, "GET", path)).body.startedSeasons).toEqual([2027, 2026]);

    const pool = await create(STRANGER, { name: "Started pool", type: "survivor", settings: { lives: 1 } });
    expect(
      (await call<LeagueDetail>(STRANGER, "GET", `/leagues/${pool.body.id}`)).body.startedSeasons,
    ).toEqual([2026]);

    // Weekly pick'em's season begins with its first open week, and squares has no seasons: nothing to tell.
    const weekly = await create(STRANGER, { name: "Weekly auto", management: "auto" });
    expect(
      (await call(STRANGER, "POST", `/leagues/${weekly.body.id}/seasons`, { year: 2026, startWeek: 14 }))
        .status,
    ).toBe(201);
    expect(
      (await call<LeagueDetail>(STRANGER, "GET", `/leagues/${weekly.body.id}`)).body.startedSeasons,
    ).toEqual([]);
    const squares = await create(STRANGER, { name: "Squares", type: "squares" });
    expect(
      (await call<LeagueDetail>(STRANGER, "GET", `/leagues/${squares.body.id}`)).body.startedSeasons,
    ).toEqual([]);
  });

  it("switches a weekly league between Automatic and Hands-on", async () => {
    const mine = await create(STRANGER, { name: "Switchable" });
    const path = `/leagues/${mine.body.id}`;
    expect((await call(STRANGER, "PATCH", path, { management: "auto" })).status).toBe(200);
    expect((await call<LeagueDetail>(STRANGER, "GET", path)).body.management).toBe("auto");
    expect((await call(STRANGER, "PATCH", path, { management: "manual" })).status).toBe(200);

    const pool = await create(STRANGER, { name: "No switch", type: "squares" });
    expect((await call(STRANGER, "PATCH", `/leagues/${pool.body.id}`, { management: "manual" })).status).toBe(
      409,
    );
  });

  it("answers 404 when a route is for another league type", async () => {
    const weekly = await create(OPERATOR, { name: "Weekly guard" });
    const squares = await create(OPERATOR, { name: "Squares guard", type: "squares" });
    const survivor = await create(OPERATOR, { name: "Survivor guard", type: "survivor" });
    const playoff = await create(OPERATOR, { name: "Playoff guard", type: "playoff" });

    // The pick'em week routes serve weekly and playoff leagues only.
    const survivorWeek = await weekOf(survivor.body.id, 3);
    const playoffWeek = await weekOf(playoff.body.id, 19);
    expect((await call(OPERATOR, "GET", `/weeks/${survivorWeek}`)).status).toBe(404);
    expect(
      (
        await call(OPERATOR, "PUT", `/weeks/${survivorWeek}/picks`, {
          picks: [],
          powGameId: null,
          tiebreakerTotal: null,
        })
      ).status,
    ).toBe(404);
    expect((await call(OPERATOR, "POST", `/weeks/${survivorWeek}/finalize`)).status).toBe(404);
    expect((await call(OPERATOR, "GET", `/weeks/${playoffWeek}`)).status).toBe(200);
    expect(
      (await call(OPERATOR, "POST", `/leagues/${squares.body.id}/weeks`, { year: 2026, number: 3 })).status,
    ).toBe(404);
    // A playoff league has no regular-season weeks; weekly creation still stops at 18.
    expect(
      (await call(OPERATOR, "POST", `/leagues/${playoff.body.id}/weeks`, { year: 2026, number: 3 })).status,
    ).toBe(409);
    expect(
      (await call(OPERATOR, "POST", `/leagues/${weekly.body.id}/weeks`, { year: 2026, number: 19 })).status,
    ).toBe(400);

    // Each type's own routes refuse the others.
    expect((await call(OPERATOR, "GET", `/leagues/${squares.body.id}/boards`)).status).toBe(200);
    expect((await call(OPERATOR, "GET", `/leagues/${weekly.body.id}/boards`)).status).toBe(404);
    expect((await call(OPERATOR, "GET", `/leagues/${weekly.body.id}/survivor`)).status).toBe(404);
    expect((await call(OPERATOR, "GET", `/leagues/${survivor.body.id}/playoff/standings`)).status).toBe(404);
    const [board] = await db
      .insert(squareBoards)
      .values({ leagueId: squares.body.id, homeTeam: "KC", awayTeam: "PHI", kickoff: now })
      .returning();
    expect((await call(STRANGER, "GET", `/boards/${board?.id}`)).status).toBe(404);
  });

  it("copies an admin's league members in, skipping anyone at the league limit", async () => {
    const source = await create(ADMIN, { name: "Sunday Crew" });
    for (const user of [PAT, SAM, FULL]) await join(user, source.body.id);
    // Sam leaves before the copy: only current members come along.
    expect((await call(SAM, "DELETE", `/leagues/${source.body.id}/members/${SAM}`)).status).toBe(200);
    // Pat isn't an admin of the source, and a stranger isn't in it.
    expect((await create(PAT, { name: "Not mine", copyMembersFrom: source.body.id })).status).toBe(403);
    expect((await create(STRANGER, { name: "Not mine", copyMembersFrom: source.body.id })).status).toBe(404);

    // Full is in four leagues, the most this app allows; the creator (in three) and Pat still have room.
    for (const name of ["Blocker 1", "Blocker 2", "Blocker 3"]) {
      const blocker = await create(OPERATOR, { name });
      await join(FULL, blocker.body.id);
    }
    const limited = callOn(build({ membersPerLeague: 100, leaguesPerUser: 4 }));
    sent = [];
    pushSend.mockClear();
    await db.insert(pushSubscriptions).values({
      userId: PAT,
      endpoint: `https://web.push.apple.com/${randomUUID()}`,
      p256dh: "k",
      auth: "a",
    });
    const copied = await create(ADMIN, { name: "Sunday Rematch", copyMembersFrom: source.body.id }, limited);
    expect(copied.status).toBe(201);
    expect(copied.body.added).toBe(1);
    expect(copied.body.skipped).toEqual([{ userId: FULL, displayName: "Full", reason: "player_limit" }]);
    const detail = (await call<LeagueDetail>(ADMIN, "GET", `/leagues/${copied.body.id}`)).body;
    expect(detail.members.map((m) => [m.displayName, m.role])).toEqual([
      ["Commish", "admin"],
      ["Pat", "member"],
    ]);

    // Pat is told once, by email and on their device; the creator isn't.
    await settle();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ["types-2@example.com", "Sunday Rematch: You've been added to Sunday Rematch"],
    ]);
    expect(sent[0]?.text.split("\n")[0]).not.toMatch(/pick|square|survive|alive/i);
    expect(pushSend).toHaveBeenCalledOnce();
    expect(pushSend.mock.calls[0]?.[1]).toMatchObject({
      title: "Sunday Rematch",
      body: "You've been added to Sunday Rematch",
      url: `/leagues/${copied.body.id}`,
    });
  });

  it("stops at a full league when copying members", async () => {
    const source = await create(OPERATOR, { name: "Big crew" });
    for (const user of [PAT, SAM]) await join(user, source.body.id);
    const small = callOn(build({ membersPerLeague: 2, leaguesPerUser: 25 }));
    const copied = await create(OPERATOR, { name: "Small copy", copyMembersFrom: source.body.id }, small);
    expect(copied.status).toBe(201);
    expect(copied.body.added).toBe(1);
    expect(copied.body.skipped.map((s) => s.reason)).toEqual(["league_full"]);
  });

  it("queues a league event once per player, and rechecks membership and the switch before sending", async () => {
    const league = await create(OPERATOR, { name: "Events" });
    const leagueId = league.body.id;
    for (const user of [PAT, SAM]) await join(user, leagueId);
    const event = {
      leagueId,
      event: "week-final:test:1",
      headline: "Week 7 is final",
      path: `/leagues/${leagueId}`,
    };
    const deps = { email, push };
    expect(await queueLeagueEvent(db, deps, { ...event, exceptUserIds: [OPERATOR] }, now)).toMatchObject({
      emails: 2,
    });
    // A repeated run queues nothing twice.
    expect(await queueLeagueEvent(db, deps, { ...event, exceptUserIds: [OPERATOR] }, now)).toMatchObject({
      emails: 0,
    });
    // Push only: no email at all.
    expect(
      await queueLeagueEvent(db, deps, { ...event, event: "q1:test", pushOnly: true }, now),
    ).toMatchObject({
      emails: 0,
    });
    await expect(queueLeagueEvent(db, deps, { ...event, event: "bad name" }, now)).rejects.toThrow();

    // Sam leaves and Pat turns results emails off before the send.
    await call(SAM, "DELETE", `/leagues/${leagueId}/members/${SAM}`);
    await call(PAT, "PUT", "/me/notifications", { leagueEvents: false });
    sent = [];
    await drainOutbox(db, email, now);
    expect(sent.filter((m) => m.subject.startsWith("Events:"))).toEqual([]);
    const rows = await db
      .select({ userId: emailOutbox.userId, status: emailOutbox.status, lastError: emailOutbox.lastError })
      .from(emailOutbox)
      .where(sql`${emailOutbox.dedupeKey} like ${`league_event:${leagueId}:%`}`);
    expect(rows.map((r) => [r.userId, r.status, r.lastError]).sort()).toEqual(
      [
        [PAT, "skipped", "OPTED_OUT"],
        [SAM, "skipped", "NOT_A_MEMBER"],
      ].sort(),
    );

    // On a device, the switch is rechecked too.
    await call(PAT, "PUT", "/me/notifications", { leagueEvents: true });
    pushSend.mockClear();
    await db.update(pushSubscriptions).set({ leagueEvents: false }).where(eq(pushSubscriptions.userId, PAT));
    await queueLeagueEvent(db, { push }, { ...event, event: "opened:test" }, now);
    await db.update(pushSubscriptions).set({ leagueEvents: true }).where(eq(pushSubscriptions.userId, PAT));
    await queueLeagueEvent(db, { push }, { ...event, event: "opened:test2" }, now);
    await db.update(pushSubscriptions).set({ leagueEvents: false }).where(eq(pushSubscriptions.userId, PAT));
    await drainPush(db, push, now);
    expect(pushSend).not.toHaveBeenCalled();
    const queued = await db
      .select({ status: pushDeliveries.status })
      .from(pushDeliveries)
      .where(and(eq(pushDeliveries.leagueId, leagueId), eq(pushDeliveries.kind, "league_event")));
    expect(queued.every((d) => d.status === "skipped")).toBe(true);
  });

  it("turns results and updates emails off from their unsubscribe link", async () => {
    const league = await create(OPERATOR, { name: "Unsubscribe" });
    await join(PAT, league.body.id);
    await call(PAT, "PUT", "/me/notifications", { leagueEvents: true });
    await queueLeagueEvent(
      db,
      { email },
      { leagueId: league.body.id, event: "added", headline: "Hi", path: "/" },
      now,
    );
    const [row] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.dedupeKey, `league_event:${league.body.id}:${PAT}:added`));
    const token = new URL(row?.message.listUnsubscribeUrl ?? "http://x").searchParams.get("token") ?? "";
    const res = await app.request(`/api/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" });
    expect(await res.json()).toEqual({ kind: "league_event" });
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, PAT));
    expect(profile).toMatchObject({ emailLeagueEvents: false, emailNewThreads: true });
  });

  it("advances a league that runs itself when it is read, at most once a minute", async () => {
    const advance = vi.spyOn(AUTOMATION.survivor, "advance");
    const pool = await create(OPERATOR, { name: "On read", type: "survivor" });
    const hands = await create(OPERATOR, { name: "Hands-on read" });
    const reader = callOn(build());
    await reader(OPERATOR, "GET", `/leagues/${pool.body.id}`);
    await reader(OPERATOR, "GET", `/leagues/${pool.body.id}`);
    await reader(OPERATOR, "GET", `/leagues/${hands.body.id}`);
    expect(advance).toHaveBeenCalledOnce();
    expect(advance.mock.calls[0]?.[1]).toMatchObject({ id: pool.body.id, type: "survivor" });
    advance.mockRestore();
  });
});
