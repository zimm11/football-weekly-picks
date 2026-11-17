import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb, leagueMembers, leagues, messageReads, messageThreads, profiles } from "@picks/db";
import { type MessageThread, THREAD_DAILY_LIMIT, type ThreadPage } from "@picks/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const publicConfig = { supabaseUrl: "http://localhost", supabasePublishableKey: "test" };
const member = randomUUID();
const users: string[] = [member];
const verifyToken = async (token: string) => (users.includes(token) ? { id: token } : null);
const nfl = { getWeek: async () => [] };

it("rejects a malformed page request before touching the database", async () => {
  const app = createApp({ db: {} as never, verifyToken, publicConfig, nfl });
  const get = (query: string) =>
    app.request(`/api/leagues/${randomUUID()}/messages?${query}`, {
      headers: { Authorization: `Bearer ${member}` },
    });
  // A bare thread id isn't a cursor: a cursor is a position (see `threadCursor`).
  for (const query of ["limit=0", "limit=101", "limit=ten", "before=nope", `before=${randomUUID()}`]) {
    const res = await get(query);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid page." });
  }
});

describe.skipIf(!process.env.DATABASE_URL)("thread list pages (requires `pnpm db:start`)", () => {
  // Vitest still runs a skipped suite's body to collect it, so the URL must parse even when it is never used.
  const db = createDb(process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  const app = createApp({ db, verifyToken, publicConfig, nfl });
  let leagueId = "";
  const get = async <T>(query = "") => {
    const res = await app.request(`/api/leagues/${leagueId}/messages${query}`, {
      headers: { Authorization: `Bearer ${member}` },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  };

  beforeAll(async () => {
    await db.execute(
      sql`insert into auth.users (id, email) values (${member}, ${`${member}@messages.test`})`,
    );
  });
  beforeEach(async () => {
    const [league] = await db
      .insert(leagues)
      .values({ name: "Board test", inviteCode: randomUUID() })
      .returning();
    assert(league);
    leagueId = league.id;
    await db.insert(leagueMembers).values({ leagueId, userId: member, role: "member" });
  });
  afterEach(async () => {
    await db.delete(leagues).where(eq(leagues.id, leagueId));
  });
  afterAll(async () => {
    await db.execute(sql`delete from auth.users where id = ${member}`);
    await db.$close();
  });

  /** Seven threads a minute apart (t0 oldest); t1 is pinned and t5 has been read. */
  async function seed() {
    const start = Date.parse("2026-11-01T12:00:00Z");
    const rows = await db
      .insert(messageThreads)
      .values(
        Array.from({ length: 7 }, (_, i) => ({
          leagueId,
          authorId: member,
          title: `t${i}`,
          pinned: i === 1,
          updatedAt: new Date(start + i * 60_000),
        })),
      )
      .returning();
    const read = rows.find((r) => r.title === "t5");
    assert(read);
    await db.insert(messageReads).values({ threadId: read.id, userId: member, version: read.version });
  }

  it("pages the board newest first, with every pinned announcement on the first page", async () => {
    await seed();
    const first = await get<ThreadPage>("?limit=2");
    expect(first.threads.map((t) => t.title)).toEqual(["t1", "t6", "t5"]);
    expect(first.unreadCount).toBe(6);
    expect(first.nextCursor).toMatch(new RegExp(`^\\d+\\.${first.threads.at(-1)?.id}$`));

    const second = await get<ThreadPage>(`?limit=2&before=${first.nextCursor}`);
    expect(second.threads.map((t) => t.title)).toEqual(["t4", "t3"]);
    const last = await get<ThreadPage>(`?limit=2&before=${second.nextCursor}`);
    expect(last.threads.map((t) => t.title)).toEqual(["t2", "t0"]);
    expect(last.nextCursor).toBeNull();
  });

  it("still answers a request without a page with the whole board as an array", async () => {
    await seed();
    const all = await get<MessageThread[]>();
    expect(all.map((t) => t.title)).toEqual(["t1", "t6", "t5", "t4", "t3", "t2", "t0"]);
    expect(all.find((t) => t.title === "t5")?.unread).toBe(false);
  });

  it("keeps its place when the thread a page ended on is bumped or deleted", async () => {
    await seed();
    const first = await get<ThreadPage>("?limit=2");
    const ended = first.threads.at(-1);
    expect(ended?.title).toBe("t5");
    assert(ended);
    // A reply bumps t5 to the top: the next page still starts after where it was.
    await db.update(messageThreads).set({ updatedAt: new Date() }).where(eq(messageThreads.id, ended.id));
    const afterBump = await get<ThreadPage>(`?limit=2&before=${first.nextCursor}`);
    expect(afterBump.threads.map((t) => t.title)).toEqual(["t4", "t3"]);
    // An admin deletes it: the same cursor still works.
    await db.delete(messageThreads).where(eq(messageThreads.id, ended.id));
    const afterDelete = await get<ThreadPage>(`?limit=2&before=${first.nextCursor}`);
    expect(afterDelete.threads.map((t) => t.title)).toEqual(["t4", "t3"]);
    expect(afterDelete.nextCursor).not.toBeNull();
  });

  it("only ever lists this league's threads, whatever position the cursor names", async () => {
    await seed();
    const [other] = await db.insert(leagues).values({ name: "Other", inviteCode: randomUUID() }).returning();
    assert(other);
    try {
      const [foreign] = await db
        .insert(messageThreads)
        .values({ leagueId: other.id, authorId: member, title: "elsewhere" })
        .returning();
      assert(foreign);
      // A cursor built from another league's newest thread is just a position: far in the future here.
      const page = await get<ThreadPage>(`?before=${foreign.updatedAt.getTime() * 1000}.${foreign.id}`);
      expect(page.threads.map((t) => t.title)).toEqual(["t6", "t5", "t4", "t3", "t2", "t0"]);
      expect(page.threads.some((t) => t.title === "elsewhere")).toBe(false);
    } finally {
      await db.delete(leagues).where(eq(leagues.id, other.id));
    }
  });

  it("limits how many threads one player can start in a league in a day", async () => {
    await db
      .insert(profiles)
      .values({ userId: member, displayName: "Poster", termsAcceptedAt: new Date() })
      .onConflictDoNothing();
    const post = (league = leagueId) =>
      app.request(`/api/leagues/${league}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${member}`, "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Hello", body: "Anyone there?" }),
      });
    for (let i = 0; i < THREAD_DAILY_LIMIT; i++) expect((await post()).status).toBe(201);
    const refused = await post();
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({
      error: "You've started a lot of threads here today. Reply to one, or try again tomorrow.",
    });
    expect(await get<MessageThread[]>()).toHaveLength(THREAD_DAILY_LIMIT);

    // The limit is per league: another league's board is unaffected.
    const [other] = await db.insert(leagues).values({ name: "Other", inviteCode: randomUUID() }).returning();
    assert(other);
    try {
      await db.insert(leagueMembers).values({ leagueId: other.id, userId: member, role: "member" });
      expect((await post(other.id)).status).toBe(201);
    } finally {
      await db.delete(leagues).where(eq(leagues.id, other.id));
    }

    // And it is a rolling day: once the oldest thread is more than 24 hours old, there is room again.
    const [oldest] = await db
      .select({ id: messageThreads.id })
      .from(messageThreads)
      .where(eq(messageThreads.leagueId, leagueId))
      .limit(1);
    assert(oldest);
    await db
      .update(messageThreads)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60_000) })
      .where(eq(messageThreads.id, oldest.id));
    expect((await post()).status).toBe(201);
    await db.delete(profiles).where(eq(profiles.userId, member));
  });
});
