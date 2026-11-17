import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  contentReports,
  createDb,
  emailOutbox,
  feedback,
  games,
  leagueMembers,
  leagues,
  messageReactions,
  messageReads,
  picks,
  profiles,
  pushSubscriptions,
  seasons,
  squareBoards,
  squareClaims,
  survivorPicks,
  tiebreakerGuesses,
  userBlocks,
  weeks,
} from "@picks/db";
import {
  type AccountDeletionPreview,
  DELETED_MESSAGE_TEXT,
  DELETED_PLAYER_NAME,
  DELETED_THREAD_TITLE,
  type Standings,
  type ThreadDetail,
} from "@picks/shared";
import { eq, inArray, or, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AccountAdmin, refuseDeletedAccounts, retryAuthDeletions } from "../src/accounts";
import { createApp } from "../src/app";

const ADMIN = randomUUID();
const PAT = randomUUID();
const SAM = randomUUID();
const USERS = [ADMIN, PAT, SAM];
const NAMES = ["Commish", "Pat", "Sam"];
const PASSWORD = "the right password";
/** Unique to this run, so the test finds and deletes only its own feedback. */
const FEEDBACK = `Deletion feedback ${randomUUID()}`;
const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };
const tokens = async (token: string) => ((USERS as string[]).includes(token) ? { id: token } : null);

describe.skipIf(!process.env.DATABASE_URL)("account deletion (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  // Supabase Auth, faked: the password check and the soft delete.
  let authWorks = true;
  const softDeleted: string[] = [];
  const accounts: AccountAdmin = {
    checkPassword: async (_email, password) => password === PASSWORD,
    softDelete: async (userId) => {
      if (!authWorks) return false;
      softDeleted.push(userId);
      return true;
    },
  };
  // As the entrypoints do: a deleted account's tokens are refused.
  const verifyToken = refuseDeletedAccounts(db, tokens);
  const app = createApp({ db, verifyToken, publicConfig, nfl: { getWeek: async () => [] }, accounts });
  const call = async <T = unknown>(user: string, method: string, path: string, json?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const remove = (user: string, password = PASSWORD) => call(user, "DELETE", "/me", { password });

  let leagueId = "";
  let finalWeek = "";
  let openWeek = "";
  const created: string[] = [];

  /** A league of three with a final week everyone picked and an open week Pat has picked. */
  async function seedLeague() {
    const [league] = await db
      .insert(leagues)
      .values({ name: "Deletion league", inviteCode: randomUUID() })
      .returning();
    assert(league);
    leagueId = league.id;
    created.push(league.id);
    const joined = new Date("2026-09-01T00:00:00Z");
    await db.insert(leagueMembers).values([
      { leagueId, userId: ADMIN, role: "admin", joinedAt: joined },
      { leagueId, userId: PAT, joinedAt: joined },
      { leagueId, userId: SAM, joinedAt: joined },
    ]);
    const [season] = await db.insert(seasons).values({ leagueId, year: 2026 }).returning();
    assert(season);
    const [done, open] = await db
      .insert(weeks)
      .values([
        { seasonId: season.id, number: 1, status: "final", finalizedAt: new Date("2026-09-10T12:00:00Z") },
        { seasonId: season.id, number: 2, status: "open" },
      ])
      .returning();
    assert(done && open);
    finalWeek = done.id;
    openWeek = open.id;
    const [g1, g2, g3] = await db
      .insert(games)
      .values([
        {
          weekId: done.id,
          homeTeam: "PHI",
          awayTeam: "DAL",
          kickoff: new Date("2026-09-06T17:00:00Z"),
          spread: -3,
          points: 1,
          homeScore: 24,
          awayScore: 17,
        },
        {
          weekId: done.id,
          homeTeam: "KC",
          awayTeam: "BUF",
          kickoff: new Date("2026-09-07T00:20:00Z"),
          spread: -2,
          points: 3,
          homeScore: 20,
          awayScore: 23,
        },
        {
          weekId: open.id,
          homeTeam: "NYJ",
          awayTeam: "NE",
          kickoff: new Date("2030-09-13T17:00:00Z"),
          spread: 1,
          points: 1,
        },
      ])
      .returning();
    assert(g1 && g2 && g3);
    await db.insert(picks).values([
      { weekId: done.id, gameId: g1.id, userId: ADMIN, side: "home", isPow: true },
      { weekId: done.id, gameId: g2.id, userId: ADMIN, side: "home" },
      { weekId: done.id, gameId: g1.id, userId: PAT, side: "home" },
      { weekId: done.id, gameId: g2.id, userId: PAT, side: "away", isPow: true },
      { weekId: done.id, gameId: g1.id, userId: SAM, side: "away" },
      { weekId: done.id, gameId: g2.id, userId: SAM, side: "away" },
      { weekId: open.id, gameId: g3.id, userId: PAT, side: "home" },
    ]);
    await db.insert(tiebreakerGuesses).values([
      { weekId: done.id, userId: PAT, total: 40 },
      { weekId: open.id, userId: PAT, total: 41 },
    ]);
  }

  beforeAll(async () => {
    for (const [i, id] of USERS.entries())
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}, ${`deletion-${i}@example.test`})`,
      );
  });
  beforeEach(async () => {
    authWorks = true;
    softDeleted.length = 0;
    await db.insert(profiles).values(
      USERS.map((userId, i) => ({
        userId,
        displayName: NAMES[i] ?? "Player",
        avatarId: 41,
        termsAcceptedAt: new Date(),
      })),
    );
    await seedLeague();
  });
  afterEach(async () => {
    if (created.length) await db.delete(leagues).where(inArray(leagues.id, created.splice(0)));
    await db
      .delete(contentReports)
      .where(or(inArray(contentReports.subjectUserId, USERS), inArray(contentReports.reporterId, USERS)));
    await db.delete(userBlocks).where(inArray(userBlocks.blockerId, USERS));
    await db.delete(feedback).where(eq(feedback.message, FEEDBACK));
    await db.delete(emailOutbox).where(inArray(emailOutbox.userId, USERS));
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.userId, USERS));
    await db.delete(profiles).where(inArray(profiles.userId, USERS));
  });
  afterAll(async () => {
    await db.execute(sql`delete from auth.users where id in ${USERS}`);
    await db.$close();
  });

  /** Standings as the other players see them, without names (Pat's becomes "Deleted player"). */
  const standingsOf = async (user: string) => {
    const res = await call<Standings>(user, "GET", `/leagues/${leagueId}/standings`);
    expect(res.status).toBe(200);
    return {
      entries: res.body.entries.map(({ displayName: _, avatarId: _avatar, removed: __, ...entry }) => entry),
      weeks: res.body.weeks.map(({ winners: _, lowPointLosers: __, ...week }) => week),
    };
  };

  it("leaves every other player's standings exactly as they were", async () => {
    const before = await standingsOf(ADMIN);
    expect((await remove(PAT)).body).toEqual({ deleted: true });
    expect(await standingsOf(ADMIN)).toEqual(before);
    const after = await call<Standings>(SAM, "GET", `/leagues/${leagueId}/standings`);
    expect(after.body.entries.find((e) => e.userId === PAT)?.displayName).toBe(DELETED_PLAYER_NAME);
    expect(softDeleted).toEqual([PAT]);
  });

  it("keeps picks from final weeks and deletes those from weeks still open", async () => {
    await remove(PAT);
    const left = await db.select({ weekId: picks.weekId }).from(picks).where(eq(picks.userId, PAT));
    expect(new Set(left.map((p) => p.weekId))).toEqual(new Set([finalWeek]));
    const guesses = await db.select().from(tiebreakerGuesses).where(eq(tiebreakerGuesses.userId, PAT));
    expect(guesses.map((g) => g.weekId)).toEqual([finalWeek]);
    expect(openWeek).not.toBe(finalWeek);
    // They're out of the league from now on.
    const [membership] = await db.select().from(leagueMembers).where(eq(leagueMembers.userId, PAT));
    expect(membership?.removedAt).not.toBeNull();
  });

  it("does the same in the other games: open survivor picks and unlocked squares go, settled ones stay", async () => {
    const [finalGame] = await db.select().from(games).where(eq(games.weekId, finalWeek));
    const [openGame] = await db.select().from(games).where(eq(games.weekId, openWeek));
    assert(finalGame && openGame);
    await db.insert(survivorPicks).values([
      { weekId: finalWeek, gameId: finalGame.id, userId: PAT, side: "home" },
      { weekId: openWeek, gameId: openGame.id, userId: PAT, side: "home" },
    ]);
    const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const [open, drawn] = await db
      .insert(squareBoards)
      .values([
        { leagueId, homeTeam: "KC", awayTeam: "PHI", kickoff: new Date("2030-02-10T23:30:00Z") },
        {
          leagueId,
          homeTeam: "SEA",
          awayTeam: "BUF",
          kickoff: new Date("2026-02-08T23:30:00Z"),
          homeDigits: digits,
          awayDigits: digits,
          drawnAt: new Date("2026-02-08T23:30:00Z"),
        },
      ])
      .returning();
    assert(open && drawn);
    await db.insert(squareClaims).values([
      { boardId: open.id, row: 0, col: 0, userId: PAT },
      { boardId: open.id, row: 1, col: 1, userId: SAM },
      { boardId: drawn.id, row: 0, col: 0, userId: PAT },
    ]);

    await remove(PAT);
    const survivor = await db.select().from(survivorPicks).where(eq(survivorPicks.userId, PAT));
    expect(survivor.map((p) => p.weekId)).toEqual([finalWeek]);
    // The open board's square is free again; the drawn board keeps its square, under "Deleted player".
    const squares = await db.select().from(squareClaims).where(eq(squareClaims.userId, PAT));
    expect(squares.map((sq) => sq.boardId)).toEqual([drawn.id]);
    expect(await db.select().from(squareClaims).where(eq(squareClaims.boardId, open.id))).toHaveLength(1);
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, PAT));
    expect(profile).toMatchObject({
      displayName: DELETED_PLAYER_NAME,
      avatarId: null,
      emailLeagueEvents: false,
    });
  });

  it("locks the account out at once, even with a token that hasn't expired", async () => {
    await remove(PAT);
    expect((await call(PAT, "GET", "/me")).status).toBe(401);
    expect((await call(PAT, "PUT", "/me", { displayName: "Back again" })).status).toBe(401);
    expect((await call(PAT, "POST", "/leagues", { name: "Comeback" })).status).toBe(401);
  });

  it("needs the right password, and changes nothing without it", async () => {
    expect(await remove(PAT, "wrong")).toEqual({
      status: 403,
      body: { error: "That password isn't right." },
    });
    expect((await call(PAT, "GET", "/me")).status).toBe(200);
    expect(softDeleted).toEqual([]);
  });

  it("holds deletion while the player is the only admin of a league with others in it", async () => {
    const preview = await call<AccountDeletionPreview>(ADMIN, "GET", "/me/deletion");
    expect(preview.body).toMatchObject({
      soleAdmin: [{ id: leagueId, name: "Deletion league" }],
      leaving: [{ id: leagueId, name: "Deletion league" }],
      deletedLeagues: [],
      available: true,
    });
    const refused = await remove(ADMIN);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({
      error: "Make someone else a commissioner of Deletion league before you delete your account.",
    });
    expect(softDeleted).toEqual([]);
  });

  it("deletes a league the player was the only member of", async () => {
    const solo = await call<{ id: string }>(SAM, "POST", "/leagues", { name: "Just me" });
    assert(solo.status === 201);
    created.push(solo.body.id);
    const preview = await call<AccountDeletionPreview>(SAM, "GET", "/me/deletion");
    expect(preview.body.deletedLeagues).toEqual([{ id: solo.body.id, name: "Just me" }]);
    expect((await remove(SAM)).status).toBe(200);
    expect(await db.select().from(leagues).where(eq(leagues.id, solo.body.id))).toEqual([]);
  });

  it("clears their messages but keeps their threads, with everyone else's replies", async () => {
    const thread = await call<{ id: string }>(PAT, "POST", `/leagues/${leagueId}/messages`, {
      title: "Pat's thread",
      body: "Pat's opening message",
    });
    assert(thread.status === 201);
    const path = `/leagues/${leagueId}/messages/${thread.body.id}`;
    const opening = (await call<ThreadDetail>(SAM, "GET", path)).body.posts[0];
    assert(opening);
    await call(SAM, "POST", `${path}/replies`, { body: "Sam replies", quotedPostId: opening.id });
    await call(SAM, "PUT", `${path}/posts/${opening.id}/reactions`, { emoji: "👍", active: true });
    await call(PAT, "PUT", `${path}/posts/${opening.id}/reactions`, { emoji: "🔥", active: true });
    await remove(PAT);
    const view = (await call<ThreadDetail>(SAM, "GET", path)).body;
    expect(view.title).toBe(DELETED_THREAD_TITLE);
    expect(view.posts.map((p) => [p.state, p.body, p.authorName])).toEqual([
      ["deleted", DELETED_MESSAGE_TEXT, DELETED_PLAYER_NAME],
      ["visible", "Sam replies", "Sam"],
    ]);
    expect(view.posts[0]?.reactions).toEqual([]);
    expect(view.posts[1]?.quote).toMatchObject({ state: "deleted", body: DELETED_MESSAGE_TEXT });
    // The text is gone from the database, not just hidden.
    const stored = await db.execute<{ body: string }>(
      sql`select body from message_posts where author_id = ${PAT}`,
    );
    expect(stored.map((r) => r.body)).toEqual([""]);
    expect(await db.select().from(messageReactions).where(eq(messageReactions.userId, PAT))).toEqual([]);
    expect(await db.select().from(messageReads).where(eq(messageReads.userId, PAT))).toEqual([]);
  });

  it("removes devices, queued email and blocks, and closes reports about them", async () => {
    await db
      .insert(pushSubscriptions)
      .values({ userId: PAT, endpoint: `https://push.example.test/${PAT}`, p256dh: "k", auth: "a" });
    await db.insert(emailOutbox).values({
      userId: PAT,
      kind: "pick_reminder",
      dedupeKey: `reminder:${openWeek}:2030-09-12:${PAT}`,
      message: { subject: "s", html: "h", text: "t" },
      expiresAt: new Date("2030-09-13T00:00:00Z"),
    });
    await call(SAM, "PUT", `/blocks/${PAT}`);
    await call(PAT, "PUT", `/blocks/${ADMIN}`);
    await db.insert(contentReports).values({
      kind: "display_name",
      targetKey: `name:${PAT}`,
      subjectUserId: PAT,
      leagueId,
      reporterId: SAM,
      source: "player",
      reason: "other",
    });
    await remove(PAT);
    expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, PAT))).toEqual([]);
    expect(await db.select().from(emailOutbox).where(eq(emailOutbox.userId, PAT))).toEqual([]);
    expect(
      await db
        .select()
        .from(userBlocks)
        .where(or(eq(userBlocks.blockerId, PAT), eq(userBlocks.blockedId, PAT))),
    ).toEqual([]);
    const [report] = await db.select().from(contentReports).where(eq(contentReports.subjectUserId, PAT));
    expect(report?.status).toBe("dismissed");
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, PAT));
    expect(profile).toMatchObject({
      displayName: DELETED_PLAYER_NAME,
      emailNewThreads: false,
      emailPickReminders: false,
      termsAcceptedAt: null,
    });
    expect(profile?.deletedAt).not.toBeNull();
  });

  it("keeps feedback they sent, without saying who sent it", async () => {
    expect((await call(PAT, "POST", "/feedback", { kind: "other", message: FEEDBACK })).status).toBe(201);
    await remove(PAT);
    const kept = await db.select().from(feedback).where(eq(feedback.message, FEEDBACK));
    expect(kept.map((f) => f.userId)).toEqual([null]);
  });

  it("still answers when Auth doesn't confirm, and the scheduled job retries", async () => {
    authWorks = false;
    expect((await remove(PAT)).status).toBe(200);
    expect((await call(PAT, "GET", "/me")).status).toBe(401);
    expect(softDeleted).toEqual([]);
    authWorks = true;
    // The fake doesn't mark auth.users, so the job finds Pat (and any other test's leftovers) each time.
    expect(await retryAuthDeletions(db, accounts)).toBeGreaterThanOrEqual(1);
    expect(softDeleted).toContain(PAT);
  });

  it("is unavailable without the Auth admin key", async () => {
    const off = createApp({ db, verifyToken, publicConfig, nfl: { getWeek: async () => [] } });
    const res = await off.request("/api/me", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(503);
    const preview = await off.request("/api/me/deletion", { headers: { Authorization: `Bearer ${PAT}` } });
    expect(((await preview.json()) as AccountDeletionPreview).available).toBe(false);
  });
});
