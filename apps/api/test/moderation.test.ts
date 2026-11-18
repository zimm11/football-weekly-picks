import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  contentReports,
  createDb,
  emailOutbox,
  games,
  leagueMembers,
  leagues,
  messagePosts,
  moderationActions,
  profiles,
  seasons,
  userBlocks,
  weeks,
} from "@picks/db";
import {
  HIDDEN_TEXT,
  type LeagueDetail,
  type Me,
  MODERATION_MESSAGES,
  REMOVED_TEXT,
  REPLY_MINUTE_LIMIT,
  type ReportQueue,
  type ScreeningScores,
  type ThreadDetail,
  type ThreadPage,
} from "@picks/shared";
import { eq, inArray, or, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { clearRemovedText, queueDigest, recheckUnchecked } from "../src/moderationJobs";
import type { EmailDeps } from "../src/outbox";
import type { Screener } from "../src/screening";

/*
 * The screening model is faked. The repository holds no offensive words, so the fake reacts to harmless
 * placeholders: `forbiddenword` is blocked, and `reportremove` is one the larger
 * model (used on reports) is sure about.
 */
let screeningDown = false;
const screener: Screener = {
  async screen({ text }, options): Promise<ScreeningScores | null> {
    if (screeningDown) return null;
    if (text.includes("forbiddenword")) return { allow: 0.05, block: 0.95 };
    if (options?.deep && text.includes("reportremove")) return { allow: 0.05, block: 0.95 };
    return { allow: 0.98, block: 0.02 };
  },
};

const ADMIN = randomUUID();
const PAT = randomUUID();
const SAM = randomUUID();
const ALEX = randomUUID();
const OPERATOR = randomUUID();
const USERS = [ADMIN, PAT, SAM, ALEX, OPERATOR];
const NAMES = ["Commish", "Pat", "Sam", "Alex", "Operator"];
const verifyToken = async (token: string) => ((USERS as string[]).includes(token) ? { id: token } : null);
const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };

describe.skipIf(!process.env.DATABASE_URL)("content moderation (requires `pnpm db:start`)", () => {
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  const email: EmailDeps = {
    mailer: { send: async () => {} },
    appUrl: "https://example.test",
    unsubscribeSecret: "s".repeat(32),
    limits: { daily: 1000, monthly: 10000 },
  };
  const app = createApp({
    db,
    verifyToken,
    publicConfig,
    nfl: { getWeek: async () => [] },
    screener,
    email,
    operatorUserIds: [OPERATOR],
    // Queued emails stay in the outbox for the tests to look at; nothing is sent.
    background: () => {},
  });
  const call = async <T = unknown>(user: string, method: string, path: string, json?: unknown) => {
    const res = await app.request(`/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  const errorOf = (res: { body: unknown }) => (res.body as { error?: string }).error;

  let leagueId = "";
  const board = (user: string) => call<ThreadPage>(user, "GET", `/leagues/${leagueId}/messages?limit=30`);
  const post = async (user: string, title: string, body = "Opening message") => {
    const res = await call<{ id: string }>(user, "POST", `/leagues/${leagueId}/messages`, { title, body });
    return res;
  };
  const detail = (user: string, threadId: string) =>
    call<ThreadDetail>(user, "GET", `/leagues/${leagueId}/messages/${threadId}`);
  const reply = (user: string, threadId: string, body: string) =>
    call(user, "POST", `/leagues/${leagueId}/messages/${threadId}/replies`, { body });
  const reportPost = (user: string, threadId: string, postId: string, reason = "harassment") =>
    call(user, "POST", "/reports", { kind: "post", leagueId, threadId, postId, reason });
  /** A thread by Pat with one reply by Sam; returns the reply's id. */
  async function threadWithReply(text = "A reply") {
    const thread = await post(PAT, "Week 9");
    assert(thread.status === 201);
    expect((await reply(SAM, thread.body.id, text)).status).toBe(201);
    const posts = (await detail(PAT, thread.body.id)).body.posts;
    const target = posts.at(-1);
    assert(target);
    return { threadId: thread.body.id, postId: target.id };
  }

  beforeAll(async () => {
    for (const [i, id] of USERS.entries()) {
      await db.execute(
        sql`insert into auth.users (id, email) values (${id}, ${`moderation-${i}@example.test`})`,
      );
    }
  });
  beforeEach(async () => {
    screeningDown = false;
    await db.insert(profiles).values(
      USERS.map((userId, i) => ({
        userId,
        displayName: NAMES[i] ?? "Player",
        termsAcceptedAt: new Date(),
      })),
    );
    const [league] = await db
      .insert(leagues)
      .values({ name: "Moderation test", inviteCode: randomUUID() })
      .returning();
    assert(league);
    leagueId = league.id;
    await db.insert(leagueMembers).values([
      { leagueId, userId: ADMIN, role: "admin" },
      { leagueId, userId: PAT },
      { leagueId, userId: SAM },
      { leagueId, userId: ALEX },
    ]);
  });
  afterEach(async () => {
    await db.delete(leagues).where(eq(leagues.id, leagueId));
    await db
      .delete(contentReports)
      .where(or(inArray(contentReports.subjectUserId, USERS), inArray(contentReports.reporterId, USERS)));
    await db.delete(moderationActions).where(inArray(moderationActions.userId, USERS));
    await db.delete(userBlocks).where(inArray(userBlocks.blockerId, USERS));
    await db.delete(emailOutbox).where(inArray(emailOutbox.userId, USERS));
    await db.delete(profiles).where(inArray(profiles.userId, USERS));
  });
  afterAll(async () => {
    await db.execute(sql`delete from auth.users where id in ${USERS}`);
    await db.$close();
  });

  it("asks for the terms before a first post, and the name step can agree to them", async () => {
    await db.update(profiles).set({ termsAcceptedAt: null }).where(eq(profiles.userId, PAT));
    const refused = await post(PAT, "Hello");
    expect(refused).toEqual({ status: 409, body: { error: MODERATION_MESSAGES.terms } });
    expect((await call<Me>(PAT, "GET", "/me")).body.moderation.termsAccepted).toBe(false);
    expect((await call(PAT, "PUT", "/me/terms")).status).toBe(200);
    expect((await post(PAT, "Hello")).status).toBe(201);
    // The first-name step sends `acceptTerms` along with the name.
    await db.update(profiles).set({ termsAcceptedAt: null }).where(eq(profiles.userId, SAM));
    const named = await call<Me>(SAM, "PUT", "/me", { displayName: "Sam", acceptTerms: true });
    expect(named.body.moderation.termsAccepted).toBe(true);
  });

  it("refuses what the model blocks, keeping nothing, and posts everything else", async () => {
    const blocked = await post(PAT, "Week 9", "forbiddenword");
    expect(blocked).toEqual({ status: 400, body: { error: MODERATION_MESSAGES.rejected } });
    expect((await board(SAM)).body.threads).toHaveLength(0);
    expect(await db.select().from(emailOutbox).where(inArray(emailOutbox.userId, USERS))).toEqual([]);

    const allowed = await post(PAT, "Week 9", "We'll crush you all on Sunday.");
    expect(allowed.status).toBe(201);
    expect((await board(SAM)).body.threads.map((t) => t.title)).toEqual(["Week 9"]);
    const [row] = await db
      .select({ screening: messagePosts.screening, scores: messagePosts.screeningScores })
      .from(messagePosts)
      .where(eq(messagePosts.authorId, PAT));
    expect(row).toEqual({ screening: "allow", scores: { allow: 0.98, block: 0.02 } });
    // Nothing goes to the queue at posting time: screening only allows or refuses.
    expect(await db.select().from(contentReports).where(eq(contentReports.subjectUserId, PAT))).toEqual([]);
    const queued = await db.select().from(emailOutbox).where(inArray(emailOutbox.userId, USERS));
    expect(queued.map((r) => r.userId).sort()).toEqual([ADMIN, SAM, ALEX].sort());
  });

  it("screens replies, display names and league names", async () => {
    const { threadId } = await threadWithReply();
    expect(errorOf(await reply(SAM, threadId, "forbiddenword"))).toBe(MODERATION_MESSAGES.rejected);
    expect(errorOf(await call(SAM, "PUT", "/me", { displayName: "forbiddenword" }))).toBe(
      MODERATION_MESSAGES.rejectedName,
    );
    expect(errorOf(await call(ADMIN, "PATCH", `/leagues/${leagueId}`, { name: "forbiddenword" }))).toBe(
      MODERATION_MESSAGES.rejectedName,
    );
    expect(errorOf(await call(ADMIN, "POST", "/leagues", { name: "forbiddenword" }))).toBe(
      MODERATION_MESSAGES.rejectedName,
    );
    expect((await call(SAM, "PUT", "/me", { displayName: "Spread Destroyer" })).status).toBe(200);
  });

  it("saves posts unchecked while the model is down, and the recheck catches up", async () => {
    screeningDown = true;
    const thread = await post(PAT, "Down", "Fine message");
    expect(thread.status).toBe(201);
    const reply1 = await reply(SAM, thread.body.id, "forbiddenword");
    expect(reply1.status).toBe(201);
    const rows = await db
      .select({ screening: messagePosts.screening })
      .from(messagePosts)
      .where(eq(messagePosts.threadId, thread.body.id));
    expect(rows.map((r) => r.screening)).toEqual(["unchecked", "unchecked"]);

    // Still down: the job stops without marking anything.
    expect(await recheckUnchecked(db, screener, new Date())).toBe(0);
    screeningDown = false;
    expect(await recheckUnchecked(db, screener, new Date())).toBe(2);
    expect(await recheckUnchecked(db, screener, new Date())).toBe(0);
    const posts = (await detail(ALEX, thread.body.id)).body.posts;
    // It's already up, so the blocked reply is hidden from others and waits in the queue.
    expect(posts.map((p) => [p.state, p.body])).toEqual([
      ["visible", "Fine message"],
      ["hidden", HIDDEN_TEXT],
    ]);
    const queue = (await call<ReportQueue>(ADMIN, "GET", `/leagues/${leagueId}/reports`)).body.items;
    expect(queue.map((i) => [i.source, i.reason])).toEqual([["recheck", "flagged"]]);
  });

  it("keeps one open report per player per message, and caps reports a day", async () => {
    const { threadId, postId } = await threadWithReply();
    expect((await reportPost(ALEX, threadId, postId)).status).toBe(201);
    expect((await reportPost(ALEX, threadId, postId, "spam")).status).toBe(201);
    const mine = await db.select().from(contentReports).where(eq(contentReports.reporterId, ALEX));
    expect(mine).toHaveLength(1);
    expect(mine[0]?.reason).toBe("spam");
    expect(errorOf(await reportPost(SAM, threadId, postId))).toBe("You can't report your own message.");
    // Reports are never shown to the reported player.
    expect((await call(SAM, "GET", `/leagues/${leagueId}/reports`)).status).toBe(403);

    const thread = await post(PAT, "Many");
    assert(thread.status === 201);
    const inserted = await db
      .insert(messagePosts)
      .values(
        Array.from({ length: 20 }, (_, i) => ({
          threadId: thread.body.id,
          authorId: PAT,
          body: `Reply ${i}`,
          position: i + 2,
        })),
      )
      .returning({ id: messagePosts.id });
    for (const row of inserted.slice(0, 19))
      expect((await reportPost(ALEX, thread.body.id, row.id)).status).toBe(201);
    const last = inserted.at(-1);
    assert(last);
    expect((await reportPost(ALEX, thread.body.id, last.id)).status).toBe(429);
  });

  it("hides a message two players report, and a threat report at once, emailing the operator", async () => {
    const first = await threadWithReply();
    await reportPost(ALEX, first.threadId, first.postId);
    expect((await detail(ALEX, first.threadId)).body.posts.at(-1)?.state).toBe("visible");
    await reportPost(PAT, first.threadId, first.postId);
    const seen = (await detail(ALEX, first.threadId)).body.posts.at(-1);
    expect(seen).toMatchObject({ state: "hidden", body: HIDDEN_TEXT });
    // Its author still sees it, marked as under review; an admin sees the text to review it.
    expect((await detail(SAM, first.threadId)).body.posts.at(-1)).toMatchObject({
      state: "review",
      body: "A reply",
    });
    expect((await detail(ADMIN, first.threadId)).body.posts.at(-1)).toMatchObject({
      state: "hidden",
      body: "A reply",
    });

    const second = await threadWithReply("Another reply");
    await reportPost(ALEX, second.threadId, second.postId, "threat_self_harm");
    expect((await detail(PAT, second.threadId)).body.posts.at(-1)?.state).toBe("hidden");
    const alerts = await db.select().from(emailOutbox).where(eq(emailOutbox.userId, OPERATOR));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "moderation" });
    // The alert never quotes what was reported.
    expect(JSON.stringify(alerts[0]?.message)).not.toContain("Another reply");
  });

  it("removes a reported message the larger model is sure about, without waiting", async () => {
    const { threadId, postId } = await threadWithReply("reportremove");
    await reportPost(ALEX, threadId, postId);
    const shown = (await detail(ALEX, threadId)).body.posts.at(-1);
    expect(shown).toMatchObject({ state: "removed", body: REMOVED_TEXT, reactions: [] });
    const [report] = await db.select().from(contentReports).where(eq(contentReports.postId, postId));
    expect(report?.status).toBe("removed");
  });

  it("sends reports about admins, and league names, to the operator only", async () => {
    const thread = await post(ADMIN, "Admin thread");
    assert(thread.status === 201);
    const opening = (await detail(PAT, thread.body.id)).body.posts[0];
    assert(opening);
    await reportPost(PAT, thread.body.id, opening.id);
    await call(PAT, "POST", "/reports", { kind: "league_name", leagueId, reason: "other" });
    expect((await call<ReportQueue>(ADMIN, "GET", `/leagues/${leagueId}/reports`)).body.items).toEqual([]);
    expect((await call<LeagueDetail>(ADMIN, "GET", `/leagues/${leagueId}`)).body.openReports).toBe(0);
    const operatorQueue = await call<ReportQueue>(OPERATOR, "GET", "/operator/reports");
    const ours = operatorQueue.body.items.filter((i) => i.league?.id === leagueId);
    expect(ours.map((i) => [i.kind, i.aboutAdmin])).toEqual([
      ["post", true],
      ["league_name", false],
    ]);
    // An admin can't resolve them; the operator can.
    const [about] = ours;
    assert(about);
    expect((await call(ADMIN, "POST", `/reports/${about.id}/resolve`, { action: "remove" })).status).toBe(
      404,
    );
    expect((await call(OPERATOR, "POST", `/reports/${about.id}/resolve`, { action: "remove" })).status).toBe(
      200,
    );
    expect((await call(PAT, "GET", "/operator/reports")).status).toBe(404);
  });

  it("counts removals as strikes: the second mutes for a day, everywhere but picking", async () => {
    for (const text of ["First", "Second"]) {
      const { threadId, postId } = await threadWithReply(text);
      expect(
        (
          await call(ADMIN, "PUT", `/leagues/${leagueId}/messages/${threadId}/posts/${postId}/moderation`, {
            action: "remove",
          })
        ).status,
      ).toBe(200);
    }
    const me = await call<Me>(SAM, "GET", "/me");
    expect(me.body.moderation.mutedUntil).not.toBeNull();
    const thread = await post(PAT, "Still open");
    assert(thread.status === 201);
    expect(errorOf(await reply(SAM, thread.body.id, "Muted"))).toMatch(
      /^You're muted for another 2[34] hours\.$/,
    );
    const view = await detail(SAM, thread.body.id);
    expect(view.body.postingBlocked).toMatch(/muted/);
    // The board says so too, so the app can show it in place of the New thread form.
    expect((await board(SAM)).body.postingBlocked).toBe(view.body.postingBlocked);
    expect((await board(PAT)).body.postingBlocked).toBeNull();
  });

  it("tells the board about a league mute and a suspension, and nothing once lifted", async () => {
    expect((await board(SAM)).body.postingBlocked).toBeNull();
    await call(ADMIN, "PUT", `/leagues/${leagueId}/members/${SAM}/mute`, { duration: "24h" });
    expect((await board(SAM)).body.postingBlocked).toMatch(/muted/);
    await call(ADMIN, "PUT", `/leagues/${leagueId}/members/${SAM}/mute`, { duration: null });
    expect((await board(SAM)).body.postingBlocked).toBeNull();
    await db.update(profiles).set({ suspendedAt: new Date() }).where(eq(profiles.userId, SAM));
    expect((await board(SAM)).body.postingBlocked).toBe(MODERATION_MESSAGES.suspended);
  });

  it("says whether the reviewer can open a reported message's thread", async () => {
    const { threadId, postId } = await threadWithReply();
    await reportPost(ALEX, threadId, postId);
    const mine = (i: { post: { id: string } | null }) => i.post?.id === postId;
    // The league's commissioner is in the league.
    const adminQueue = await call<ReportQueue>(ADMIN, "GET", `/leagues/${leagueId}/reports`);
    expect(adminQueue.body.items.find(mine)?.canOpen).toBe(true);
    // The operator isn't, so the thread would answer 404 for them.
    const outside = await call<ReportQueue>(OPERATOR, "GET", "/operator/reports");
    expect(outside.body.items.find(mine)?.canOpen).toBe(false);
    expect((await detail(OPERATOR, threadId)).status).toBe(404);
    await db.insert(leagueMembers).values({ leagueId, userId: OPERATOR });
    const inside = await call<ReportQueue>(OPERATOR, "GET", "/operator/reports");
    expect(inside.body.items.find(mine)?.canOpen).toBe(true);
    expect((await detail(OPERATOR, threadId)).status).toBe(200);
    // A thread whose opening message was removed is gone for everyone, members included.
    const opening = (await detail(PAT, threadId)).body.posts[0];
    assert(opening);
    await db.update(messagePosts).set({ removedAt: new Date() }).where(eq(messagePosts.id, opening.id));
    const gone = await call<ReportQueue>(OPERATOR, "GET", "/operator/reports");
    expect(gone.body.items.find(mine)?.canOpen).toBe(false);
    // A report that isn't about a message has no thread to open.
    await call(PAT, "POST", "/reports", { kind: "league_name", leagueId, reason: "other" });
    const named = (await call<ReportQueue>(OPERATOR, "GET", "/operator/reports")).body.items.find(
      (i) => i.kind === "league_name" && i.league?.id === leagueId,
    );
    assert(named);
    expect(named).not.toHaveProperty("canOpen");
  });

  it("lets a muted or suspended player keep picking", async () => {
    const [season] = await db.insert(seasons).values({ leagueId, year: 2026 }).returning();
    assert(season);
    const [week] = await db
      .insert(weeks)
      .values({ seasonId: season.id, number: 9, status: "open" })
      .returning();
    assert(week);
    const [game] = await db
      .insert(games)
      .values({
        weekId: week.id,
        homeTeam: "PHI",
        awayTeam: "DAL",
        kickoff: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        spread: -3,
        points: 1,
      })
      .returning();
    assert(game);
    expect(
      (await call(OPERATOR, "PUT", `/operator/users/${SAM}/suspension`, { suspended: true, note: "test" }))
        .status,
    ).toBe(200);
    await call(ADMIN, "PUT", `/leagues/${leagueId}/members/${SAM}/mute`, { duration: "7d" });
    const picks = await call(SAM, "PUT", `/weeks/${week.id}/picks`, {
      picks: [{ gameId: game.id, side: "home" }],
      powGameId: game.id,
      tiebreakerTotal: 44,
    });
    expect(picks.status).toBe(200);
    // But no posting, renaming or new leagues.
    const thread = await post(PAT, "Open");
    assert(thread.status === 201);
    expect(errorOf(await reply(SAM, thread.body.id, "Hi"))).toBe(MODERATION_MESSAGES.suspended);
    expect(errorOf(await call(SAM, "PUT", "/me", { displayName: "New name" }))).toBe(
      MODERATION_MESSAGES.suspended,
    );
    expect((await call(SAM, "POST", "/leagues", { name: "Elsewhere" })).status).toBe(403);
    expect((await call(SAM, "PUT", "/me", { displayName: "Sam" })).status).toBe(200);
  });

  it("only mutes members, for a while or until lifted", async () => {
    expect(
      (await call(PAT, "PUT", `/leagues/${leagueId}/members/${SAM}/mute`, { duration: "24h" })).status,
    ).toBe(403);
    const admins = await call(ADMIN, "PUT", `/leagues/${leagueId}/members/${ADMIN}/mute`, {
      duration: "24h",
    });
    expect(admins.status).toBe(400);
    await call(ADMIN, "PUT", `/leagues/${leagueId}/members/${SAM}/mute`, { duration: "24h" });
    const members = (await call<LeagueDetail>(ADMIN, "GET", `/leagues/${leagueId}`)).body.members;
    expect(members.find((m) => m.userId === SAM)?.mutedUntil).not.toBeNull();
    // Members don't see who is muted.
    const asPat = (await call<LeagueDetail>(PAT, "GET", `/leagues/${leagueId}`)).body.members;
    expect(asPat.find((m) => m.userId === SAM)).not.toHaveProperty("mutedUntil");
    await call(ADMIN, "PUT", `/leagues/${leagueId}/members/${SAM}/mute`, { duration: null });
    const thread = await post(PAT, "Open");
    assert(thread.status === 201);
    expect((await reply(SAM, thread.body.id, "Back")).status).toBe(201);
  });

  it("blocking hides a player's threads, replies and reactions from the blocker only", async () => {
    const own = await post(SAM, "Sam's thread");
    assert(own.status === 201);
    const { threadId, postId } = await threadWithReply("Sam here");
    await call(SAM, "PUT", `/leagues/${leagueId}/messages/${threadId}/posts/${postId}/reactions`, {
      emoji: "👍",
      active: true,
    });
    const opening = (await detail(PAT, threadId)).body.posts[0];
    assert(opening);
    await call(SAM, "PUT", `/leagues/${leagueId}/messages/${threadId}/posts/${opening.id}/reactions`, {
      emoji: "🔥",
      active: true,
    });
    expect((await call(ALEX, "PUT", `/blocks/${SAM}`)).status).toBe(200);
    expect((await call(ALEX, "PUT", `/blocks/${ALEX}`)).status).toBe(400);
    const page = (await board(ALEX)).body;
    expect(page.threads.map((t) => t.title)).toEqual(["Week 9"]);
    expect(page.unreadCount).toBe(1);
    const view = (await detail(ALEX, threadId)).body;
    expect(view.posts.map((p) => p.state)).toEqual(["visible", "blocked"]);
    expect(view.posts[0]?.reactions).toEqual([]);
    expect(
      (await call<LeagueDetail>(ALEX, "GET", `/leagues/${leagueId}`)).body.members.find(
        (m) => m.userId === SAM,
      ),
    ).toMatchObject({ blocked: true });
    // Others still see everything.
    expect((await board(PAT)).body.threads).toHaveLength(2);
    expect((await call(ALEX, "GET", "/blocks")).body).toMatchObject([{ userId: SAM, displayName: "Sam" }]);
    await call(ALEX, "DELETE", `/blocks/${SAM}`);
    expect((await board(ALEX)).body.threads).toHaveLength(2);
  });

  it("queues no thread email for a player who blocked its author", async () => {
    await call(ALEX, "PUT", `/blocks/${PAT}`);
    await post(PAT, "News");
    const queued = await db
      .select({ userId: emailOutbox.userId })
      .from(emailOutbox)
      .where(inArray(emailOutbox.userId, USERS));
    expect(queued.map((r) => r.userId).sort()).toEqual([ADMIN, SAM].sort());
  });

  it("removes a thread with its opening message, and lets the author appeal once", async () => {
    const thread = await post(PAT, "Gone soon");
    assert(thread.status === 201);
    const opening = (await detail(PAT, thread.body.id)).body.posts[0];
    assert(opening);
    await call(
      ADMIN,
      "PUT",
      `/leagues/${leagueId}/messages/${thread.body.id}/posts/${opening.id}/moderation`,
      {
        action: "remove",
      },
    );
    expect((await board(SAM)).body.threads).toEqual([]);
    expect((await detail(SAM, thread.body.id)).status).toBe(404);
    expect((await reply(SAM, thread.body.id, "Hello?")).status).toBe(404);

    const appealPath = `/leagues/${leagueId}/messages/${thread.body.id}/posts/${opening.id}/appeal`;
    expect((await call(SAM, "POST", appealPath, {})).status).toBe(404);
    expect((await call(PAT, "POST", appealPath, { note: "It was a joke" })).status).toBe(201);
    expect((await call(PAT, "POST", appealPath, {})).status).toBe(409);
    // Appeals go to the operator, never to league admins.
    expect((await call<ReportQueue>(ADMIN, "GET", `/leagues/${leagueId}/reports`)).body.items).toEqual([]);
    const appeal = (await call<ReportQueue>(OPERATOR, "GET", "/operator/reports")).body.items.find(
      (i) => i.source === "appeal" && i.post?.id === opening.id,
    );
    assert(appeal);
    expect((await call(OPERATOR, "POST", `/reports/${appeal.id}/resolve`, { action: "remove" })).status).toBe(
      400,
    );
    expect(
      (await call(OPERATOR, "POST", `/reports/${appeal.id}/resolve`, { action: "restore" })).status,
    ).toBe(200);
    expect((await board(SAM)).body.threads.map((t) => t.title)).toEqual(["Gone soon"]);
  });

  it("limits how fast one player replies, and refuses an exact repeat", async () => {
    const thread = await post(PAT, "Busy");
    assert(thread.status === 201);
    expect((await reply(SAM, thread.body.id, "Same")).status).toBe(201);
    expect(errorOf(await reply(SAM, thread.body.id, " Same "))).toBe("You just posted that.");
    for (let i = 1; i < REPLY_MINUTE_LIMIT; i++)
      expect((await reply(SAM, thread.body.id, `Reply ${i}`)).status).toBe(201);
    expect((await reply(SAM, thread.body.id, "One too many")).status).toBe(429);
  });

  it("clears a removed message's text after 30 days, and queues the digest once a day", async () => {
    const { threadId, postId } = await threadWithReply("Old news");
    await call(ADMIN, "PUT", `/leagues/${leagueId}/messages/${threadId}/posts/${postId}/moderation`, {
      action: "remove",
    });
    const later = new Date(Date.now() + 31 * 24 * 60 * 60_000);
    expect(await clearRemovedText(db, later)).toBeGreaterThanOrEqual(1);
    const [row] = await db
      .select({ body: messagePosts.body })
      .from(messagePosts)
      .where(eq(messagePosts.id, postId));
    expect(row?.body).toBe("");

    await reportPost(ALEX, threadId, (await detail(ALEX, threadId)).body.posts[0]?.id ?? "");
    const morning = new Date("2030-01-02T09:00:00Z");
    const afternoon = new Date("2030-01-02T15:00:00Z");
    expect(await queueDigest(db, email, [OPERATOR], morning)).toBe(0);
    expect(await queueDigest(db, email, [OPERATOR], afternoon)).toBe(1);
    expect(await queueDigest(db, email, [OPERATOR], afternoon)).toBe(0);
  });
});
