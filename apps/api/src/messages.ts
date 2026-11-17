import {
  contentReports,
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
  MODERATION_MESSAGES,
  messageReactionSchema,
  NEW_ACCOUNT_MS,
  NEW_ACCOUNT_REPLY_LIMIT,
  NEW_ACCOUNT_THREAD_LIMIT,
  pinThreadSchema,
  REPLY_MINUTE_LIMIT,
  readThreadSchema,
  replySchema,
  THREAD_DAILY_LIMIT,
  THREAD_PAGE_SIZE,
  type ThreadDetail,
  type ThreadPage,
  threadCursor,
  threadListQuerySchema,
} from "@picks/shared";
import { and, asc, count, desc, eq, isNull, like, not, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "./auth";
import {
  type AppDeps,
  body,
  fail,
  leagueParam,
  param,
  query,
  requireAdmin,
  requireMember,
  type Tx,
} from "./context";
import { logError } from "./logging";
import {
  blockedBy,
  openingPostGone,
  posterState,
  postingBlocked,
  postView,
  readerBlocked,
  requirePoster,
  screen,
} from "./moderation";
import { drainOutbox, queueThreadEmails } from "./outbox";
import { drainPush, queueThreadPush } from "./pushQueue";

const threadParam = param(z.object({ leagueId: z.uuid(), threadId: z.uuid() }));
const postParam = param(z.object({ leagueId: z.uuid(), threadId: z.uuid(), postId: z.uuid() }));

/** When the account was created (Supabase Auth's clock), for the tighter limits on brand-new accounts. */
async function accountCreatedAt(db: AppDeps["db"] | Tx, userId: string): Promise<Date | null> {
  const rows = await db.execute<{ created_at: string | null }>(
    sql`select created_at from auth.users where id = ${userId}`,
  );
  const value = rows[0]?.created_at;
  return value ? new Date(value) : null;
}

export function messageRoutes({
  db,
  verifyToken,
  email,
  push,
  nativePush,
  limits,
  screener,
  now = () => new Date(),
  background = (task) => void task(),
}: AppDeps) {
  const auth = requireAuth(verifyToken);
  /**
   * The thread, if this player may see it: a thread whose opening message was removed is gone for everyone, and
   * one hidden for review only shows to its author and the league's admins.
   */
  async function thread(leagueId: string, threadId: string, userId: string) {
    const { role } = await requireMember(db, leagueId, userId);
    const [row] = await db
      .select()
      .from(messageThreads)
      .where(
        and(
          eq(messageThreads.id, threadId),
          eq(messageThreads.leagueId, leagueId),
          not(openingPostGone(userId, role === "admin")),
        ),
      );
    if (!row) fail(404, "Thread not found.");
    return { ...row, role, canPin: role === "admin", canDelete: role === "admin" };
  }
  /** Each message's reactions as this player sees them: without those from players they blocked. */
  async function reactions(threadId: string, userId: string, blocked: ReadonlySet<string>) {
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
      if (blocked.has(row.userId)) continue;
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
  /** Threads newest first (pinned before the rest), each marked unread for this player or not. */
  /** `updated_at` to the microsecond, as the text a page cursor carries (a JS Date would drop the last digits). */
  const updatedAtMicros = sql<string>`(extract(epoch from ${messageThreads.updatedAt}) * 1000000)::bigint`;
  /** SQL: threads this player sees on the board: not removed or hidden from them, not by a player they blocked. */
  const visibleTo = (userId: string, isAdmin: boolean) =>
    and(not(openingPostGone(userId, isAdmin)), not(readerBlocked(userId, messageThreads.authorId)));
  async function threadRows(userId: string, where: SQL | undefined, limit?: number) {
    const query = db
      .select({
        thread: messageThreads,
        position: sql<string>`${updatedAtMicros}::text`,
        authorName: profiles.displayName,
        avatarId: profiles.avatarId,
        readVersion: messageReads.version,
      })
      .from(messageThreads)
      .leftJoin(profiles, eq(profiles.userId, messageThreads.authorId))
      .leftJoin(
        messageReads,
        and(eq(messageReads.threadId, messageThreads.id), eq(messageReads.userId, userId)),
      )
      .where(where)
      .orderBy(desc(messageThreads.pinned), desc(messageThreads.updatedAt), desc(messageThreads.id));
    const rows = await (limit === undefined ? query : query.limit(limit));
    return rows.map(
      ({ thread: t, position, authorName, avatarId, readVersion }): MessageThread & { position: string } => ({
        position,
        id: t.id,
        title: t.title,
        pinned: t.pinned,
        authorName: authorName ?? "Player",
        avatarId,
        version: t.version,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        unread: (readVersion ?? 0) < t.version,
      }),
    );
  }
  async function listThreads(
    userId: string,
    where: SQL | undefined,
    limit?: number,
  ): Promise<MessageThread[]> {
    return (await threadRows(userId, where, limit)).map(({ position: _, ...thread }) => thread);
  }
  /** How many of the league's threads have posts this player hasn't read, across every page. */
  async function unreadThreads(userId: string, leagueId: string, isAdmin: boolean) {
    const [row] = await db
      .select({ n: count() })
      .from(messageThreads)
      .leftJoin(
        messageReads,
        and(eq(messageReads.threadId, messageThreads.id), eq(messageReads.userId, userId)),
      )
      .where(
        and(
          eq(messageThreads.leagueId, leagueId),
          visibleTo(userId, isAdmin),
          sql`coalesce(${messageReads.version}, 0) < ${messageThreads.version}`,
        ),
      );
    return row?.n ?? 0;
  }
  return new Hono<{ Variables: AuthVariables }>()
    .get(
      "/leagues/:leagueId/messages",
      auth,
      leagueParam,
      query(threadListQuerySchema, "Invalid page."),
      async (c) => {
        const { leagueId } = c.req.valid("param");
        const { before, limit } = c.req.valid("query");
        const userId = c.var.user.id;
        const { role } = await requireMember(db, leagueId, userId);
        const inLeague = and(eq(messageThreads.leagueId, leagueId), visibleTo(userId, role === "admin"));
        // Without `limit` or `before`, the whole board as an array: what tabs opened before pagination ask for.
        if (limit === undefined && before === undefined) return c.json(await listThreads(userId, inLeague));
        const size = limit ?? THREAD_PAGE_SIZE;
        const [pinned, rest, unreadCount] = await Promise.all([
          // Every pinned announcement leads the first page; later pages carry none.
          before ? [] : listThreads(userId, and(inLeague, eq(messageThreads.pinned, true))),
          threadRows(
            userId,
            and(
              inLeague,
              eq(messageThreads.pinned, false),
              // Everything after the position the last page ended at, in the board's order (newest first, then
              // id). The cursor is a position, not a thread: it still works if that thread was bumped or deleted.
              before
                ? sql`(${updatedAtMicros}, ${messageThreads.id}) < (${before.updatedAtMicros}::bigint, ${before.id}::uuid)`
                : undefined,
            ),
            size + 1,
          ),
          unreadThreads(userId, leagueId, role === "admin"),
        ]);
        const page = rest.slice(0, size);
        const last = page.at(-1);
        return c.json<ThreadPage>({
          threads: [...pinned, ...page.map(({ position: _, ...thread }) => thread)],
          nextCursor: rest.length > size && last ? threadCursor(last.position, last.id) : null,
          unreadCount,
        });
      },
    )
    .post("/leagues/:leagueId/messages", auth, leagueParam, body(createThreadSchema), async (c) => {
      const { leagueId } = c.req.valid("param");
      const userId = c.var.user.id;
      const { league } = await requireMember(db, leagueId, userId);
      await requirePoster(db, userId, leagueId, now());
      const { title, body: content } = c.req.valid("json");
      // Checked before the transaction, so waiting on the model never holds a lock.
      const screened = await screen(
        screener,
        { kind: "thread", text: `${title}\n\n${content}` },
        MODERATION_MESSAGES.rejected,
      );
      const created = await accountCreatedAt(db, userId);
      const newAccount = !!created && now().getTime() - created.getTime() < NEW_ACCOUNT_MS;
      const dailyLimit = Math.min(
        limits?.threadsPerDay ?? THREAD_DAILY_LIMIT,
        newAccount ? NEW_ACCOUNT_THREAD_LIMIT : Number.POSITIVE_INFINITY,
      );
      let queued = 0;
      const id = await db.transaction(async (tx) => {
        // One thread at a time per player and league, so two posts at once can't both slip under the limit.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`thread:${leagueId}:${c.var.user.id}`}, 0))`,
        );
        const [recent] = await tx
          .select({ n: count() })
          .from(messageThreads)
          .where(
            and(
              eq(messageThreads.leagueId, leagueId),
              eq(messageThreads.authorId, c.var.user.id),
              // A thread's `created_at` is the database's clock, so the day is measured on it too.
              sql`${messageThreads.createdAt} > now() - interval '24 hours'`,
            ),
          );
        if ((recent?.n ?? 0) >= dailyLimit) {
          fail(429, "You've started a lot of threads here today. Reply to one, or try again tomorrow.");
        }
        const [t] = await tx
          .insert(messageThreads)
          .values({ leagueId, authorId: c.var.user.id, title })
          .returning();
        if (!t) throw new Error("Thread insert returned no row");
        await tx
          .insert(messagePosts)
          .values({ threadId: t.id, authorId: c.var.user.id, body: content, position: 1, ...screened });
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
        if (push || nativePush) await queueThreadPush(tx, leagueId, t.id, c.var.user.id, now());
        return t.id;
      });
      // Sent after the thread is committed, so a slow or failing provider never holds up posting.
      if (email && queued) {
        background(() => drainOutbox(db, email, now()).catch((err) => logError("email_jobs", err)));
      }
      if (push || nativePush)
        background(() =>
          drainPush(db, push, now(), nativePush).catch((err) => logError("push_delivery", err)),
        );
      return c.json({ id }, 201);
    })
    .get("/leagues/:leagueId/messages/:threadId", auth, threadParam, async (c) => {
      const { leagueId, threadId } = c.req.valid("param");
      const userId = c.var.user.id;
      const t = await thread(leagueId, threadId, userId);
      const [rows, blocked, poster, appealed] = await Promise.all([
        db
          .select({
            post: messagePosts,
            authorName: profiles.displayName,
            avatarId: profiles.avatarId,
            authorDeleted: sql<boolean>`${profiles.deletedAt} is not null`,
          })
          .from(messagePosts)
          .leftJoin(profiles, eq(profiles.userId, messagePosts.authorId))
          .where(eq(messagePosts.threadId, threadId))
          .orderBy(asc(messagePosts.position)),
        blockedBy(db, userId),
        posterState(db, userId, leagueId),
        db
          .select({ postId: contentReports.postId })
          .from(contentReports)
          .innerJoin(messagePosts, eq(messagePosts.id, contentReports.postId))
          .where(
            and(
              eq(messagePosts.threadId, threadId),
              eq(contentReports.source, "appeal"),
              eq(contentReports.reporterId, userId),
            ),
          ),
      ]);
      const byPost = await reactions(threadId, userId, blocked);
      const reader = { userId, isAdmin: t.role === "admin", blocked };
      const postsById = new Map(rows.map((r) => [r.post.id, r]));
      const appealedIds = new Set(appealed.map((a) => a.postId));
      const result: ThreadDetail = {
        id: t.id,
        title: t.title,
        pinned: t.pinned,
        version: t.version,
        canPin: t.canPin,
        canDelete: t.canDelete,
        canModerate: t.role === "admin",
        postingBlocked: postingBlocked(poster, now()),
        needsTerms: !poster?.termsAcceptedAt,
        posts: rows.map(({ post, authorName, avatarId, authorDeleted }) => {
          const view = postView(post, reader, authorDeleted);
          const original = post.quotedPostId ? postsById.get(post.quotedPostId) : undefined;
          const quoted = original && postView(original.post, reader, original.authorDeleted);
          return {
            id: post.id,
            // A removed or deleted message keeps no reactions on show.
            reactions:
              view.state === "removed" || view.state === "deleted" ? [] : (byPost.get(post.id) ?? []),
            body: view.body,
            state: view.state,
            authorId: post.authorId,
            mine: post.authorId === userId,
            canAppeal: post.authorId === userId && !!post.removedAt && !appealedIds.has(post.id),
            quote:
              original && quoted
                ? {
                    id: original.post.id,
                    authorName: original.authorName ?? "Player",
                    body: quoted.body,
                    state: quoted.state,
                  }
                : null,
            position: post.position,
            authorName: authorName ?? "Player",
            avatarId,
            createdAt: post.createdAt.toISOString(),
          };
        }),
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
      requireAdmin((await thread(leagueId, threadId, c.var.user.id)).role);
      const { pinned } = c.req.valid("json");
      await db.update(messageThreads).set({ pinned }).where(eq(messageThreads.id, threadId));
      return c.json({ pinned });
    })
    .put(
      "/leagues/:leagueId/messages/:threadId/posts/:postId/reactions",
      auth,
      postParam,
      body(messageReactionSchema),
      async (c) => {
        const { leagueId, threadId, postId } = c.req.valid("param");
        await thread(leagueId, threadId, c.var.user.id);
        const [post] = await db
          .select({ id: messagePosts.id })
          .from(messagePosts)
          .where(
            and(
              eq(messagePosts.id, postId),
              eq(messagePosts.threadId, threadId),
              isNull(messagePosts.removedAt),
              isNull(messagePosts.hiddenAt),
            ),
          );
        if (!post) fail(404, "Message not found.");
        await requirePoster(db, c.var.user.id, leagueId, now());
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
        return c.json(
          (await reactions(threadId, c.var.user.id, await blockedBy(db, c.var.user.id))).get(postId) ?? [],
        );
      },
    )
    .post(
      "/leagues/:leagueId/messages/:threadId/replies",
      auth,
      threadParam,
      body(replySchema),
      async (c) => {
        const { leagueId, threadId } = c.req.valid("param");
        const userId = c.var.user.id;
        const current = await thread(leagueId, threadId, userId);
        await requirePoster(db, userId, leagueId, now());
        const { body: content, quotedPostId } = c.req.valid("json");
        const screened = await screen(
          screener,
          { kind: "reply", text: content, context: [current.title] },
          MODERATION_MESSAGES.rejected,
        );
        const created = await accountCreatedAt(db, userId);
        const newAccount = !!created && now().getTime() - created.getTime() < NEW_ACCOUNT_MS;
        await db.transaction(async (tx) => {
          // One reply at a time per player, so the limits below can't be raced.
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reply:${userId}`}, 0))`);
          const [pace] = await tx
            .select({
              lastMinute: sql<number>`(count(*) filter (where ${messagePosts.createdAt} > now() - interval '1 minute'))::int`,
              lastDay: count(),
            })
            .from(messagePosts)
            .where(
              and(
                eq(messagePosts.authorId, userId),
                sql`${messagePosts.position} > 1`,
                // Measured on the database's clock, like the thread limit.
                sql`${messagePosts.createdAt} > now() - interval '24 hours'`,
              ),
            );
          if ((pace?.lastMinute ?? 0) >= REPLY_MINUTE_LIMIT)
            fail(429, "You're replying fast. Wait a minute and try again.");
          if (newAccount && (pace?.lastDay ?? 0) >= NEW_ACCOUNT_REPLY_LIMIT)
            fail(429, "New accounts can post 20 replies a day. Try again tomorrow.");
          const [t] = await tx
            .update(messageThreads)
            .set({ version: sql`${messageThreads.version} + 1`, updatedAt: now() })
            .where(eq(messageThreads.id, threadId))
            .returning();
          if (!t) fail(404, "Thread not found.");
          if (quotedPostId) {
            const [original] = await tx
              .select({ id: messagePosts.id })
              .from(messagePosts)
              .where(
                and(
                  eq(messagePosts.id, quotedPostId),
                  eq(messagePosts.threadId, threadId),
                  isNull(messagePosts.removedAt),
                  isNull(messagePosts.hiddenAt),
                ),
              );
            if (!original) fail(404, "Quoted message not found in this thread.");
          }
          const [last] = await tx
            .select({ body: messagePosts.body })
            .from(messagePosts)
            .where(and(eq(messagePosts.threadId, threadId), eq(messagePosts.authorId, userId)))
            .orderBy(desc(messagePosts.position))
            .limit(1);
          if (last && last.body.trim() === content.trim()) fail(409, "You just posted that.");
          await tx.insert(messagePosts).values({
            threadId,
            authorId: userId,
            body: content,
            quotedPostId,
            position: t.version,
            ...screened,
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
