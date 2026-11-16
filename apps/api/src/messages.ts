import { zValidator } from "@hono/zod-validator";
import {
  emailOutbox,
  messagePosts,
  messageReactions,
  messageReads,
  messageThreads,
  profiles,
} from "@picks/db";
import {
  createThreadSchema,
  MESSAGE_REACTIONS,
  type MessageReaction,
  type MessageThread,
  messageReactionSchema,
  pinThreadSchema,
  readThreadSchema,
  replySchema,
  type ThreadDetail,
} from "@picks/shared";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "./auth";
import { type AppDeps, body, fail, leagueParam, requireAdmin, requireMember } from "./context";
import { logError } from "./logging";
import { drainOutbox, queueThreadEmails } from "./outbox";
import { drainPush, queueThreadPush } from "./pushQueue";

const threadParam = zValidator("param", z.object({ leagueId: z.uuid(), threadId: z.uuid() }));

export function messageRoutes({
  db,
  verifyToken,
  email,
  push,
  now = () => new Date(),
  background = (task) => void task(),
}: AppDeps) {
  const auth = requireAuth(verifyToken);
  async function thread(leagueId: string, threadId: string, userId: string) {
    const { role } = await requireMember(db, leagueId, userId);
    const [row] = await db
      .select()
      .from(messageThreads)
      .where(and(eq(messageThreads.id, threadId), eq(messageThreads.leagueId, leagueId)));
    if (!row) fail(404, "Thread not found.");
    return { ...row, canPin: role === "admin", canDelete: role === "admin" };
  }
  async function reactions(threadId: string, userId: string) {
    const rows = await db
      .select({
        postId: messageReactions.postId,
        emoji: messageReactions.emoji,
        userId: messageReactions.userId,
      })
      .from(messageReactions)
      .innerJoin(messagePosts, eq(messagePosts.id, messageReactions.postId))
      .where(eq(messagePosts.threadId, threadId));
    const result = new Map<string, MessageReaction[]>();
    for (const row of rows) {
      const option = MESSAGE_REACTIONS.find((r) => r.emoji === row.emoji);
      if (!option) continue;
      const list = result.get(row.postId) ?? [];
      let reaction = list.find((r) => r.emoji === option.emoji);
      if (!reaction) {
        reaction = { emoji: option.emoji, count: 0, reacted: false };
        list.push(reaction);
      }
      reaction.count++;
      reaction.reacted ||= row.userId === userId;
      result.set(row.postId, list);
    }
    return result;
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
        .orderBy(desc(messageThreads.pinned), desc(messageThreads.updatedAt), desc(messageThreads.id));
      const result: MessageThread[] = rows.map(({ thread: t, authorName, readVersion }) => ({
        id: t.id,
        title: t.title,
        pinned: t.pinned,
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
      const { league } = await requireMember(db, leagueId, c.var.user.id);
      const { title, body: content } = c.req.valid("json");
      let queued = 0;
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
        if (email) {
          queued = await queueThreadEmails(tx, email, {
            leagueId,
            leagueName: league.name,
            threadId: t.id,
            authorId: c.var.user.id,
            title: t.title,
            body: content,
            now: now(),
          });
        }
        if (push) await queueThreadPush(tx, leagueId, t.id, c.var.user.id, now());
        return t.id;
      });
      // Sent after the thread is committed, so a slow or failing provider never holds up posting.
      if (email && queued) {
        background(() => drainOutbox(db, email, now()).catch((err) => logError("email_jobs", err)));
      }
      if (push) background(() => drainPush(db, push, now()).catch((err) => logError("push_delivery", err)));
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
      const byPost = await reactions(threadId, c.var.user.id);
      const postsById = new Map(rows.map((r) => [r.post.id, r]));
      const result: ThreadDetail = {
        id: t.id,
        title: t.title,
        pinned: t.pinned,
        version: t.version,
        canPin: t.canPin,
        canDelete: t.canDelete,
        posts: rows.map(({ post, authorName }) => ({
          id: post.id,
          reactions: byPost.get(post.id) ?? [],
          body: post.body,
          quote: (() => {
            const original = post.quotedPostId ? postsById.get(post.quotedPostId) : undefined;
            return original
              ? {
                  id: original.post.id,
                  authorName: original.authorName ?? "Player",
                  body: original.post.body,
                }
              : null;
          })(),
          position: post.position,
          authorName: authorName ?? "Player",
          createdAt: post.createdAt.toISOString(),
        })),
      };
      return c.json(result);
    })
    .delete("/leagues/:leagueId/messages/:threadId", auth, threadParam, async (c) => {
      const { leagueId, threadId } = c.req.valid("param");
      const { role } = await requireMember(db, leagueId, c.var.user.id);
      requireAdmin(role);
      await db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(messageThreads)
          .where(and(eq(messageThreads.id, threadId), eq(messageThreads.leagueId, leagueId)))
          .returning({ id: messageThreads.id });
        if (!deleted) fail(404, "Thread not found.");
        // Posts, reactions, read markers and push deliveries cascade. Emails use a dedupe key instead.
        await tx
          .delete(emailOutbox)
          .where(
            and(eq(emailOutbox.kind, "new_thread"), like(emailOutbox.dedupeKey, `thread:${threadId}:%`)),
          );
      });
      return c.json({ ok: true });
    })
    .put("/leagues/:leagueId/messages/:threadId/pin", auth, threadParam, body(pinThreadSchema), async (c) => {
      const { leagueId, threadId } = c.req.valid("param");
      const { role } = await requireMember(db, leagueId, c.var.user.id);
      requireAdmin(role);
      await thread(leagueId, threadId, c.var.user.id);
      const { pinned } = c.req.valid("json");
      await db.update(messageThreads).set({ pinned }).where(eq(messageThreads.id, threadId));
      return c.json({ pinned });
    })
    .put(
      "/leagues/:leagueId/messages/:threadId/posts/:postId/reactions",
      auth,
      zValidator("param", z.object({ leagueId: z.uuid(), threadId: z.uuid(), postId: z.uuid() })),
      body(messageReactionSchema),
      async (c) => {
        const { leagueId, threadId, postId } = c.req.valid("param");
        await thread(leagueId, threadId, c.var.user.id);
        const [post] = await db
          .select({ id: messagePosts.id })
          .from(messagePosts)
          .where(and(eq(messagePosts.id, postId), eq(messagePosts.threadId, threadId)));
        if (!post) fail(404, "Message not found.");
        const { emoji, active } = c.req.valid("json");
        if (active) {
          await db
            .insert(messageReactions)
            .values({ postId, userId: c.var.user.id, emoji })
            .onConflictDoNothing();
        } else {
          await db
            .delete(messageReactions)
            .where(
              and(
                eq(messageReactions.postId, postId),
                eq(messageReactions.userId, c.var.user.id),
                eq(messageReactions.emoji, emoji),
              ),
            );
        }
        return c.json((await reactions(threadId, c.var.user.id)).get(postId) ?? []);
      },
    )
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
          const { body: content, quotedPostId } = c.req.valid("json");
          if (quotedPostId) {
            const [original] = await tx
              .select({ id: messagePosts.id })
              .from(messagePosts)
              .where(and(eq(messagePosts.id, quotedPostId), eq(messagePosts.threadId, threadId)));
            if (!original) fail(404, "Quoted message not found in this thread.");
          }
          await tx.insert(messagePosts).values({
            threadId,
            authorId: c.var.user.id,
            body: content,
            quotedPostId,
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
