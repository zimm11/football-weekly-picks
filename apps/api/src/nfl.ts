import { SQUARE_PERIODS, type SquarePeriod } from "@picks/shared";
import { z } from "zod";

/** A cumulative score: both teams' points so far. */
export type PeriodScore = { home: number; away: number };

/** A game as the schedule provider reports it. */
export type ProviderGame = {
  externalId: string;
  /** Team abbreviations, e.g. "PHI". */
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  /** The home team's line (-3.5 = home favored by 3.5), or null when no line is posted. */
  spread: number | null;
  /** Null unless the game is final. */
  homeScore: number | null;
  awayScore: number | null;
  /** Where the game stands, when the feed says. */
  status?: "scheduled" | "in_progress" | "final";
  /** The period under way: 0 before kickoff, 1–4, then 5 and up for overtime. */
  period?: number;
  /**
   * The cumulative score at the end of each period the feed has settled: q1, half and q3 once the game has moved
   * past them (or reached the break after them), and final (overtime included) once the game is complete.
   */
  periodScores?: Partial<Record<SquarePeriod, PeriodScore>>;
  /** The score so far while the game is under way (a squares board marks the square that would win now). */
  liveScore?: PeriodScore;
};

/** Where schedules, spreads and results come from. Tests inject a fake. */
export type NflProvider = {
  /**
   * `week` is on the app's line: 1–18 the regular season, then 19 (Wild Card), 20 (Divisional), 21 (Conference)
   * and 22 (Super Bowl). Games whose teams aren't known yet ("TBD at TBD") are left out.
   */
  getWeek(year: number, week: number): Promise<ProviderGame[]>;
};

const competitorSchema = z.object({
  homeAway: z.enum(["home", "away"]),
  score: z.coerce.number().optional(),
  team: z.object({ abbreviation: z.string(), id: z.string().optional() }),
  /** Points scored in each period, in order (overtime is a fifth period). */
  linescores: z.array(z.object({ value: z.coerce.number(), period: z.number().optional() })).optional(),
});

/** ESPN's public NFL feeds (scoreboard, game summary, news). */
export const ESPN_SITE_API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

/** ESPN numbers the postseason 1 (Wild Card), 2, 3, then the Pro Bowl (when held) and the Super Bowl. */
export const ESPN_POSTSEASON_WEEKS: Record<number, number> = { 19: 1, 20: 2, 21: 3, 22: 5 };

/**
 * ESPN's scoreboard for one week on the app's 1–22 line. 1–18 are the regular season (seasontype 2); 19–22 the
 * postseason (seasontype 3). The Super Bowl is ESPN's week 5 when a Pro Bowl week sits before it, but the 2026
 * season's calendar lists no Pro Bowl and puts it at week 4, so `espnProvider` reads the calendar for 22
 * (`superBowlWeek`); `espnWeek` overrides the default here.
 */
export function espnScoreboardUrl(year: number, week: number, espnWeek?: number): string {
  const postseason = week > 18;
  const params = new URLSearchParams({
    dates: String(year),
    seasontype: postseason ? "3" : "2",
    week: String(espnWeek ?? (postseason ? (ESPN_POSTSEASON_WEEKS[week] ?? week - 18) : week)),
  });
  return `${ESPN_SITE_API}/scoreboard?${params}`;
}

/** The parts of the scoreboard the app reads. Exported for the live contract checks (`pnpm test:contract`). */
export const espnScoreboardSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.string(),
        date: z.string(),
        competitions: z
          .array(
            z.object({
              competitors: z.array(competitorSchema),
              status: z.object({
                /** The period under way: 0 before kickoff. */
                period: z.number().optional(),
                type: z.object({
                  completed: z.boolean(),
                  /** pre, in or post. */
                  state: z.string().optional(),
                  /** e.g. STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_HALFTIME, STATUS_END_PERIOD, STATUS_FINAL. */
                  name: z.string().optional(),
                }),
              }),
              // ESPN reports the spread from the home team's side, which is how we store it.
              odds: z.array(z.object({ spread: z.number().nullish() }).nullable()).optional(),
            }),
          )
          .min(1),
      }),
    )
    .default([]),
});

/** The season calendar the scoreboard carries, read only for the postseason's week numbers. */
const espnCalendarSchema = z.object({
  leagues: z
    .array(
      z.object({
        calendar: z
          .array(
            z.object({
              value: z.string().optional(),
              entries: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/** ESPN's postseason week for the Super Bowl, from a scoreboard's calendar. Null when the calendar doesn't say. */
export function superBowlWeek(json: unknown): number | null {
  const parsed = espnCalendarSchema.safeParse(json);
  const postseason = parsed.success
    ? parsed.data.leagues?.[0]?.calendar?.find((part) => part.value === "3")
    : undefined;
  const entry = postseason?.entries?.find((e) => /super bowl/i.test(e.label));
  const week = Number(entry?.value);
  return Number.isInteger(week) && week > 0 ? week : null;
}

/** A team the feed lists before it is known: "TBD", with a negative id. */
const isPlaceholder = (team: { abbreviation: string; id?: string }) =>
  team.abbreviation.toUpperCase() === "TBD" || (team.id?.startsWith("-") ?? false);

type Competitor = z.infer<typeof competitorSchema>;

/** Cumulative scores at the end of each settled period. */
function periodScoresOf(
  home: Competitor,
  away: Competitor,
  status: { period?: number; type: { completed: boolean; state?: string; name?: string } },
): ProviderGame["periodScores"] {
  if (!home.linescores?.length && !away.linescores?.length) return undefined;
  const points = (c: Competitor, through: number) =>
    (c.linescores ?? []).slice(0, through).reduce((sum, line) => sum + line.value, 0);
  const complete = status.type.completed;
  const current = status.period ?? 0;
  // At halftime or the break after a quarter, the period just ended is settled although the feed hasn't moved on.
  const atBreak = status.type.name === "STATUS_HALFTIME" || status.type.name === "STATUS_END_PERIOD";
  const settled = (period: number) => complete || current > period || (atBreak && current === period);
  const scores: NonNullable<ProviderGame["periodScores"]> = {};
  const through: Record<Exclude<SquarePeriod, "final">, number> = { q1: 1, half: 2, q3: 3 };
  for (const period of SQUARE_PERIODS) {
    if (period === "final") {
      if (complete && home.score !== undefined && away.score !== undefined) {
        scores.final = { home: home.score, away: away.score };
      }
    } else if (settled(through[period])) {
      scores[period] = { home: points(home, through[period]), away: points(away, through[period]) };
    }
  }
  return scores;
}

function statusOf(type: { completed: boolean; state?: string }): ProviderGame["status"] {
  if (type.completed || type.state === "post") return "final";
  if (type.state === "in") return "in_progress";
  if (type.state === "pre") return "scheduled";
  return undefined;
}

export function parseEspnScoreboard(json: unknown): ProviderGame[] {
  const games: ProviderGame[] = [];
  for (const event of espnScoreboardSchema.parse(json).events) {
    const competition = event.competitions[0];
    const home = competition?.competitors.find((c) => c.homeAway === "home");
    const away = competition?.competitors.find((c) => c.homeAway === "away");
    const kickoff = new Date(event.date);
    if (!competition || !home || !away || Number.isNaN(kickoff.getTime())) continue;
    // A postseason game is listed before its teams are known; it is imported once both are.
    if (isPlaceholder(home.team) || isPlaceholder(away.team)) continue;
    const final = competition.status.type.completed && home.score !== undefined && away.score !== undefined;
    games.push({
      externalId: event.id,
      homeTeam: home.team.abbreviation,
      awayTeam: away.team.abbreviation,
      kickoff,
      spread: competition.odds?.[0]?.spread ?? null,
      homeScore: final ? (home.score ?? null) : null,
      awayScore: final ? (away.score ?? null) : null,
      status: statusOf(competition.status.type),
      period: competition.status.period,
      periodScores: periodScoresOf(home, away, competition.status),
      ...(competition.status.type.state === "in" && home.score !== undefined && away.score !== undefined
        ? { liveScore: { home: home.score, away: away.score } }
        : {}),
    });
  }
  return games.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
}

/**
 * ESPN's public scoreboard feed: free and keyless, but unofficial, so it can change without notice.
 * Everything it supplies can also be entered by the admin by hand.
 */
export function espnProvider(fetchImpl: typeof fetch = fetch): NflProvider {
  const getJson = async (url: string) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`ESPN scoreboard responded ${res.status}`);
    return res.json() as Promise<unknown>;
  };
  return {
    async getWeek(year, week) {
      if (week !== 22) return parseEspnScoreboard(await getJson(espnScoreboardUrl(year, week)));
      // The Super Bowl: ask for the Conference round, whose calendar says which week the Super Bowl is.
      const conference = await getJson(espnScoreboardUrl(year, 21));
      const espnWeek = superBowlWeek(conference) ?? ESPN_POSTSEASON_WEEKS[22];
      return parseEspnScoreboard(await getJson(espnScoreboardUrl(year, 22, espnWeek)));
    },
  };
}
