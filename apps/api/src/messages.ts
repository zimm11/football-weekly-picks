import { zValidator } from "@hono/zod-validator";
import { messagePosts, messageReads, messageThreads, profiles } from "@picks/db";
import {
  createThreadSchema,
  type MessageThread,
  readThreadSchema,
  replySchema,
  type ThreadDetail,
} from "@picks/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "./auth";
import { type AppDeps, body, fail, leagueParam, requireMember } from "./context";

const threadParam = zValidator("param", z.object({ leagueId: z.uuid(), threadId: z.uuid() }));

export function messageRoutes({ db, verifyToken }: AppDeps) {
  const auth = requireAuth(verifyToken);
  async function thread(leagueId: string, threadId: string, userId: string) {
    await requireMember(db, leagueId, userId);
    const [row] = await db
      .select()
      .from(messageThreads)
      .where(and(eq(messageThreads.id, threadId), eq(messageThreads.leagueId, leagueId)));
    if (!row) fail(404, "Thread not found.");
    return row;
  }
  return new Hono<{ Variables: AuthVariables }>()
    .get("/leagues/:leagueId/messages", auth, leagueParam, async (c) => {
      const { leagueId } = c.req.valid("param");
      await requireMember(db, leagueId, c.var.user.id);
      const rows = await db
        .select({
          thread: messageThreads,
          authorName: profiles.displayName,
          readVersion: messageReads.version,
        })
        .from(messageThreads)
        .leftJoin(profiles, eq(profiles.userId, messageThreads.authorId))
        .leftJoin(
          messageReads,
          and(eq(messageReads.threadId, messageThreads.id), eq(messageReads.userId, c.var.user.id)),
        )
        .where(eq(messageThreads.leagueId, leagueId))
        .orderBy(desc(messageThreads.updatedAt), desc(messageThreads.id));
      const result: MessageThread[] = rows.map(({ thread: t, authorName, readVersion }) => ({
        id: t.id,
        title: t.title,
        authorName: authorName ?? "Player",
        version: t.version,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        unread: (readVersion ?? 0) < t.version,
      }));
      return c.json(result);
    })
    .post("/leagues/:leagueId/messages", auth, leagueParam, body(createThreadSchema), async (c) => {
      const { leagueId } = c.req.valid("param");
      await requireMember(db, leagueId, c.var.user.id);
      const { title, body: content } = c.req.valid("json");
      const id = await db.transaction(async (tx) => {
        const [t] = await tx
          .insert(messageThreads)
          .values({ leagueId, authorId: c.var.user.id, title })
          .returning();
        if (!t) throw new Error("Thread insert returned no row");
        await tx
          .insert(messagePosts)
          .values({ threadId: t.id, authorId: c.var.user.id, body: content, position: 1 });
        await tx.insert(messageReads).values({ threadId: t.id, userId: c.var.user.id, version: 1 });
        return t.id;
      });
      return c.json({ id }, 201);
    })
    .get("/leagues/:leagueId/messages/:threadId", auth, threadParam, async (c) => {
      const { leagueId, threadId } = c.req.valid("param");
      const t = await thread(leagueId, threadId, c.var.user.id);
      const rows = await db
        .select({ post: messagePosts, authorName: profiles.displayName })
        .from(messagePosts)
        .leftJoin(profiles, eq(profiles.userId, messagePosts.authorId))
        .where(eq(messagePosts.threadId, threadId))
        .orderBy(asc(messagePosts.position));
      const result: ThreadDetail = {
        id: t.id,
        title: t.title,
        version: t.version,
        posts: rows.map(({ post, authorName }) => ({
          id: post.id,
          body: post.body,
          position: post.position,
          authorName: authorName ?? "Player",
          createdAt: post.createdAt.toISOString(),
        })),
      };
      return c.json(result);
    })
    .post(
      "/leagues/:leagueId/messages/:threadId/replies",
      auth,
      threadParam,
      body(replySchema),
      async (c) => {
        const { leagueId, threadId } = c.req.valid("param");
        await thread(leagueId, threadId, c.var.user.id);
        await db.transaction(async (tx) => {
          const [t] = await tx
            .update(messageThreads)
            .set({ version: sql`${messageThreads.version} + 1`, updatedAt: new Date() })
            .where(eq(messageThreads.id, threadId))
            .returning();
          if (!t) fail(404, "Thread not found.");
          await tx.insert(messagePosts).values({
            threadId,
            authorId: c.var.user.id,
            body: c.req.valid("json").body,
            position: t.version,
          });
        });
        return c.json({ ok: true }, 201);
      },
    )
    .post(
      "/leagues/:leagueId/messages/:threadId/read",
      auth,
      threadParam,
      body(readThreadSchema),
      async (c) => {
        const { leagueId, threadId } = c.req.valid("param");
        const t = await thread(leagueId, threadId, c.var.user.id);
        const version = Math.min(t.version, c.req.valid("json").version);
        await db
          .insert(messageReads)
          .values({ threadId, userId: c.var.user.id, version })
          .onConflictDoUpdate({
            target: [messageReads.threadId, messageReads.userId],
            set: { version: sql`greatest(${messageReads.version}, ${version})` },
          });
        return c.json({ ok: true });
      },
    );
}
