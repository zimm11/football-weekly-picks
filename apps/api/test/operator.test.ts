import assert from "node:assert/strict";
import {
  createDb,
  feedback,
  games,
  leagues,
  messagePosts,
  messageThreads,
  picks,
  profiles,
  seasons,
  weeks,
} from "@picks/db";
import {
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_PAGE_SIZE,
  type FeedbackItem,
  type FeedbackPage,
  type Me,
  type OperatorOverview,
} from "@picks/shared";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };
// Different ids from app.test.ts: the two files share a database and run side by side.
const OPERATOR = "00000000-0000-4000-8000-0000000000a1";
const PLAYER = "00000000-0000-4000-8000-0000000000a2";
const CHATTY = "00000000-0000-4000-8000-0000000000a3";
const USERS = [OPERATOR, PLAYER, CHATTY];
const verifyToken = async (token: string) => (USERS.includes(token) ? { id: token } : null);

describe("without a database", () => {
  const app = createApp({ db: {} as never, verifyToken, publicConfig, nfl: { getWeek: async () => [] } });

  it("needs a signed-in player to send feedback or open the operator screen", async () => {
    expect((await app.request("/api/feedback", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/operator/overview")).status).toBe(401);
    expect((await app.request("/api/operator/feedback")).status).toBe(401);
  });

  it("hides the operator screen when no operator is configured", async () => {
    const res = await app.request("/api/operator/overview", {
      headers: { Authorization: `Bearer ${PLAYER}` },
    });
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("with a database (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  // Rows the database stamps itself (leagues, accounts) use the real time, so the injected clock starts there.
  const START = new Date();
  let now = START;
  const app = createApp({
    db,
    verifyToken,
    publicConfig,
    nfl: { getWeek: async () => [] },
    now: () => now,
    operatorUserIds: [OPERATOR],
  });
  const call = async <T = unknown>(user: string, method: string, path: string, json?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${user}`,
        "Content-Type": "application/json",
        "User-Agent": "TestBrowser/1",
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const createdLeagues: string[] = [];
  const mine = (items: FeedbackItem[]) =>
    items.filter((item) => item.author?.email?.startsWith("operator-test-"));

  // Only touch rows this suite creates.
  const cleanUp = async () => {
    await db.delete(feedback).where(inArray(feedback.userId, USERS));
    if (createdLeagues.length) await db.delete(leagues).where(inArray(leagues.id, createdLeagues));
    await db.delete(profiles).where(inArray(profiles.userId, USERS));
  };

  beforeAll(async () => {
    for (const [i, id] of USERS.entries()) {
      await db.execute(
        sql`insert into auth.users (id, email, created_at) values (${id}, ${`operator-test-${i}@example.com`}, now())
            on conflict (id) do update set created_at = now()`,
      );
    }
    await cleanUp();
    await call(PLAYER, "PUT", "/me", { displayName: "Pat" });
  });

  afterAll(async () => {
    await cleanUp();
    await db.$close();
  });

  it("tells an account whether it is an operator", async () => {
    expect((await call<Me>(OPERATOR, "GET", "/me")).body.isOperator).toBe(true);
    expect((await call<Me>(PLAYER, "GET", "/me")).body.isOperator).toBe(false);
    const attemptedPromotion = await call<Me>(PLAYER, "PUT", "/me", { displayName: "Pat", isOperator: true });
    expect(attemptedPromotion.body.isOperator).toBe(false);
  });

  it("takes feedback from any player and checks it", async () => {
    const sent = await call(PLAYER, "POST", "/feedback", {
      kind: "bug",
      message: "  The standings table is cut off.  ",
      page: "/leagues/abc/standings",
    });
    expect(sent.status).toBe(201);
    now = new Date(START.getTime() + 60_000);
    expect(
      (await call(PLAYER, "POST", "/feedback", { kind: "feature", message: "Add playoffs" })).status,
    ).toBe(201);

    expect((await call(PLAYER, "POST", "/feedback", { kind: "bug", message: "   " })).status).toBe(400);
    expect((await call(PLAYER, "POST", "/feedback", { kind: "rant", message: "x" })).status).toBe(400);
    const offSite = { kind: "bug", message: "x", page: "https://example.com" };
    expect((await call(PLAYER, "POST", "/feedback", offSite)).status).toBe(400);
  });

  it("keeps feedback and app-wide numbers away from everyone but the operator", async () => {
    expect((await call(PLAYER, "GET", "/operator/overview")).status).toBe(404);
    expect((await call(PLAYER, "GET", "/operator/feedback")).status).toBe(404);
    const [item] = mine((await call<FeedbackPage>(OPERATOR, "GET", "/operator/feedback")).body.items);
    expect((await call(PLAYER, "PUT", `/operator/feedback/${item?.id}`, { status: "done" })).status).toBe(
      404,
    );
  });

  it("shows the operator each report with who sent it and from where, and lets them mark it done", async () => {
    const list = mine((await call<FeedbackPage>(OPERATOR, "GET", "/operator/feedback")).body.items);
    expect(list.map((item) => item.message)).toEqual(["Add playoffs", "The standings table is cut off."]);
    const bug = list[1];
    expect(bug).toMatchObject({
      kind: "bug",
      status: "open",
      page: "/leagues/abc/standings",
      userAgent: "TestBrowser/1",
      author: { displayName: "Pat", email: "operator-test-1@example.com" },
    });

    const feature = list[0];
    expect(
      (await call(OPERATOR, "PUT", `/operator/feedback/${feature?.id}`, { status: "done" })).status,
    ).toBe(200);
    // Status changes preserve the cursor order (newest first).
    const after = mine((await call<FeedbackPage>(OPERATOR, "GET", "/operator/feedback")).body.items);
    expect(after.map((item) => [item.message, item.status])).toEqual([
      ["Add playoffs", "done"],
      ["The standings table is cut off.", "open"],
    ]);

    expect((await call(OPERATOR, "PUT", `/operator/feedback/${OPERATOR}`, { status: "done" })).status).toBe(
      404,
    );
    expect((await call(OPERATOR, "PUT", "/operator/feedback/nope", { status: "done" })).status).toBe(404);
    expect((await call(OPERATOR, "PUT", `/operator/feedback/${bug?.id}`, { status: "gone" })).status).toBe(
      400,
    );
  });

  it("limits how much feedback one player can send in a day", async () => {
    const concurrent = await Promise.all(
      Array.from({ length: FEEDBACK_DAILY_LIMIT + 3 }, (_, i) =>
        call(CHATTY, "POST", "/feedback", { kind: "other", message: `Note ${i}` }),
      ),
    );
    expect(concurrent.filter((response) => response.status === 201)).toHaveLength(FEEDBACK_DAILY_LIMIT);
    expect(concurrent.filter((response) => response.status === 429)).toHaveLength(3);
    const blocked = await call<{ error: string }>(CHATTY, "POST", "/feedback", {
      kind: "other",
      message: "More",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/Try again tomorrow/);
    // Someone else is unaffected, and the limit lifts a day later.
    expect((await call(OPERATOR, "POST", "/feedback", { kind: "other", message: "Mine" })).status).toBe(201);
    now = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1000);
    expect((await call(CHATTY, "POST", "/feedback", { kind: "other", message: "Next day" })).status).toBe(
      201,
    );
    now = START;
  });

  it("summarizes accounts, leagues and activity for the operator", async () => {
    const before = (await call<OperatorOverview>(OPERATOR, "GET", "/operator/overview")).body;
    const created = await call<{ id: string }>(PLAYER, "POST", "/leagues", { name: "Operator test league" });
    createdLeagues.push(created.body.id);
    // Creating a league grants league admin permissions, never app operator access.
    expect((await call(PLAYER, "GET", "/operator/overview")).status).toBe(404);
    const after = (await call<OperatorOverview>(OPERATOR, "GET", "/operator/overview")).body;

    expect(after.generatedAt).toBe(START.toISOString());
    // Other suites share the database, so compare against the earlier reading rather than fixed totals.
    expect(after.leagues.total).toBeGreaterThan(before.leagues.total);
    expect(after.leagues.last7Days).toBeGreaterThan(before.leagues.last7Days);
    expect(after.accounts.total).toBeGreaterThanOrEqual(USERS.length);
    expect(after.accounts.last30Days).toBeGreaterThanOrEqual(USERS.length);
    expect(after.openFeedback).toBeGreaterThanOrEqual(1 + FEEDBACK_DAILY_LIMIT + 2);

    expect(after.recentLeagues.find((l) => l.id === created.body.id)).toMatchObject({
      name: "Operator test league",
      members: 1,
      lastPickAt: null,
    });
    expect(after.recentSignups.find((u) => u.email === "operator-test-1@example.com")).toMatchObject({
      displayName: "Pat",
      leagues: 1,
    });

    // Eight Monday-to-Sunday weeks, this one first.
    expect(after.weeks).toHaveLength(8);
    const monday = new Date(Date.UTC(START.getUTCFullYear(), START.getUTCMonth(), START.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    expect(after.weeks[0]?.weekStart).toBe(monday.toISOString().slice(0, 10));
    expect(after.weeks[0]?.leaguesCreated).toBeGreaterThanOrEqual(1);
    expect(after.weeks[0]?.signups).toBeGreaterThanOrEqual(USERS.length);
    expect(new Date(`${after.weeks[7]?.weekStart}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("counts activity without leaking private picks or league messages", async () => {
    const before = (await call<OperatorOverview>(OPERATOR, "GET", "/operator/overview")).body;
    const leagueId = createdLeagues[0] as string;
    const [season] = await db.insert(seasons).values({ leagueId, year: 2026 }).returning();
    assert(season);
    const [week] = await db
      .insert(weeks)
      .values({ seasonId: season.id, number: 1, status: "open" })
      .returning();
    assert(week);
    const [game] = await db
      .insert(games)
      .values({
        weekId: week.id,
        homeTeam: "PHI",
        awayTeam: "DAL",
        kickoff: START,
        points: 1,
      })
      .returning();
    assert(game);
    const older = new Date(START.getTime() - 10 * 86_400_000);
    await db.insert(picks).values([
      {
        userId: PLAYER,
        weekId: week.id,
        gameId: game.id,
        side: "away",
        isPow: true,
        createdAt: START,
        updatedAt: START,
      },
      {
        userId: CHATTY,
        weekId: week.id,
        gameId: game.id,
        side: "home",
        createdAt: older,
        updatedAt: older,
      },
    ]);
    const [thread] = await db
      .insert(messageThreads)
      .values({ leagueId, authorId: PLAYER, title: "Private thread" })
      .returning();
    assert(thread);
    await db.insert(messagePosts).values([
      {
        threadId: thread.id,
        authorId: PLAYER,
        body: "Private league message",
        position: 1,
        createdAt: START,
      },
      {
        threadId: thread.id,
        authorId: OPERATOR,
        body: "Another private message",
        position: 2,
        createdAt: START,
      },
    ]);
    const after = (await call<OperatorOverview>(OPERATOR, "GET", "/operator/overview")).body;
    expect(after.picks.total - before.picks.total).toBe(2);
    expect(after.picks.last7Days - before.picks.last7Days).toBe(1);
    expect(after.picks.last30Days - before.picks.last30Days).toBe(2);
    expect(after.messages.last7Days - before.messages.last7Days).toBe(2);
    // A player who both picks and posts counts once.
    expect(after.activePlayers.last7Days - before.activePlayers.last7Days).toBe(2);
    expect(after.activePlayers.last30Days - before.activePlayers.last30Days).toBe(3);
    expect(after.activeLeagues - before.activeLeagues).toBe(1);
    expect(after.weeks[0]?.picks).toBe((before.weeks[0]?.picks ?? 0) + 1);
    expect(after.recentLeagues.find((l) => l.id === leagueId)?.lastPickAt).toBe(START.toISOString());
    expect(JSON.stringify(after)).not.toMatch(
      /Private league message|Another private message|isPow|gameId|"side"/,
    );
  });

  it("paginates all reports even when timestamps tie and statuses change", async () => {
    const inserted = await db
      .insert(feedback)
      .values(
        Array.from({ length: FEEDBACK_PAGE_SIZE + 2 }, (_, i) => ({
          userId: PLAYER,
          kind: "other" as const,
          message: `Page test ${i}`,
          createdAt: new Date(START.getTime() + 3 * 86_400_000),
        })),
      )
      .returning({ id: feedback.id });
    const first = (await call<FeedbackPage>(OPERATOR, "GET", "/operator/feedback")).body;
    expect(first.items).toHaveLength(FEEDBACK_PAGE_SIZE);
    expect(first.nextCursor).toBe(first.items.at(-1)?.id);
    await call(OPERATOR, "PUT", `/operator/feedback/${first.nextCursor}`, { status: "done" });
    const second = (
      await call<FeedbackPage>(OPERATOR, "GET", `/operator/feedback?before=${first.nextCursor}`)
    ).body;
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of inserted) expect(ids).toContain(row.id);
    expect(second.nextCursor).toBeNull();
    expect((await call(OPERATOR, "GET", "/operator/feedback?before=invalid")).status).toBe(400);
  });
});
