import type { MatchupInsights, TeamInsights } from "@picks/shared";
import { z } from "zod";
import { ESPN_SITE_API } from "./nfl";

/** Where team stats, news and the win prediction come from. Tests inject a fake. */
export type InsightsProvider = {
  /** `externalId` is the schedule provider's id for the game. Null when it has nothing for that id. */
  getMatchup(externalId: string): Promise<MatchupInsights | null>;
};

// ---------- ESPN: team form, injuries, news, prediction ----------

const INJURY_LIMIT = 8;
const LEADER_LIMIT = 3;
const NEWS_LIMIT = 3;

const teamRef = z.object({ id: z.string() });

const headerSchema = z.object({
  competitions: z
    .array(
      z.object({
        competitors: z.array(
          z.object({
            homeAway: z.enum(["home", "away"]),
            team: teamRef,
            record: z.array(z.object({ type: z.string(), summary: z.string() })).optional(),
          }),
        ),
        status: z.object({ type: z.object({ state: z.string() }) }).optional(),
      }),
    )
    .min(1),
});

const boxscoreSchema = z.object({
  teams: z.array(
    z.object({
      team: teamRef,
      statistics: z.array(z.object({ name: z.string(), label: z.string(), displayValue: z.string() })),
    }),
  ),
});

const lastFiveSchema = z.array(
  z.object({
    team: teamRef,
    events: z.array(
      z.object({
        atVs: z.string(),
        gameResult: z.enum(["W", "L", "T"]),
        score: z.string(),
        opponent: z.object({ abbreviation: z.string() }),
      }),
    ),
  }),
);

const injuriesSchema = z.array(
  z.object({
    team: teamRef,
    injuries: z.array(
      z.object({
        status: z.string(),
        athlete: z.object({
          displayName: z.string(),
          position: z.object({ abbreviation: z.string() }).optional(),
        }),
        details: z.object({ type: z.string().optional() }).optional(),
      }),
    ),
  }),
);

const leadersSchema = z.array(
  z.object({
    team: teamRef,
    leaders: z.array(
      z.object({
        displayName: z.string(),
        leaders: z.array(
          z.object({ displayValue: z.string(), athlete: z.object({ displayName: z.string() }) }),
        ),
      }),
    ),
  }),
);

const pickcenterSchema = z.array(z.object({ overUnder: z.number().nullish() }));

/** A chance in percent ("65.8"), as ESPN sends it. One that doesn't read as a percentage drops the section. */
const projection = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d{1,3}(\.\d+)?$/)
      .transform(Number),
  ])
  .pipe(z.number().min(0).max(100));
const predictorTeam = z.object({ id: z.string(), gameProjection: projection });
const predictorSchema = z.object({ homeTeam: predictorTeam, awayTeam: predictorTeam });

/**
 * The sections of ESPN's game summary the matchup sheet reads, by their key in the feed. Each is parsed on
 * its own, so a changed one disappears from the sheet rather than failing it. Exported for the live contract
 * checks (`pnpm test:contract`), which are what notice.
 */
export const ESPN_SUMMARY_SECTIONS = {
  header: headerSchema,
  boxscore: boxscoreSchema,
  lastFiveGames: lastFiveSchema,
  injuries: injuriesSchema,
  leaders: leadersSchema,
  pickcenter: pickcenterSchema,
  predictor: predictorSchema,
} as const;

export const espnNewsSchema = z.object({
  articles: z.array(
    z.object({
      headline: z.string(),
      published: z.string(),
      links: z.object({ web: z.object({ href: z.string() }) }),
    }),
  ),
});

/** One section of the feed, or undefined if it is missing or has changed shape: the rest still shows. */
function section<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// The players a pick is most likely to turn on come first; the feed's own order (newest first) breaks ties.
const POSITION_ORDER = ["QB", "RB", "WR", "TE"];
const positionRank = (position: string | null) => {
  const rank = POSITION_ORDER.indexOf(position ?? "");
  return rank === -1 ? POSITION_ORDER.length : rank;
};

/** Headlines link out, so only the provider's own https pages get through. */
function espnLink(href: string): string | null {
  try {
    const url = new URL(href);
    const onEspn = url.hostname === "espn.com" || url.hostname.endsWith(".espn.com");
    return url.protocol === "https:" && onEspn ? url.href : null;
  } catch {
    return null;
  }
}

export function parseEspnNews(json: unknown): TeamInsights["news"] {
  const news: TeamInsights["news"] = [];
  for (const article of section(espnNewsSchema, json)?.articles ?? []) {
    const url = espnLink(article.links.web.href);
    if (url && news.length < NEWS_LIMIT)
      news.push({ headline: article.headline, url, published: article.published });
  }
  return news;
}

/** The two teams' ESPN ids, needed to ask for each one's news. Null when the feed doesn't name both sides. */
export function espnTeamIds(json: unknown): { home: string; away: string } | null {
  const competitors = section(headerSchema, (json as { header?: unknown } | null)?.header)?.competitions[0]
    ?.competitors;
  const home = competitors?.find((c) => c.homeAway === "home")?.team.id;
  const away = competitors?.find((c) => c.homeAway === "away")?.team.id;
  return home && away ? { home, away } : null;
}

/** ESPN's game summary, cut down to what the matchup sheet shows. Null when it doesn't name both sides. */
export function parseEspnSummary(
  json: unknown,
  externalId: string,
  news: { home: TeamInsights["news"]; away: TeamInsights["news"] } = { home: [], away: [] },
): MatchupInsights | null {
  const ids = espnTeamIds(json);
  if (!ids) return null;
  const feed = json as Record<string, unknown>;
  const competition = section(headerSchema, feed.header)?.competitions[0];
  const competitors = competition?.competitors ?? [];
  // Before kickoff the box score holds season averages; after it, that game's own numbers, which aren't
  // what "how good is this team" is asking.
  const started = competition?.status !== undefined && competition.status.type.state !== "pre";
  const boxscore = started ? [] : (section(boxscoreSchema, feed.boxscore)?.teams ?? []);
  const lastFive = section(lastFiveSchema, feed.lastFiveGames) ?? [];
  const injuries = section(injuriesSchema, feed.injuries) ?? [];
  const leaders = section(leadersSchema, feed.leaders) ?? [];

  const team = (side: "home" | "away"): TeamInsights => {
    const id = ids[side];
    const records = competitors.find((c) => c.team.id === id)?.record ?? [];
    const record = (type: string) => records.find((r) => r.type === type)?.summary ?? null;
    return {
      record: record("total"),
      venueRecord: record(side === "home" ? "home" : "road"),
      lastFive: (lastFive.find((t) => t.team.id === id)?.events ?? []).map((e) => ({
        opponent: e.opponent.abbreviation,
        home: e.atVs !== "@",
        result: e.gameResult,
        score: e.score,
      })),
      injuries: (injuries.find((t) => t.team.id === id)?.injuries ?? [])
        .map((i) => ({
          name: i.athlete.displayName,
          position: i.athlete.position?.abbreviation ?? null,
          status: i.status,
          injury: i.details?.type ?? null,
        }))
        .sort((a, b) => positionRank(a.position) - positionRank(b.position))
        .slice(0, INJURY_LIMIT),
      leaders: (leaders.find((t) => t.team.id === id)?.leaders ?? [])
        .flatMap((category) => {
          const top = category.leaders[0];
          return top
            ? [{ label: category.displayName, name: top.athlete.displayName, line: top.displayValue }]
            : [];
        })
        .slice(0, LEADER_LIMIT),
      news: news[side],
    };
  };

  const statsOf = (id: string) => boxscore.find((t) => t.team.id === id)?.statistics ?? [];
  const homeStats = new Map(statsOf(ids.home).map((s) => [s.name, s.displayValue]));
  const stats = statsOf(ids.away).flatMap((s) => {
    const home = homeStats.get(s.name);
    return home === undefined ? [] : [{ label: s.label, home, away: s.displayValue }];
  });

  return {
    home: team("home"),
    away: team("away"),
    stats,
    overUnder: section(pickcenterSchema, feed.pickcenter)?.[0]?.overUnder ?? null,
    prediction: prediction(section(predictorSchema, feed.predictor), ids),
    url: `https://www.espn.com/nfl/game/_/gameId/${externalId}`,
  };
}

/**
 * The Matchup Predictor's chances by side. It names its teams by id, so they are matched to the header's
 * rather than trusted to be the right way round; one that names other teams, or adds up past 100%, is dropped.
 */
function prediction(
  predictor: z.infer<typeof predictorSchema> | undefined,
  ids: { home: string; away: string },
): MatchupInsights["prediction"] {
  if (!predictor) return null;
  const chance = (id: string) =>
    [predictor.homeTeam, predictor.awayTeam].find((t) => t.id === id)?.gameProjection;
  const home = chance(ids.home);
  const away = chance(ids.away);
  if (home === undefined || away === undefined || ids.home === ids.away || home + away > 100.5) return null;
  const round = (percent: number) => Math.round(percent * 10) / 1000;
  return { home: round(home), away: round(away) };
}

// ---------- Live provider ----------

const CACHE_LIMIT = 200;
/** How long a failed lookup is remembered before the source is asked again. */
export const FAILURE_TTL = 60_000;

/**
 * Remembers each key's result for `ttlMs`, so a league opening the same game doesn't refetch it per player.
 * Only settled results are kept: on Workers a request must not wait on I/O another request started, so two
 * requests that miss at the same moment each fetch. A failure is remembered for `failureTtlMs` and thrown
 * again without asking, so an outage costs one round of fetches (and their timeouts) a minute rather than one
 * per sheet opened. Expiry runs on the real clock, not the league's.
 */
export function cached<T>(ttlMs: number, clock: () => number = Date.now, failureTtlMs = FAILURE_TTL) {
  type Entry = { at: number; ok: true; value: T } | { at: number; ok: false; error: unknown };
  const entries = new Map<string, Entry>();
  const remember = (key: string, entry: Entry) => {
    entries.delete(key);
    entries.set(key, entry);
    // Oldest out first: a Map keeps insertion order.
    for (const oldest of entries.keys()) {
      if (entries.size <= CACHE_LIMIT) break;
      entries.delete(oldest);
    }
  };
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && clock() - hit.at < (hit.ok ? ttlMs : failureTtlMs)) {
      if (hit.ok) return hit.value;
      throw hit.error;
    }
    const at = clock();
    try {
      const value = await load();
      remember(key, { at, ok: true, value });
      return value;
    } catch (error) {
      remember(key, { at, ok: false, error });
      throw error;
    }
  };
}

export const espnSummaryUrl = (externalId: string) => `${ESPN_SITE_API}/summary?event=${externalId}`;
export const espnNewsUrl = (teamId: string) =>
  `${ESPN_SITE_API}/news?team=${encodeURIComponent(teamId)}&limit=${NEWS_LIMIT + 2}`;

const MATCHUP_TTL = 10 * 60_000;

/**
 * ESPN's game summary and team news: free and keyless, but unofficial, so it can change or go away. Every
 * caller treats a failure as "nothing to show".
 */
export function liveInsights(
  fetchImpl: typeof fetch = fetch,
  clock: () => number = Date.now,
): InsightsProvider {
  async function getJson(url: string, source: string): Promise<unknown> {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`${source} responded ${res.status}`);
    return res.json();
  }

  const matchups = cached<MatchupInsights | null>(MATCHUP_TTL, clock);
  async function loadMatchup(externalId: string) {
    const summary = await getJson(espnSummaryUrl(externalId), "ESPN summary");
    const ids = espnTeamIds(summary);
    if (!ids) return null;
    // News is a bonus: without it the stats still show.
    const newsFor = (teamId: string) =>
      getJson(espnNewsUrl(teamId), "ESPN news").then(parseEspnNews, () => []);
    const [home, away] = await Promise.all([newsFor(ids.home), newsFor(ids.away)]);
    return parseEspnSummary(summary, externalId, { home, away });
  }

  return {
    async getMatchup(externalId) {
      // The id goes into a URL; ESPN's are plain numbers.
      if (!/^\d{1,12}$/.test(externalId)) return null;
      return matchups(externalId, () => loadMatchup(externalId));
    },
  };
}
