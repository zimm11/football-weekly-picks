import { feedback, leagueMembers, leagues, messagePosts, picks, profiles, seasons, weeks } from "@picks/db";
import {
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_PAGE_SIZE,
  type FeedbackItem,
  type FeedbackPage,
  feedbackQuerySchema,
  type GrowthCount,
  type OperatorOverview,
  type OperatorWeek,
  sendFeedbackSchema,
  updateFeedbackSchema,
} from "@picks/shared";
import { and, count, countDistinct, desc, eq, gte, inArray, isNull, max, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "./auth";
import { type AppDeps, body, fail, isOperator, param, query } from "./context";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many weeks the week-by-week table goes back, the current one included. */
const WEEKS_SHOWN = 8;
const RECENT_ROWS = 25;

const feedbackParam = param(z.object({ feedbackId: z.uuid() }));

/** Monday 00:00 UTC of the week `date` falls in, matching Postgres `date_trunc('week', ...)`. */
function weekStart(date: Date): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day;
}

/** Feedback from any signed-in player, and the operator-only screens that read it alongside app-wide counts. */
export function operatorRoutes(deps: AppDeps) {
  const { db, verifyToken, now = () => new Date() } = deps;
  const auth = requireAuth(verifyToken);
  // A 404, like any unknown path, so the screen's existence isn't advertised to other accounts.
  const operator = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    if (!isOperator(deps, c.var.user.id)) fail(404, "Not found");
    await next();
  });

  // Timestamps go in as ISO text with a cast: the driver does not accept a bare Date in a raw fragment.
  const since = (column: AnyPgColumn, from: Date) => sql`${column} >= ${from.toISOString()}::timestamptz`;
  const growth = (column: AnyPgColumn, clock: Date) => ({
    total: count(),
    last7Days: sql<number>`(count(*) filter (where ${since(column, new Date(clock.getTime() - 7 * DAY_MS))}))::int`,
    last30Days: sql<number>`(count(*) filter (where ${since(column, new Date(clock.getTime() - 30 * DAY_MS))}))::int`,
  });
  const one = (rows: GrowthCount[]): GrowthCount => rows[0] ?? { total: 0, last7Days: 0, last30Days: 0 };

  async function activePlayers(from: Date): Promise<number> {
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from (
        select ${picks.userId} from ${picks} where ${since(picks.updatedAt, from)}
        union
        select ${messagePosts.authorId} from ${messagePosts} where ${since(messagePosts.createdAt, from)}
      ) as active`);
    return rows[0]?.n ?? 0;
  }

  /** Rows per UTC week since `from`, keyed by the week's Monday as `YYYY-MM-DD`. */
  const weekOf = (column: AnyPgColumn) =>
    sql<string>`to_char(date_trunc('week', ${column} at time zone 'UTC'), 'YYYY-MM-DD')`;

  async function overview(): Promise<OperatorOverview> {
    const clock = now();
    const d7 = new Date(clock.getTime() - 7 * DAY_MS);
    const d30 = new Date(clock.getTime() - 30 * DAY_MS);
    const firstWeek = new Date(weekStart(clock).getTime() - (WEEKS_SHOWN - 1) * 7 * DAY_MS);

    const [accounts, leagueCounts, pickCounts, messageCounts] = await Promise.all([
      db.select(growth(authUsers.createdAt, clock)).from(authUsers),
      db.select(growth(leagues.createdAt, clock)).from(leagues),
      db.select(growth(picks.createdAt, clock)).from(picks),
      db.select(growth(messagePosts.createdAt, clock)).from(messagePosts),
    ]);
    const [active7, active30, activeLeagueRows, openRows] = await Promise.all([
      activePlayers(d7),
      activePlayers(d30),
      db
        .select({ n: countDistinct(seasons.leagueId) })
        .from(picks)
        .innerJoin(weeks, eq(weeks.id, picks.weekId))
        .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
        .where(gte(picks.updatedAt, d7)),
      db.select({ n: count() }).from(feedback).where(eq(feedback.status, "open")),
    ]);

    const signupWeek = weekOf(authUsers.createdAt);
    const leagueWeek = weekOf(leagues.createdAt);
    const pickWeek = weekOf(picks.createdAt);
    const [signupWeeks, leagueWeeks, pickWeeks] = await Promise.all([
      db
        .select({ week: signupWeek, n: count() })
        .from(authUsers)
        .where(gte(authUsers.createdAt, firstWeek))
        .groupBy(signupWeek),
      db
        .select({ week: leagueWeek, n: count() })
        .from(leagues)
        .where(gte(leagues.createdAt, firstWeek))
        .groupBy(leagueWeek),
      db
        .select({ week: pickWeek, n: count(), players: countDistinct(picks.userId) })
        .from(picks)
        .where(gte(picks.createdAt, firstWeek))
        .groupBy(pickWeek),
    ]);
    const byWeek = <T extends { week: string }>(rows: T[]) => new Map(rows.map((row) => [row.week, row]));
    const signupsBy = byWeek(signupWeeks);
    const leaguesBy = byWeek(leagueWeeks);
    const picksBy = byWeek(pickWeeks);
    const weekRows: OperatorWeek[] = [];
    for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
      const key = new Date(firstWeek.getTime() + i * 7 * DAY_MS).toISOString().slice(0, 10);
      weekRows.push({
        weekStart: key,
        signups: signupsBy.get(key)?.n ?? 0,
        leaguesCreated: leaguesBy.get(key)?.n ?? 0,
        picks: picksBy.get(key)?.n ?? 0,
        players: picksBy.get(key)?.players ?? 0,
      });
    }

    const recentLeagues = await db
      .select({
        id: leagues.id,
        name: leagues.name,
        createdAt: leagues.createdAt,
        members: count(leagueMembers.userId),
      })
      .from(leagues)
      .leftJoin(leagueMembers, and(eq(leagueMembers.leagueId, leagues.id), isNull(leagueMembers.removedAt)))
      .groupBy(leagues.id)
      .orderBy(desc(leagues.createdAt))
      .limit(RECENT_ROWS);
    const lastPicks = recentLeagues.length
      ? await db
          .select({ leagueId: seasons.leagueId, at: max(picks.updatedAt) })
          .from(picks)
          .innerJoin(weeks, eq(weeks.id, picks.weekId))
          .innerJoin(seasons, eq(seasons.id, weeks.seasonId))
          .where(
            inArray(
              seasons.leagueId,
              recentLeagues.map((l) => l.id),
            ),
          )
          .groupBy(seasons.leagueId)
      : [];
    const lastPickBy = new Map(lastPicks.map((row) => [row.leagueId, row.at]));

    const recentSignups = await db
      .select({
        email: authUsers.email,
        displayName: profiles.displayName,
        createdAt: authUsers.createdAt,
        lastSignInAt: authUsers.lastSignInAt,
        leagues: count(leagueMembers.leagueId),
      })
      .from(authUsers)
      .leftJoin(profiles, eq(profiles.userId, authUsers.id))
      .leftJoin(leagueMembers, and(eq(leagueMembers.userId, authUsers.id), isNull(leagueMembers.removedAt)))
      .groupBy(authUsers.id, profiles.displayName)
      .orderBy(sql`${authUsers.createdAt} desc nulls last`)
      .limit(RECENT_ROWS);

    return {
      generatedAt: clock.toISOString(),
      accounts: one(accounts),
      leagues: one(leagueCounts),
      picks: one(pickCounts),
      messages: one(messageCounts),
      activePlayers: { last7Days: active7, last30Days: active30 },
      activeLeagues: activeLeagueRows[0]?.n ?? 0,
      openFeedback: openRows[0]?.n ?? 0,
      weeks: weekRows,
      recentLeagues: recentLeagues.map((l) => ({
        id: l.id,
        name: l.name,
        createdAt: l.createdAt.toISOString(),
        members: l.members,
        lastPickAt: lastPickBy.get(l.id)?.toISOString() ?? null,
      })),
      recentSignups: recentSignups.map((u) => ({
        email: u.email ?? null,
        displayName: u.displayName ?? null,
        // auth.users always sets created_at; the column is only nullable in its type.
        createdAt: (u.createdAt ?? clock).toISOString(),
        lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
        leagues: u.leagues,
      })),
    };
  }

  async function listFeedback(before?: string): Promise<FeedbackPage> {
    const rows = await db
      .select({ item: feedback, displayName: profiles.displayName, email: authUsers.email })
      .from(feedback)
      .leftJoin(profiles, eq(profiles.userId, feedback.userId))
      .leftJoin(authUsers, eq(authUsers.id, feedback.userId))
      // Stable cursor even when reports are marked done or new ones arrive.
      .where(
        before
          ? sql`(${feedback.createdAt}, ${feedback.id}) <
        (select created_at, id from feedback where id = ${before})`
          : undefined,
      )
      .orderBy(desc(feedback.createdAt), desc(feedback.id))
      .limit(FEEDBACK_PAGE_SIZE + 1);
    const items: FeedbackItem[] = rows.slice(0, FEEDBACK_PAGE_SIZE).map(({ item, displayName, email }) => ({
      id: item.id,
      kind: item.kind,
      message: item.message,
      status: item.status,
      page: item.page,
      userAgent: item.userAgent,
      createdAt: item.createdAt.toISOString(),
      author: item.userId ? { displayName: displayName ?? null, email: email ?? null } : null,
    }));
    return { items, nextCursor: rows.length > FEEDBACK_PAGE_SIZE ? (items.at(-1)?.id ?? null) : null };
  }

  return new Hono<{ Variables: AuthVariables }>()
    .post("/feedback", auth, body(sendFeedbackSchema), async (c) => {
      const { kind, message, page } = c.req.valid("json");
      const clock = now();
      await db.transaction(async (tx) => {
        // Serialize the count and insert per sender, including across API instances.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`feedback:${c.var.user.id}`}, 0))`,
        );
        const [recent] = await tx
          .select({ n: count() })
          .from(feedback)
          .where(
            and(
              eq(feedback.userId, c.var.user.id),
              gte(feedback.createdAt, new Date(clock.getTime() - DAY_MS)),
            ),
          );
        if ((recent?.n ?? 0) >= FEEDBACK_DAILY_LIMIT) {
          fail(429, "You've sent a lot of feedback today. Try again tomorrow.");
        }
        await tx.insert(feedback).values({
          userId: c.var.user.id,
          kind,
          message,
          page: page ?? null,
          userAgent: c.req.header("User-Agent")?.slice(0, 300) ?? null,
          createdAt: clock,
        });
      });
      return c.json({ ok: true }, 201);
    })
    .get("/operator/overview", auth, operator, async (c) => c.json(await overview()))
    .get("/operator/feedback", auth, operator, query(feedbackQuerySchema), async (c) =>
      c.json(await listFeedback(c.req.valid("query").before)),
    )
    .put(
      "/operator/feedback/:feedbackId",
      auth,
      operator,
      feedbackParam,
      body(updateFeedbackSchema),
      async (c) => {
        const [row] = await db
          .update(feedback)
          .set({ status: c.req.valid("json").status })
          .where(eq(feedback.id, c.req.valid("param").feedbackId))
          .returning({ id: feedback.id });
        if (!row) fail(404, "Not found");
        return c.json({ ok: true });
      },
    );
}
