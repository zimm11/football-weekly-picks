import { z } from "zod";

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
};

/** Where schedules, spreads and results come from. Tests inject a fake. */
export type NflProvider = {
  /** `week` is a regular-season week, 1–18. */
  getWeek(year: number, week: number): Promise<ProviderGame[]>;
};

const competitorSchema = z.object({
  homeAway: z.enum(["home", "away"]),
  score: z.coerce.number().optional(),
  team: z.object({ abbreviation: z.string() }),
});

const scoreboardSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.string(),
        date: z.string(),
        competitions: z
          .array(
            z.object({
              competitors: z.array(competitorSchema),
              status: z.object({ type: z.object({ completed: z.boolean() }) }),
              // ESPN reports the spread from the home team's side, which is how we store it.
              odds: z.array(z.object({ spread: z.number().nullish() }).nullable()).optional(),
            }),
          )
          .min(1),
      }),
    )
    .default([]),
});

export function parseEspnScoreboard(json: unknown): ProviderGame[] {
  const games: ProviderGame[] = [];
  for (const event of scoreboardSchema.parse(json).events) {
    const competition = event.competitions[0];
    const home = competition?.competitors.find((c) => c.homeAway === "home");
    const away = competition?.competitors.find((c) => c.homeAway === "away");
    const kickoff = new Date(event.date);
    if (!competition || !home || !away || Number.isNaN(kickoff.getTime())) continue;
    const final = competition.status.type.completed && home.score !== undefined && away.score !== undefined;
    games.push({
      externalId: event.id,
      homeTeam: home.team.abbreviation,
      awayTeam: away.team.abbreviation,
      kickoff,
      spread: competition.odds?.[0]?.spread ?? null,
      homeScore: final ? (home.score ?? null) : null,
      awayScore: final ? (away.score ?? null) : null,
    });
  }
  return games.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
}

/**
 * ESPN's public scoreboard feed: free and keyless, but unofficial, so it can change without notice.
 * Everything it supplies can also be entered by the admin by hand.
 */
export function espnProvider(fetchImpl: typeof fetch = fetch): NflProvider {
  return {
    async getWeek(year, week) {
      // seasontype 2 = regular season.
      const params = new URLSearchParams({ dates: String(year), seasontype: "2", week: String(week) });
      const res = await fetchImpl(
        `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?${params}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) throw new Error(`ESPN scoreboard responded ${res.status}`);
      return parseEspnScoreboard(await res.json());
    },
  };
}
