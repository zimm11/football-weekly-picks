import {
  contentReports,
  type Db,
  emailOutbox,
  feedback,
  leagueMembers,
  leagues,
  messagePosts,
  messageReactions,
  messageReads,
  messageThreads,
  picks,
  profiles,
  pushDeliveries,
  pushSubscriptions,
  squareBoards,
  squareClaims,
  survivorPicks,
  tiebreakerGuesses,
  userBlocks,
  weekRecapViews,
  weeks,
} from "@picks/db";
import {
  type AccountDeletionPreview,
  DELETED_PLAYER_NAME,
  DELETED_THREAD_TITLE,
  deleteAccountSchema,
} from "@picks/shared";
import { and, eq, gt, inArray, isNull, like, ne, notInArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthVariables, requireAuth, type VerifyToken } from "./auth";
import { type AppDeps, body, fail, type Tx } from "./context";
import { logError } from "./logging";

/*
 * Deleting an account (App Store guideline 5.1.1(v)). Every table points at `auth.users` and cascades from it, so
 * a hard delete would erase the player's past picks and rewrite everyone else's standings. Instead the API
 * deletes or anonymizes the personal data itself, in one transaction, and then soft-deletes the Auth user:
 * Supabase keeps the row as an anonymous anchor (scrambled email, no sign-in), and the same email can sign up
 * again as a new account. Picks from final weeks stay, under "Deleted player".
 */

/** The two Supabase Auth calls deletion needs. Injected, so tests use a fake. */
export type AccountAdmin = {
  /** Whether this password signs this email in. */
  checkPassword(email: string, password: string): Promise<boolean>;
  /** Soft-deletes the Auth user. False when Auth didn't confirm it (the scheduled job retries). */
  softDelete(userId: string): Promise<boolean>;
};

/** Supabase Auth over fetch: the password grant with the publishable key, the admin API with the secret key. */
export function supabaseAccountAdmin(url: string, publishableKey: string, secretKey: string): AccountAdmin {
  return {
    async checkPassword(email, password) {
      const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      // The response holds a fresh session; it isn't needed, and the account is about to be deleted.
      await response.body?.cancel();
      if (response.status >= 500)
        throw Object.assign(new Error("Auth unavailable"), { code: "AUTH_UNAVAILABLE" });
      return response.ok;
    },
    async softDelete(userId) {
      try {
        const response = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
          method: "DELETE",
          headers: {
            apikey: secretKey,
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ should_soft_delete: true }),
        });
        await response.body?.cancel();
        // Already gone counts as done.
        return response.ok || response.status === 404;
      } catch (error) {
        logError("account_delete", error);
        return false;
      }
    },
  };
}

/**
 * Wraps the token check so a deleted account is refused everywhere at once, even while its access token is still
 * valid (they're checked against signing keys, not the Auth server, so they last until they expire). The
 * entrypoints (src/index.ts, src/worker.ts) wrap their verifier with it.
 */
export function refuseDeletedAccounts(db: Db, verify: VerifyToken): VerifyToken {
  return async (token) => {
    const user = await verify(token);
    if (!user) return null;
    const [row] = await db
      .select({ deletedAt: profiles.deletedAt })
      .from(profiles)
      .where(eq(profiles.userId, user.id));
    return row?.deletedAt ? null : user;
  };
}

type Store = Db | Tx;

/** The player's current leagues, sorted into what deletion does to each. */
async function leagueOutcomes(db: Store, userId: string) {
  const rows = await db
    .select({
      id: leagues.id,
      name: leagues.name,
      role: leagueMembers.role,
      otherMembers: sql<number>`(select count(*)::int from ${leagueMembers} o
        where o.league_id = ${leagues.id} and o.user_id <> ${userId} and o.removed_at is null)`,
      otherAdmins: sql<number>`(select count(*)::int from ${leagueMembers} o
        where o.league_id = ${leagues.id} and o.user_id <> ${userId} and o.removed_at is null and o.role = 'admin')`,
    })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .where(and(eq(leagueMembers.userId, userId), isNull(leagueMembers.removedAt)))
    .orderBy(leagues.name);
  const league = ({ id, name }: { id: string; name: string }) => ({ id, name });
  return {
    leaving: rows.filter((r) => r.otherMembers > 0).map(league),
    // The same rule as leaving: a league with other members always keeps an admin.
    soleAdmin: rows
      .filter((r) => r.role === "admin" && r.otherMembers > 0 && r.otherAdmins === 0)
      .map(league),
    deletedLeagues: rows.filter((r) => r.otherMembers === 0).map(league),
  };
}

/** Deletes and anonymizes everything personal, in one transaction. The Auth soft delete comes after. */
async function deleteAccountData(tx: Tx, userId: string, deletedLeagues: string[], now: Date) {
  // Serializes with this player's league creates and joins, and device registrations.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`leagues-of:${userId}`}, 0))`);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('push-device'), hashtext(${userId}))`);

  // Picks and guesses in weeks that aren't final: not scored yet, so nobody's results change. Final weeks keep them.
  const unfinished = tx.select({ id: weeks.id }).from(weeks).where(ne(weeks.status, "final"));
  await tx.delete(picks).where(and(eq(picks.userId, userId), inArray(picks.weekId, unfinished)));
  await tx
    .delete(tiebreakerGuesses)
    .where(and(eq(tiebreakerGuesses.userId, userId), inArray(tiebreakerGuesses.weekId, unfinished)));
  await tx.delete(weekRecapViews).where(eq(weekRecapViews.userId, userId));
  // The same for the other games: a survivor pick in a week that isn't final, and squares on boards that haven't
  // locked (as leaving a squares league gives them back). A drawn board keeps its squares, under "Deleted player".
  await tx
    .delete(survivorPicks)
    .where(and(eq(survivorPicks.userId, userId), inArray(survivorPicks.weekId, unfinished)));
  const openBoards = tx
    .select({ id: squareBoards.id })
    .from(squareBoards)
    .where(and(isNull(squareBoards.drawnAt), gt(squareBoards.kickoff, now)));
  await tx
    .delete(squareClaims)
    .where(and(eq(squareClaims.userId, userId), inArray(squareClaims.boardId, openBoards)));

  // Their messages: text cleared (a placeholder shows instead), titles of their threads replaced. Others' replies
  // and the thread positions stay put. Nothing more is sent about their threads.
  const theirThreads = tx
    .select({ id: messageThreads.id })
    .from(messageThreads)
    .where(eq(messageThreads.authorId, userId));
  const threadIds = (await theirThreads).map((t) => t.id);
  await tx.update(messagePosts).set({ body: "" }).where(eq(messagePosts.authorId, userId));
  await tx
    .update(messageThreads)
    .set({ title: DELETED_THREAD_TITLE })
    .where(eq(messageThreads.authorId, userId));
  if (threadIds.length) {
    await tx.delete(pushDeliveries).where(inArray(pushDeliveries.threadId, threadIds));
    await tx
      .delete(emailOutbox)
      .where(
        and(
          eq(emailOutbox.kind, "new_thread"),
          or(...threadIds.map((id) => like(emailOutbox.dedupeKey, `thread:${id}:%`))),
        ),
      );
  }
  await tx.delete(messageReactions).where(eq(messageReactions.userId, userId));
  await tx.delete(messageReads).where(eq(messageReads.userId, userId));
  await tx.delete(userBlocks).where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));

  // Devices (their deliveries cascade) and anything waiting to be emailed to them.
  await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  await tx.delete(emailOutbox).where(eq(emailOutbox.userId, userId));

  // Feedback they sent is kept, but no longer says who sent it (the Auth row stays, so no foreign key clears it).
  await tx.update(feedback).set({ userId: null }).where(eq(feedback.userId, userId));

  // Nothing left to act on in reports about them; reports they filed stay, under "Deleted player".
  await tx
    .update(contentReports)
    .set({ status: "dismissed", resolvedAt: now })
    .where(and(eq(contentReports.subjectUserId, userId), eq(contentReports.status, "open")));

  // They leave every league, as Leave league does, so past weeks keep their results. A league they were the only
  // member of goes with them.
  await tx
    .update(leagueMembers)
    .set({ removedAt: now, mutedUntil: null })
    .where(
      and(
        eq(leagueMembers.userId, userId),
        isNull(leagueMembers.removedAt),
        deletedLeagues.length ? notInArray(leagueMembers.leagueId, deletedLeagues) : undefined,
      ),
    );
  if (deletedLeagues.length) await tx.delete(leagues).where(inArray(leagues.id, deletedLeagues));

  const anonymous = {
    displayName: DELETED_PLAYER_NAME,
    emailNewThreads: false,
    emailPickReminders: false,
    emailLeagueEvents: false,
    termsAcceptedAt: null,
    mutedUntil: null,
    suspendedAt: null,
    deletedAt: now,
  };
  await tx
    .insert(profiles)
    .values({ userId, ...anonymous })
    .onConflictDoUpdate({ target: profiles.userId, set: anonymous });
}

/**
 * Soft-deletes Auth users whose data is already gone but whose Auth call failed. Runs with the scheduled jobs;
 * idempotent. Supabase sets `auth.users.deleted_at` on a soft delete.
 */
export async function retryAuthDeletions(db: Db, admin: AccountAdmin) {
  const pending = await db.execute<{ id: string }>(sql`
    select p.user_id as id from ${profiles} p join auth.users u on u.id = p.user_id
    where p.deleted_at is not null and u.deleted_at is null
    limit 20`);
  let deleted = 0;
  for (const { id } of pending) if (await admin.softDelete(id)) deleted++;
  return deleted;
}

export function accountRoutes({ db, verifyToken, accounts, now = () => new Date() }: AppDeps) {
  const auth = requireAuth(verifyToken);
  return new Hono<{ Variables: AuthVariables }>()
    .get("/me/deletion", auth, async (c) => {
      const preview: AccountDeletionPreview = {
        ...(await leagueOutcomes(db, c.var.user.id)),
        available: !!accounts,
      };
      return c.json(preview);
    })
    .delete("/me", auth, body(deleteAccountSchema), async (c) => {
      if (!accounts) fail(503, "Account deletion isn't available yet. Email support to delete your account.");
      const userId = c.var.user.id;
      const rows = await db.execute<{ email: string | null }>(
        sql`select email from auth.users where id = ${userId}`,
      );
      const email = rows[0]?.email;
      if (!email) fail(404, "Account not found.");
      // The password, not just the session: something this final shouldn't follow from a borrowed phone.
      let correct = false;
      try {
        correct = await accounts.checkPassword(email, c.req.valid("json").password);
      } catch (error) {
        logError("account_delete", error, c.get("requestId"));
        fail(503, "Couldn't check your password right now. Try again in a minute.");
      }
      if (!correct) fail(403, "That password isn't right.");
      const outcomes = await leagueOutcomes(db, userId);
      if (outcomes.soleAdmin.length)
        fail(
          409,
          `Make someone else an admin of ${outcomes.soleAdmin.map((l) => l.name).join(", ")} before you delete your account.`,
        );
      const clock = now();
      await db.transaction(async (tx) => {
        // Checked again under the locks: a league could have changed since.
        const current = await leagueOutcomes(tx, userId);
        if (current.soleAdmin.length) fail(409, "Make someone else an admin first, then try again.");
        await deleteAccountData(
          tx,
          userId,
          current.deletedLeagues.map((l) => l.id),
          clock,
        );
      });
      // The account is already locked out (`refuseDeletedAccounts`); if Auth doesn't confirm, the cron retries.
      if (!(await accounts.softDelete(userId)))
        logError("account_delete", new Error("Auth soft delete failed"));
      return c.json({ deleted: true });
    });
}
