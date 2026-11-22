import { randomUUID } from "node:crypto";
import { createDb, emailOutbox, games, leagues, profiles, seasons, weeks } from "@picks/db";
import type { CreateLeagueResult } from "@picks/shared";
import { asc, eq, inArray, like, sql } from "drizzle-orm";
import { expect } from "vitest";
import { createApp } from "../src/app";
import { AUTOMATION, type AutomationContext, advanceLeague } from "../src/automation";
import type { NflProvider, ProviderGame } from "../src/nfl";
import type { EmailDeps } from "../src/outbox";
import { providerWeeks } from "../src/weekOps";

/*
 * What the automatic pick'em API tests share: a database with its own players, a scripted feed (counting what it
 * is asked, and failing on demand), a clock the test moves, and a way to run one type's automation for the test's
 * own leagues only, the way the cron does (its due query, then each league), without touching other leagues in the
 * database.
 */

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };

export function pickemSetup(names: string[]) {
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  const users: string[] = names.map(() => randomUUID());
  const feed = new Map<string, ProviderGame[]>();
  const asked: string[] = [];
  // `feedDown` makes every read of the feed fail, as an outage would.
  const state = { now: new Date("2026-11-20T12:00:00Z"), feedDown: false };
  const nfl: NflProvider = {
    async getWeek(year, week) {
      asked.push(`${year}:${week}`);
      if (state.feedDown) throw new Error("offline");
      return (feed.get(`${year}:${week}`) ?? []).map((g) => ({ ...g }));
    },
  };
  const email: EmailDeps = {
    mailer: { send: async () => {} },
    appUrl: "https://picks.test",
    unsubscribeSecret: "test-unsubscribe-secret-that-is-long-enough",
    limits: { daily: 10_000, monthly: 100_000 },
  };
  const app = createApp({
    db,
    verifyToken: async (token) => (users.includes(token) ? { id: token } : null),
    publicConfig,
    nfl,
    now: () => state.now,
    email,
    background: (task) => void task(),
  });
  const created: string[] = [];

  async function call<T = unknown>(user: string, method: string, path: string, json?: unknown) {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: res.status, body: (await res.json()) as T };
  }

  async function createLeague(user: string, json: Record<string, unknown>) {
    const res = await call<CreateLeagueResult>(user, "POST", "/leagues", json);
    expect(res.status).toBe(201);
    created.push(res.body.id);
    return res.body.id;
  }

  async function join(user: string, leagueId: string) {
    const [league] = await db
      .select({ code: leagues.inviteCode })
      .from(leagues)
      .where(eq(leagues.id, leagueId));
    expect((await call(user, "POST", `/invites/${league?.code}/join`)).status).toBe(200);
  }

  /** Runs `type`'s automation once at the test's clock, as the cron does, for these leagues only. */
  async function runAutomation(type: "weekly" | "playoff", leagueIds: string[]) {
    const ctx: AutomationContext = {
      db,
      nfl,
      now: state.now,
      results: providerWeeks(nfl, () => state.now),
      notify: { email },
    };
    const due = (await AUTOMATION[type].due(ctx, 10_000)).filter((l) => leagueIds.includes(l.id));
    for (const league of due) await advanceLeague(ctx, league);
    return due.map((l) => l.id);
  }

  /** A league's weeks with their games, in order, as the database has them. */
  async function weeksOf(leagueId: string) {
    const rows = await db
      .select({ week: weeks })
      .from(weeks)
      .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
      .where(eq(seasons.leagueId, leagueId))
      .orderBy(asc(weeks.number));
    const slates = rows.length
      ? await db
          .select()
          .from(games)
          .where(
            inArray(
              games.weekId,
              rows.map((r) => r.week.id),
            ),
          )
          .orderBy(asc(games.kickoff), asc(games.externalId))
      : [];
    return rows.map(({ week }) => ({ ...week, games: slates.filter((g) => g.weekId === week.id) }));
  }

  /** The league events queued by email, as `<userId> <event>`, sorted. */
  async function events(leagueId: string) {
    const rows = await db
      .select({ key: emailOutbox.dedupeKey })
      .from(emailOutbox)
      .where(like(emailOutbox.dedupeKey, `league_event:${leagueId}:%`));
    return rows.map((r) => r.key.slice(`league_event:${leagueId}:`.length).replace(":", " ")).sort();
  }

  async function setUp() {
    for (const [i, id] of users.entries()) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}, ${`pickem-${i}-${id}@example.com`})`,
      );
    }
    await db
      .insert(profiles)
      .values(users.map((userId, i) => ({ userId, displayName: names[i] ?? "Player" })));
  }

  async function tearDown() {
    if (created.length) await db.delete(leagues).where(inArray(leagues.id, created));
    await db.delete(emailOutbox).where(inArray(emailOutbox.userId, users));
    await db.execute(
      sql`delete from auth.users where id in (${sql.join(
        users.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    );
    await db.$close();
  }

  return {
    db,
    users,
    feed,
    asked,
    state,
    app,
    call,
    createLeague,
    join,
    runAutomation,
    weeksOf,
    events,
    setUp,
    tearDown,
  };
}

/** A provider game. */
export const feedGame = (
  externalId: string,
  homeTeam: string,
  awayTeam: string,
  kickoff: string,
  spread: number | null,
  score?: [number, number],
): ProviderGame => ({
  externalId,
  homeTeam,
  awayTeam,
  kickoff: new Date(kickoff),
  spread,
  homeScore: score ? score[0] : null,
  awayScore: score ? score[1] : null,
});
