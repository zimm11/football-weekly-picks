import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb, leagueMembers, leagues, messageReads, messageThreads } from "@picks/db";
import type { MessageThread, ThreadPage } from "@picks/shared";
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
  for (const query of ["limit=0", "limit=101", "limit=ten", "before=nope"]) {
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
    expect(first.nextCursor).toBe(first.threads.at(-1)?.id);

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

  it("ignores a cursor from another league", async () => {
    await seed();
    const [other] = await db.insert(leagues).values({ name: "Other", inviteCode: randomUUID() }).returning();
    assert(other);
    try {
      const [foreign] = await db
        .insert(messageThreads)
        .values({ leagueId: other.id, authorId: member, title: "elsewhere" })
        .returning();
      const page = await get<ThreadPage>(`?before=${foreign?.id}`);
      expect(page.threads).toEqual([]);
      expect(page.nextCursor).toBeNull();
    } finally {
      await db.delete(leagues).where(eq(leagues.id, other.id));
    }
  });
});
