import { describe, expect, it, vi } from "vitest";
import { cached, FAILURE_TTL, liveInsights, parseEspnNews, parseEspnSummary } from "../src/insights";

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
    predictor: {
      header: "Matchup Predictor",
      homeTeam: { id: "33", gameProjection: "81.2" },
      awayTeam: { id: "24", gameProjection: "18.6" },
    },
  };

  it("lines each team's form up by side", () => {
    const matchup = parseEspnSummary(summary, "401");
    expect(matchup).toMatchObject({
      home: { record: "4-5", venueRecord: "1-3" },
      away: { record: "0-8", venueRecord: "0-4", lastFive: [], injuries: [] },
      stats: [{ label: "Points Per Game", home: "21.3", away: "15.1" }],
      overUnder: 38.5,
      prediction: { home: 0.812, away: 0.186 },
      url: "https://www.espn.com/nfl/game/_/gameId/401",
    });
    expect(matchup?.home.lastFive).toEqual([
      { opponent: "ATL", home: false, result: "W", score: "30-23 OT" },
    ]);
    expect(matchup?.away.leaders).toEqual([
      { label: "Passing Yards", name: "Justin Herbert", line: "1,591 YDS" },
    ]);
  });

  it("matches ESPN's prediction to the teams by id, not by the order it lists them", () => {
    const predictor = {
      homeTeam: { id: "24", gameProjection: 30 },
      awayTeam: { id: "33", gameProjection: "69.5" },
    };
    expect(parseEspnSummary({ ...summary, predictor }, "401")?.prediction).toEqual({
      home: 0.695,
      away: 0.3,
    });
  });

  it("shows no prediction when ESPN has none or it doesn't add up", () => {
    const { predictor: _, ...finished } = summary;
    expect(parseEspnSummary(finished, "401")?.prediction).toBeNull();
    const team = (id: string, gameProjection: unknown) => ({ id, gameProjection });
    for (const predictor of [
      { homeTeam: team("33", "81.2"), awayTeam: team("99", "18.6") },
      { homeTeam: team("33", "81.2"), awayTeam: team("24", "") },
      { homeTeam: team("33", "81.2"), awayTeam: team("24", "-5") },
      { homeTeam: team("33", "81.2"), awayTeam: team("24", "48.6") },
      { homeTeam: team("33", "81.2") },
    ]) {
      const matchup = parseEspnSummary({ ...summary, predictor }, "401");
      expect(matchup?.prediction).toBeNull();
      // The rest of the sheet still shows.
      expect(matchup?.home.record).toBe("4-5");
    }
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
  it("reuses a result until it expires", async () => {
    let time = 0;
    const get = cached<number>(1000, () => time);
    const load = vi.fn(async () => 1);
    await get("a", load);
    await get("a", load);
    expect(load).toHaveBeenCalledTimes(1);
    time = 1000;
    await get("a", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("remembers a failure for a minute, per key, then asks again", async () => {
    let time = 0;
    const get = cached<number>(10 * 60_000, () => time);
    let down = true;
    const load = vi.fn(async () => {
      if (down) throw new Error("offline");
      return 7;
    });
    await expect(get("b", load)).rejects.toThrow("offline");
    time = FAILURE_TTL - 1;
    await expect(get("b", load)).rejects.toThrow("offline");
    expect(load).toHaveBeenCalledTimes(1);
    // Another key is asked on its own.
    await expect(get("c", load)).rejects.toThrow("offline");
    expect(load).toHaveBeenCalledTimes(2);

    down = false;
    time = FAILURE_TTL;
    expect(await get("b", load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(3);
  });
});

describe("liveInsights", () => {
  it("never puts an unexpected id into a request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await liveInsights(fetchImpl).getMatchup("401/../news")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
