import {
  type MarketInsights,
  type MatchupInsights,
  NFL_TIME_ZONE,
  type TeamInsights,
  zonedParts,
} from "@picks/shared";
import { z } from "zod";

/** The parts of a game the market lookup needs. */
export type MarketGame = { homeTeam: string; awayTeam: string; kickoff: Date; spread: number | null };

/** Where team stats, news and prediction-market prices come from. Tests inject a fake. */
export type InsightsProvider = {
  /** `externalId` is the schedule provider's id for the game. Null when it has nothing for that id. */
  getMatchup(externalId: string): Promise<MatchupInsights | null>;
  /** Null when the market doesn't list the game or has no usable prices for it. */
  getMarket(game: MarketGame): Promise<MarketInsights | null>;
};

// ---------- ESPN: team form, injuries, news ----------

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

const newsSchema = z.object({
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
  for (const article of section(newsSchema, json)?.articles ?? []) {
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
    url: `https://www.espn.com/nfl/game/_/gameId/${externalId}`,
  };
}

// ---------- Kalshi: prediction-market prices ----------

// Kalshi spells two teams differently from the schedule provider.
const KALSHI_CODES: Record<string, string> = { JAX: "JAC", WSH: "WAS" };
const kalshiCode = (abbr: string) => KALSHI_CODES[abbr] ?? abbr;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** The game's part of a Kalshi event ticker: Eastern kickoff date, away team, home team ("26NOV15NEDET"). */
export function kalshiEventSuffix(game: Pick<MarketGame, "homeTeam" | "awayTeam" | "kickoff">): string {
  const { year, month, day } = zonedParts(game.kickoff, NFL_TIME_ZONE);
  const date = `${String(year % 100).padStart(2, "0")}${MONTHS[month - 1]}${String(day).padStart(2, "0")}`;
  return `${date}${kalshiCode(game.awayTeam)}${kalshiCode(game.homeTeam)}`;
}

const kalshiMarketsSchema = z.object({
  markets: z.array(
    z.object({
      ticker: z.string(),
      status: z.string(),
      floor_strike: z.number().nullish(),
      yes_bid_dollars: z.coerce.number().catch(0),
      yes_ask_dollars: z.coerce.number().catch(0),
    }),
  ),
});
type KalshiMarket = z.infer<typeof kalshiMarketsSchema>["markets"][number];

/** A bid and an ask further apart than this say too little about the price to show. */
const MAX_QUOTE_GAP = 0.1;

/** The midpoint of a live two-sided quote, as a probability. */
function quote(market: KalshiMarket): number | null {
  const { yes_bid_dollars: bid, yes_ask_dollars: ask } = market;
  if (market.status !== "active" || bid <= 0 || ask <= 0 || ask - bid > MAX_QUOTE_GAP) return null;
  return (bid + ask) / 2;
}

/** What the market is quoting for one game, before it is read against a league's spread. */
export type MarketBoard = {
  /** Chance the home team wins outright. */
  homeWin: number | null;
  /** `p` is the chance that `side` wins by more than `over` points. */
  rungs: { side: "home" | "away"; over: number; p: number }[];
};

/** Reads Kalshi's winner and spread markets for a game. Market tickers end in the team's code. */
export function parseKalshiBoard(winnerJson: unknown, spreadJson: unknown, game: MarketGame): MarketBoard {
  const sideOf = (code: string | undefined) =>
    code === kalshiCode(game.homeTeam) ? "home" : code === kalshiCode(game.awayTeam) ? "away" : null;

  const win: { home?: number; away?: number } = {};
  for (const market of section(kalshiMarketsSchema, winnerJson)?.markets ?? []) {
    const side = sideOf(market.ticker.split("-").pop());
    const p = quote(market);
    if (side && p !== null) win[side] = p;
  }
  // Each side trades as its own contract, so the two prices need not add up to exactly 1.
  let homeWin: number | null = null;
  if (win.home !== undefined && win.away !== undefined) homeWin = win.home / (win.home + win.away);
  else if (win.home !== undefined) homeWin = win.home;
  else if (win.away !== undefined) homeWin = 1 - win.away;

  const rungs: MarketBoard["rungs"] = [];
  for (const market of section(kalshiMarketsSchema, spreadJson)?.markets ?? []) {
    // "…-DET7": the team, then a number that only labels the contract. The line itself is `floor_strike`.
    const side = sideOf(market.ticker.split("-").pop()?.replace(/\d+$/, ""));
    const p = quote(market);
    if (side && p !== null && market.floor_strike != null) rungs.push({ side, over: market.floor_strike, p });
  }
  return { homeWin, rungs };
}

/** How far from even a line may be and still be called the market's spread. */
const EVEN_TOLERANCE = 0.1;

/** Reads a game's market prices against the league's spread (the home team's line). */
export function marketInsights(board: MarketBoard, spread: number | null): MarketInsights | null {
  /** Chance the home team's winning margin is above `x`, for x on a half point. */
  const homeBy = (x: number): number | null => {
    // Ties are rare enough that "wins by more than half a point either way" is just winning.
    if (Math.abs(x) <= 0.5) return board.homeWin;
    const side = x > 0 ? "home" : "away";
    const rung = board.rungs.find((r) => r.side === side && r.over === Math.abs(x));
    if (!rung) return null;
    return x > 0 ? rung.p : 1 - rung.p;
  };

  let cover: MarketInsights["cover"] = null;
  if (spread !== null) {
    // The home team covers when it wins by more than `margin`; on a whole number, landing on it is a push.
    const margin = spread === 0 ? 0 : -spread;
    const whole = Number.isInteger(margin);
    const homeCovers = homeBy(whole ? margin + 0.5 : margin);
    const homeNotBeaten = homeBy(whole ? margin - 0.5 : margin);
    if (homeCovers !== null && homeNotBeaten !== null) {
      const away = 1 - homeNotBeaten;
      // Thin quotes on neighboring lines can overlap; a push can't have a negative chance.
      const total = Math.max(1, homeCovers + away);
      cover = { home: homeCovers / total, away: away / total };
    }
  }

  // The market's own spread is the line it prices closest to a coin flip.
  const lines: { x: number; p: number }[] = board.rungs.map((r) =>
    r.side === "home" ? { x: r.over, p: r.p } : { x: -r.over, p: 1 - r.p },
  );
  if (board.homeWin !== null) lines.push({ x: 0, p: board.homeWin });
  const distance = (line: { p: number }) => Math.abs(line.p - 0.5);
  lines.sort((a, b) => distance(a) - distance(b) || Math.abs(a.x) - Math.abs(b.x));
  const even = lines[0];
  const marketSpread = even && distance(even) <= EVEN_TOLERANCE ? (even.x === 0 ? 0 : -even.x) : null;

  if (board.homeWin === null && cover === null && marketSpread === null) return null;
  const round = (p: number) => Math.round(p * 1000) / 1000;
  return {
    source: "Kalshi",
    homeWin: board.homeWin === null ? null : round(board.homeWin),
    cover: cover && { home: round(cover.home), away: round(cover.away) },
    spread: marketSpread,
  };
}

// ---------- Live provider ----------

const CACHE_LIMIT = 200;

/**
 * Remembers each key's result for `ttlMs`, so a league opening the same game doesn't refetch it per player.
 * Only settled results are kept: on Workers a request must not wait on I/O another request started, so two
 * requests that miss at the same moment each fetch. Failures aren't kept. Expiry runs on the real clock, not
 * the league's.
 */
export function cached<T>(ttlMs: number, clock: () => number = Date.now) {
  const entries = new Map<string, { at: number; value: T }>();
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && clock() - hit.at < ttlMs) return hit.value;
    const at = clock();
    const value = await load();
    entries.delete(key);
    entries.set(key, { at, value });
    // Oldest out first: a Map keeps insertion order.
    for (const oldest of entries.keys()) {
      if (entries.size <= CACHE_LIMIT) break;
      entries.delete(oldest);
    }
    return value;
  };
}

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const MATCHUP_TTL = 10 * 60_000;
const MARKET_TTL = 2 * 60_000;

/**
 * ESPN's game summary and Kalshi's public market data: both free and keyless. ESPN's feed is unofficial and
 * either can change or go away, so every caller treats a failure as "nothing to show".
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
    const summary = await getJson(`${ESPN}/summary?event=${externalId}`, "ESPN summary");
    const ids = espnTeamIds(summary);
    if (!ids) return null;
    // News is a bonus: without it the stats still show.
    const newsFor = (teamId: string) =>
      getJson(`${ESPN}/news?team=${encodeURIComponent(teamId)}&limit=${NEWS_LIMIT + 2}`, "ESPN news").then(
        parseEspnNews,
        () => [],
      );
    const [home, away] = await Promise.all([newsFor(ids.home), newsFor(ids.away)]);
    return parseEspnSummary(summary, externalId, { home, away });
  }

  // The board is cached per game, not per league: each league reads it against its own spread.
  const boards = cached<MarketBoard>(MARKET_TTL, clock);
  async function loadBoard(suffix: string, game: MarketGame) {
    const marketsOf = (series: string) =>
      getJson(`${KALSHI}/markets?event_ticker=${series}-${suffix}&limit=200`, "Kalshi markets");
    const [winner, spread] = await Promise.all([
      marketsOf("KXNFLGAME"),
      // The spread ladder is a bonus: the win probability still shows without it.
      marketsOf("KXNFLSPREAD").catch(() => null),
    ]);
    return parseKalshiBoard(winner, spread, game);
  }

  return {
    async getMatchup(externalId) {
      // The id goes into a URL; ESPN's are plain numbers.
      if (!/^\d{1,12}$/.test(externalId)) return null;
      return matchups(externalId, () => loadMatchup(externalId));
    },
    async getMarket(game) {
      // Team codes go into a URL too: hand-added games use the same fixed abbreviations.
      if (!/^[A-Z]{2,3}$/.test(game.homeTeam) || !/^[A-Z]{2,3}$/.test(game.awayTeam)) return null;
      const suffix = kalshiEventSuffix(game);
      return marketInsights(await boards(suffix, () => loadBoard(suffix, game)), game.spread);
    },
  };
}
