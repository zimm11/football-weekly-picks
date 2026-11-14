import { describe, expect, it, vi } from "vitest";
import {
  cached,
  kalshiEventSuffix,
  liveInsights,
  type MarketGame,
  marketInsights,
  parseEspnNews,
  parseEspnSummary,
  parseKalshiBoard,
} from "../src/insights";

const SUNDAY = new Date("2026-11-15T18:00:00Z");
const lions: MarketGame = { homeTeam: "DET", awayTeam: "NE", kickoff: SUNDAY, spread: -3.5 };

const market = (ticker: string, bid: number, ask: number, over?: number, status = "active") => ({
  ticker,
  status,
  floor_strike: over,
  yes_bid_dollars: bid.toFixed(4),
  yes_ask_dollars: ask.toFixed(4),
});
const winner = {
  markets: [
    market("KXNFLGAME-26NOV15NEDET-DET", 0.57, 0.58),
    market("KXNFLGAME-26NOV15NEDET-NE", 0.42, 0.43),
  ],
};
const ladder = {
  markets: [
    market("KXNFLSPREAD-26NOV15NEDET-DET3", 0.52, 0.53, 2.5),
    market("KXNFLSPREAD-26NOV15NEDET-DET4", 0.42, 0.43, 3.5),
    market("KXNFLSPREAD-26NOV15NEDET-DET7", 0.34, 0.35, 6.5),
    market("KXNFLSPREAD-26NOV15NEDET-NE3", 0.38, 0.39, 2.5),
    market("KXNFLSPREAD-26NOV15NEDET-NE4", 0.29, 0.3, 3.5),
    // Nobody is really quoting this one: the gap is too wide to call a price.
    market("KXNFLSPREAD-26NOV15NEDET-NE6", 0.1, 0.6, 5.5),
  ],
};

describe("kalshiEventSuffix", () => {
  it("uses the Eastern kickoff date, away team first", () => {
    expect(kalshiEventSuffix(lions)).toBe("26NOV15NEDET");
    // Monday night in the east is already Tuesday in UTC.
    const monday = { homeTeam: "BAL", awayTeam: "LAC", kickoff: new Date("2026-11-17T01:15:00Z") };
    expect(kalshiEventSuffix(monday)).toBe("26NOV16LACBAL");
  });

  it("translates the teams Kalshi spells differently", () => {
    expect(kalshiEventSuffix({ homeTeam: "WSH", awayTeam: "JAX", kickoff: SUNDAY })).toBe("26NOV15JACWAS");
  });
});

describe("market prices", () => {
  const board = parseKalshiBoard(winner, ladder, lions);

  it("reads the win probability and each line from live two-sided quotes", () => {
    expect(board.homeWin).toBeCloseTo(0.575);
    expect(board.rungs).toHaveLength(5);
    expect(board.rungs).toContainEqual({ side: "home", over: 3.5, p: expect.closeTo(0.425) });
  });

  it("prices the league's line for a favored home team, and finds the market's own line", () => {
    expect(marketInsights(board, -3.5)).toEqual({
      source: "Kalshi",
      homeWin: 0.575,
      cover: { home: 0.425, away: 0.575 },
      spread: -2.5,
    });
  });

  it("prices the league's line for a home underdog from the away team's ladder", () => {
    // Detroit +2.5 covers unless New England wins by more than 2.5.
    expect(marketInsights(board, 2.5)?.cover).toEqual({ home: 0.615, away: 0.385 });
  });

  it("leaves room for a push on a whole-number line", () => {
    // Detroit -3: wins by more than 3.5 to cover; New England covers unless Detroit wins by more than 2.5.
    expect(marketInsights(board, -3)?.cover).toEqual({ home: 0.425, away: 0.475 });
  });

  it("uses the win probability for a pick'em", () => {
    expect(marketInsights(board, 0)?.cover).toEqual({ home: 0.575, away: 0.425 });
  });

  it("gives no cover price for a line the market isn't quoting", () => {
    const result = marketInsights(board, -5.5);
    expect(result?.cover).toBeNull();
    expect(result?.homeWin).toBe(0.575);
    expect(marketInsights(board, null)?.cover).toBeNull();
  });

  it("shows nothing once the markets have closed or when the game isn't listed", () => {
    const closed = {
      markets: [market("KXNFLGAME-26NOV15NEDET-DET", 0.99, 1, undefined, "finalized")],
    };
    expect(marketInsights(parseKalshiBoard(closed, null, lions), -3.5)).toBeNull();
    expect(marketInsights(parseKalshiBoard({ markets: [] }, { unexpected: true }, lions), -3.5)).toBeNull();
  });
});

describe("parseEspnSummary", () => {
  const team = (id: string, abbreviation: string) => ({ id, abbreviation });
  const summary = {
    header: {
      competitions: [
        {
          competitors: [
            {
              homeAway: "home",
              team: team("33", "BAL"),
              record: [
                { type: "total", summary: "4-5" },
                { type: "home", summary: "1-3" },
              ],
            },
            {
              homeAway: "away",
              team: team("24", "LAC"),
              record: [
                { type: "total", summary: "0-8" },
                { type: "road", summary: "0-4" },
              ],
            },
          ],
        },
      ],
    },
    boxscore: {
      teams: [
        {
          team: team("24", "LAC"),
          statistics: [{ name: "totalPointsPerGame", label: "Points Per Game", displayValue: "15.1" }],
        },
        {
          team: team("33", "BAL"),
          statistics: [{ name: "totalPointsPerGame", label: "Points Per Game", displayValue: "21.3" }],
        },
      ],
    },
    lastFiveGames: [
      {
        team: team("33", "BAL"),
        events: [{ atVs: "@", gameResult: "W", score: "30-23 OT", opponent: { abbreviation: "ATL" } }],
      },
    ],
    injuries: [
      {
        team: team("33", "BAL"),
        injuries: [
          { status: "Questionable", athlete: { displayName: "A Safety", position: { abbreviation: "S" } } },
          {
            status: "Injured Reserve",
            athlete: { displayName: "Lamar Jackson", position: { abbreviation: "QB" } },
            details: { type: "Thumb" },
          },
        ],
      },
    ],
    leaders: [
      {
        team: team("24", "LAC"),
        leaders: [
          {
            displayName: "Passing Yards",
            leaders: [{ displayValue: "1,591 YDS", athlete: { displayName: "Justin Herbert" } }],
          },
        ],
      },
    ],
    pickcenter: [{ overUnder: 38.5 }],
  };

  it("lines each team's form up by side", () => {
    const matchup = parseEspnSummary(summary, "401");
    expect(matchup).toMatchObject({
      home: { record: "4-5", venueRecord: "1-3" },
      away: { record: "0-8", venueRecord: "0-4", lastFive: [], injuries: [] },
      stats: [{ label: "Points Per Game", home: "21.3", away: "15.1" }],
      overUnder: 38.5,
      url: "https://www.espn.com/nfl/game/_/gameId/401",
    });
    expect(matchup?.home.lastFive).toEqual([
      { opponent: "ATL", home: false, result: "W", score: "30-23 OT" },
    ]);
    expect(matchup?.away.leaders).toEqual([
      { label: "Passing Yards", name: "Justin Herbert", line: "1,591 YDS" },
    ]);
  });

  it("lists injured quarterbacks first", () => {
    expect(parseEspnSummary(summary, "401")?.home.injuries).toEqual([
      { name: "Lamar Jackson", position: "QB", status: "Injured Reserve", injury: "Thumb" },
      { name: "A Safety", position: "S", status: "Questionable", injury: null },
    ]);
  });

  it("keeps what it can read when a section changes shape", () => {
    const matchup = parseEspnSummary({ ...summary, injuries: "soon", boxscore: { teams: 3 } }, "401");
    expect(matchup?.home.record).toBe("4-5");
    expect(matchup?.home.injuries).toEqual([]);
    expect(matchup?.stats).toEqual([]);
  });

  it("drops the box score once the game has started, when it stops being season averages", () => {
    const [competition] = summary.header.competitions;
    const live = {
      ...summary,
      header: { competitions: [{ ...competition, status: { type: { state: "in" } } }] },
    };
    const matchup = parseEspnSummary(live, "401");
    expect(matchup?.stats).toEqual([]);
    expect(matchup?.home.record).toBe("4-5");
    const upcoming = {
      ...summary,
      header: { competitions: [{ ...competition, status: { type: { state: "pre" } } }] },
    };
    expect(parseEspnSummary(upcoming, "401")?.stats).toHaveLength(1);
  });

  it("gives up when the feed doesn't name both teams", () => {
    expect(parseEspnSummary({}, "401")).toBeNull();
    expect(parseEspnSummary(null, "401")).toBeNull();
  });

  it("only passes on headlines that link to ESPN over https", () => {
    const article = (headline: string, href: string) => ({
      headline,
      published: "2026-11-13T22:48:46Z",
      links: { web: { href } },
    });
    const news = parseEspnNews({
      articles: [
        article("Good", "https://www.espn.com/nfl/story/_/id/1/good"),
        article("Elsewhere", "https://espn.com.example.test/story"),
        article("Script", "javascript:alert(1)"),
      ],
    });
    expect(news.map((n) => n.headline)).toEqual(["Good"]);
  });
});

describe("cached", () => {
  it("reuses a result until it expires, and doesn't keep failures", async () => {
    let time = 0;
    const get = cached<number>(1000, () => time);
    const load = vi.fn(async () => 1);
    await get("a", load);
    await get("a", load);
    expect(load).toHaveBeenCalledTimes(1);
    time = 1000;
    await get("a", load);
    expect(load).toHaveBeenCalledTimes(2);

    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(get("b", failing)).rejects.toThrow("offline");
    await expect(get("b", failing)).rejects.toThrow("offline");
    expect(failing).toHaveBeenCalledTimes(2);
  });
});

describe("liveInsights", () => {
  it("asks Kalshi for the game by ticker and reads it against the league's spread", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      return Response.json(url.includes("KXNFLSPREAD") ? ladder : winner);
    }) as typeof fetch;
    const provider = liveInsights(fetchImpl);
    expect((await provider.getMarket(lions))?.cover).toEqual({ home: 0.425, away: 0.575 });
    // A second league with a different line reuses the same prices.
    expect((await provider.getMarket({ ...lions, spread: -2.5 }))?.cover).toEqual({
      home: 0.525,
      away: 0.475,
    });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("event_ticker=KXNFLGAME-26NOV15NEDET");
  });

  it("never puts an unexpected id or team code into a request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const provider = liveInsights(fetchImpl);
    expect(await provider.getMatchup("401/../news")).toBeNull();
    expect(await provider.getMarket({ ...lions, homeTeam: "x&y" })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
