import { games, picks, seasons, tiebreakerGuesses, weeks } from "@picks/db";
import {
  createPlayoffRoundSchema,
  effectiveTiebreakerId,
  type GuillotineStatus,
  guillotineStatus,
  mayPickRound,
  type PlayoffFormat,
  type PlayoffRound,
  type PlayoffSettings,
  type PlayoffStandingsView,
  type PlayoffWeekInfo,
  playoffStandings,
  readSeasonSettings,
  roundHasPow,
  roundPoints,
  roundPowBonus,
  SUPER_BOWL_ROUND,
  type SubmitPicks,
  WILD_CARD_ROUND,
} from "@picks/shared";
import { and, asc, desc, eq, inArray, lt, min } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthVariables, requireAuth } from "./auth";
import {
  type AppDeps,
  body,
  fail,
  isActive,
  leagueParam,
  listMemberRecords,
  query,
  recordedParticipants,
  requireAdmin,
  requireLeagueType,
  requireMember,
  type Store,
  type WeekContext,
  weekParticipants,
} from "./context";
import type { AppServices } from "./services";
import type { LeagueTypeHooks } from "./typeHooks";
import { importSlate } from "./weekOps";

/*
 * Playoff pick'em's own routes and rules on the server. The pick sheet, week management and results are the shared
 * week routes in weeks.ts, which accept playoff leagues and call in here for what differs (the format's POW bonus,
 * the guillotine); what only playoff leagues have goes here. Every route checks the league's type first
 * (`requireLeagueType`), so another type's league answers 404. Round automation is automation/playoff.ts.
 */

type SeasonRow = typeof seasons.$inferSelect;

export const playoffFormatOf = (season: Pick<SeasonRow, "settings">): PlayoffFormat =>
  readSeasonSettings("playoff", season.settings).format;

/**
 * The guillotine status of `userIds` from their own picks in the season's rounds before `beforeRound` (all rounds
 * when null), judged at `at`. Server-side only: the caller decides whose status it may show to whom.
 */
export async function guillotineStatuses(
  db: Store,
  seasonId: string,
  userIds: string[],
  at: Date,
  beforeRound: number | null = null,
): Promise<Map<string, GuillotineStatus>> {
  if (userIds.length === 0) return new Map();
  const roundRows = await db
    .select()
    .from(weeks)
    .where(
      and(eq(weeks.seasonId, seasonId), beforeRound === null ? undefined : lt(weeks.number, beforeRound)),
    );
  const ids = roundRows.map((r) => r.id);
  const [gameRows, pickRows] = ids.length
    ? await Promise.all([
        db.select().from(games).where(inArray(games.weekId, ids)),
        db
          .select()
          .from(picks)
          .where(and(inArray(picks.weekId, ids), inArray(picks.userId, userIds))),
      ])
    : [[], []];
  const statuses = guillotineStatus({
    rounds: roundRows.map((r) => ({
      number: r.number,
      games: gameRows.filter((g) => g.weekId === r.id),
      picks: pickRows.filter((p) => p.weekId === r.id),
    })),
    userIds,
    now: at,
  });
  return new Map(statuses.map((s) => [s.userId, s]));
}

/** What a playoff round's week view adds: the round's POW bonus, and the viewer's own guillotine status. */
export async function playoffWeekInfo(
  db: Store,
  ctx: Pick<WeekContext, "season" | "week">,
  userId: string,
  at: Date,
): Promise<{ powBonus: number; info: PlayoffWeekInfo }> {
  const format = playoffFormatOf(ctx.season);
  // Only the viewer's own picks: their POW result shows as soon as its game ends, everyone else's never here.
  const me =
    format === "guillotine"
      ? ((await guillotineStatuses(db, ctx.season.id, [userId], at)).get(userId) ?? null)
      : null;
  return {
    powBonus: roundPowBonus(format, ctx.week.number),
    info: { format, me, mayPick: mayPickRound(me, ctx.week.number), pow: roundHasPow(ctx.week.number) },
  };
}

/**
 * The playoff side of a pick save, inside its transaction. The Super Bowl round has no POW, in either format. A
 * player the guillotine put out in an earlier round can change nothing but their Super Bowl guess. Returns an
 * error to refuse the save with, or the POW to save.
 */
export async function playoffSubmission(
  tx: Store,
  input: {
    season: SeasonRow;
    week: { id: string; number: number };
    userId: string;
    submission: SubmitPicks;
    existing: { gameId: string; side: string; isPow: boolean }[];
    at: Date;
  },
): Promise<{ error: string | null; powGameId: string | null }> {
  const { season, week, userId, submission, existing, at } = input;
  if (!roundHasPow(week.number) && submission.powGameId) {
    return { error: "The Super Bowl has no POW: your pick is worth the round's points.", powGameId: null };
  }
  if (playoffFormatOf(season) !== "guillotine") {
    return { error: null, powGameId: roundHasPow(week.number) ? submission.powGameId : null };
  }
  const status = (await guillotineStatuses(tx, season.id, [userId], at, week.number)).get(userId) ?? null;
  const currentPow = existing.find((p) => p.isPow)?.gameId ?? null;
  if (!mayPickRound(status, week.number)) {
    const saved = new Map(existing.map((p) => [p.gameId, p.side]));
    const changed =
      submission.picks.some((p) => saved.get(p.gameId) !== p.side) || submission.powGameId !== currentPow;
    return {
      error: changed
        ? "You're out of picking this postseason. You can still guess the Super Bowl's total."
        : null,
      powGameId: currentPow,
    };
  }
  return { error: null, powGameId: roundHasPow(week.number) ? submission.powGameId : null };
}

export const playoffHooks: LeagueTypeHooks = {
  /**
   * Start season: the season and its format. Rounds are created by automation once the feed lists them. The
   * format can't change once the first Wild Card game has kicked off.
   */
  async startSeason(tx, { league, year, settings, at }) {
    const parsed = settings as PlayoffSettings;
    await tx.insert(seasons).values({ leagueId: league.id, year, settings: parsed }).onConflictDoNothing();
    const [season] = await tx
      .select()
      .from(seasons)
      .where(and(eq(seasons.leagueId, league.id), eq(seasons.year, year)));
    if (!season) throw new Error("Season upsert returned no row");
    if (playoffFormatOf(season) !== parsed.format) {
      const [first] = await tx
        .select({ kickoff: min(games.kickoff) })
        .from(games)
        .innerJoin(weeks, eq(weeks.id, games.weekId))
        .where(and(eq(weeks.seasonId, season.id), eq(weeks.number, WILD_CARD_ROUND)));
      if (first?.kickoff && first.kickoff <= at) {
        fail(409, "The format can't change once the Wild Card round has kicked off.");
      }
    }
    await tx.update(seasons).set({ settings: parsed }).where(eq(seasons.id, season.id));
  },
};

export function playoffRoutes(
  { db, verifyToken, nfl, now = () => new Date() }: AppDeps,
  services: AppServices,
) {
  const auth = requireAuth(verifyToken);
  // Keep routes chained, or `ApiType` loses their types.
  return (
    new Hono<{ Variables: AuthVariables }>()
      /**
       * The overall table and each player's status, from final rounds only, so nothing still in play shows: in
       * Guillotine everyone learns who is out when the round is final.
       */
      .get(
        "/leagues/:leagueId/playoff/standings",
        auth,
        leagueParam,
        query(
          z.object({
            year: z
              .string()
              .regex(/^\d{4}$/, "Choose a season year")
              .optional(),
          }),
        ),
        async (c) => {
          const { leagueId } = c.req.valid("param");
          const { league } = await requireMember(db, leagueId, c.var.user.id);
          requireLeagueType(league, "playoff");
          await services.advanceLeagueOnRead(league, c.get("requestId"));
          const seasonRows = await db
            .select()
            .from(seasons)
            .where(eq(seasons.leagueId, leagueId))
            .orderBy(desc(seasons.year));
          const requested = c.req.valid("query").year;
          const season = requested ? seasonRows.find((s) => s.year === Number(requested)) : seasonRows[0];
          const format = season ? playoffFormatOf(season) : "traditional";
          const finalRounds = season
            ? await db
                .select()
                .from(weeks)
                .where(and(eq(weeks.seasonId, season.id), eq(weeks.status, "final")))
                .orderBy(asc(weeks.number))
            : [];
          const ids = finalRounds.map((r) => r.id);
          const [gameRows, pickRows, guessRows, recorded] = ids.length
            ? await Promise.all([
                db.select().from(games).where(inArray(games.weekId, ids)),
                db.select().from(picks).where(inArray(picks.weekId, ids)),
                db.select().from(tiebreakerGuesses).where(inArray(tiebreakerGuesses.weekId, ids)),
                recordedParticipants(db, ids),
              ])
            : [[], [], [], new Map<string, Set<string>>()];
          const members = await listMemberRecords(db, leagueId);
          const rounds: PlayoffRound[] = finalRounds.map((round) => {
            const roundGames = gameRows.filter((g) => g.weekId === round.id);
            const roundPicks = pickRows.filter((p) => p.weekId === round.id);
            return {
              number: round.number,
              games: roundGames,
              picks: roundPicks,
              guesses: guessRows.filter((g) => g.weekId === round.id),
              // Each round is scored for the people who were in the league when it was played.
              userIds: weekParticipants(members, roundGames, roundPicks, recorded.get(round.id)).map(
                (m) => m.userId,
              ),
              tiebreakerGameId: effectiveTiebreakerId(round.tiebreakerGameId, roundGames),
            };
          });
          // Current members, plus anyone since removed who played a counted round.
          const userIds = members
            .filter((m) => isActive(m) || rounds.some((r) => r.userIds.includes(m.userId)))
            .map((m) => m.userId);
          const memberOf = new Map(members.map((m) => [m.userId, m]));
          const entries = playoffStandings({ rounds, userIds, format, now: now() }).map((e) => ({
            ...e,
            displayName: memberOf.get(e.userId)?.displayName ?? "Player",
            removed: memberOf.get(e.userId)?.removedAt != null,
          }));
          const superBowl = rounds.find((r) => r.number === SUPER_BOWL_ROUND);
          const superBowlGame = superBowl?.games.find((g) => g.id === superBowl.tiebreakerGameId);
          const view: PlayoffStandingsView = {
            years: seasonRows.map((s) => s.year),
            year: season?.year ?? null,
            format,
            rounds: finalRounds.map((r) => ({ id: r.id, number: r.number })),
            entries,
            champions: entries.filter((e) => e.champion).map((e) => e.displayName),
            superBowlTotal:
              superBowlGame?.homeScore != null && superBowlGame.awayScore != null
                ? superBowlGame.homeScore + superBowlGame.awayScore
                : null,
          };
          return c.json(view);
        },
      )
      /**
       * Creates a round by hand: the admin's fallback when the feed fails (the same as Create week in a hands-on
       * weekly league). Its games are worth the round's points.
       */
      .post(
        "/leagues/:leagueId/playoff/rounds",
        auth,
        leagueParam,
        body(createPlayoffRoundSchema),
        async (c) => {
          const { leagueId } = c.req.valid("param");
          const { year, number, importGames } = c.req.valid("json");
          const { league, role } = await requireMember(db, leagueId, c.var.user.id);
          requireLeagueType(league, "playoff");
          requireAdmin(role);
          await db
            .insert(seasons)
            .values({ leagueId, year, settings: { format: "traditional" } })
            .onConflictDoNothing();
          const [season] = await db
            .select()
            .from(seasons)
            .where(and(eq(seasons.leagueId, leagueId), eq(seasons.year, year)));
          if (!season) throw new Error("Season upsert returned no row");
          const [round] = await db
            .insert(weeks)
            .values({ seasonId: season.id, number })
            .onConflictDoNothing()
            .returning({ id: weeks.id });
          if (!round) fail(409, "That round already exists.");
          const importError = importGames
            ? await importSlate(
                db,
                nfl,
                { id: round.id, year, number },
                { requestId: c.get("requestId"), pointsFor: () => roundPoints(number) },
              )
            : null;
          return c.json({ id: round.id, importError }, 201);
        },
      )
  );
}
