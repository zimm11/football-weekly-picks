/**
 * Live contract checks against ESPN's unofficial feeds: `pnpm test:contract`, and daily in GitHub Actions
 * (`.github/workflows/contract.yml`), which opens an issue when one fails.
 *
 * The app reads ESPN leniently on purpose: a changed matchup-sheet section just disappears, and a scoreboard
 * without `events` parses as an empty week. That keeps the app up, but it also means nothing in the app
 * notices. These checks run the app's own URLs, schemas and parsers against today's real responses and fail
 * on anything that would quietly empty or corrupt what players see.
 */
import { seasonYear, TEAM_ABBRS, teamLogoUrl } from "@picks/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ESPN_SUMMARY_SECTIONS,
  espnNewsSchema,
  espnNewsUrl,
  espnSummaryUrl,
  espnTeamIds,
  liveInsights,
  parseEspnNews,
  parseEspnSummary,
} from "../../src/insights";
import {
  espnProvider,
  espnScoreboardSchema,
  espnScoreboardUrl,
  type ProviderGame,
  parseEspnScoreboard,
  superBowlWeek,
} from "../../src/nfl";
import {
  expectNone,
  expectShape,
  fetchWithRetry,
  findUpcomingWeek,
  getJson,
  kickingOffSoon,
  now,
  scoreboard,
  type Week,
} from "./helpers";

const KNOWN_TEAMS = new Set<string>(TEAM_ABBRS);
/** `liveInsights` only looks up ids of this shape, so a game with any other id gets no matchup sheet. */
const ESPN_ID = /^\d{1,12}$/;
/** Six teams on bye is the most the NFL schedules, so a week has at least 13 games. */
const MIN_GAMES_PER_WEEK = 13;

/** The last week of the previous season: always played in full, so every game has a final score. */
const lastSeason = seasonYear(now) - 1;
let finished: Week;
let upcoming: Week | null;

beforeAll(async () => {
  [finished, upcoming] = await Promise.all([scoreboard(lastSeason, 18), findUpcomingWeek()]);
}, 120_000);

/** Problems with the games the app would import: unknown teams, ids it can't use, impossible slates. */
function gameProblems(games: ProviderGame[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const g of games) {
    const name = `${g.awayTeam} @ ${g.homeTeam} (${g.externalId})`;
    if (!ESPN_ID.test(g.externalId)) problems.push(`${name}: id isn't a plain number`);
    for (const team of [g.homeTeam, g.awayTeam]) {
      if (!KNOWN_TEAMS.has(team)) problems.push(`${name}: "${team}" isn't in TEAM_ABBRS`);
      if (seen.has(team)) problems.push(`${name}: ${team} plays twice in one week`);
      seen.add(team);
    }
    if (g.homeTeam === g.awayTeam) problems.push(`${name}: a team plays itself`);
    if (Number.isNaN(g.kickoff.getTime())) problems.push(`${name}: kickoff isn't a date`);
  }
  if (new Set(games.map((g) => g.externalId)).size !== games.length) problems.push("Game ids repeat");
  return problems;
}

// ---------- Scoreboard: schedule, spreads, results ----------

describe("ESPN scoreboard", () => {
  it("still has the fields the app reads for a finished week", () => {
    expectShape(espnScoreboardSchema, finished.raw, `Scoreboard for ${lastSeason} week 18`);
  });

  it("reports a final score for every game of a finished week", () => {
    const { games } = finished;
    expect(games.length, `${lastSeason} week 18 has every team playing`).toBe(16);
    expectNone(gameProblems(games), `Games in ${lastSeason} week 18 the app can't use`);
    // Scores only come through when ESPN marks the game completed, so this covers the status field too.
    const unscored = games.filter((g) => !Number.isInteger(g.homeScore) || !Number.isInteger(g.awayScore));
    expectNone(
      unscored.map((g) => `${g.awayTeam} @ ${g.homeTeam}`),
      "Finished games with no final score (results would never fill in)",
    );
  });

  it("lists the upcoming week's slate with teams the app knows", (ctx) => {
    if (!upcoming) return ctx.skip("Offseason: no regular-season game left to kick off");
    expectShape(espnScoreboardSchema, upcoming.raw, `Scoreboard for ${upcoming.year} week ${upcoming.week}`);
    const { games } = upcoming;
    expect(games.length, `${upcoming.year} week ${upcoming.week} game count`).toBeGreaterThanOrEqual(
      MIN_GAMES_PER_WEEK,
    );
    expectNone(gameProblems(games), `Games in ${upcoming.year} week ${upcoming.week} the app can't use`);
    const scoredEarly = games.filter((g) => g.kickoff > now && g.homeScore !== null);
    expectNone(
      scoredEarly.map((g) => `${g.awayTeam} @ ${g.homeTeam}`),
      "Games not yet played that already have a final score",
    );
  });

  it("gives spreads as the home team's line, in half points", (ctx) => {
    if (!upcoming) return ctx.skip("Offseason: no lines posted");
    const lines = oddsWithFavorite(upcoming.raw);
    const soon = kickingOffSoon(upcoming.games);
    if (soon.length > 0) {
      expect(
        soon.some((g) => g.spread !== null),
        `No line on any of the ${soon.length} games kicking off in the next 3 days`,
      ).toBe(true);
    }
    if (lines.length === 0) return ctx.skip("No lines posted for the upcoming week yet");

    const problems: string[] = [];
    for (const line of lines) {
      const game = upcoming.games.find((g) => g.externalId === line.id);
      const name = game ? `${game.awayTeam} @ ${game.homeTeam} ("${line.details}")` : line.id;
      const spread = game?.spread ?? null;
      if (spread === null) {
        problems.push(`${name}: ESPN has a line but the app read none`);
        continue;
      }
      if (!Number.isInteger(spread * 2) || Math.abs(spread) > 60)
        problems.push(`${name}: ${spread} isn't a spread the app accepts`);
      const favorite = spread < 0 ? "home" : spread > 0 ? "away" : "even";
      if (line.favorite === null) problems.push(`${name}: can't tell which side is favored`);
      else if (line.favorite !== favorite)
        problems.push(`${name}: read ${spread}, but the ${line.favorite} team is favored`);
    }
    expectNone(problems, "Spreads the app reads wrongly");
  });
});

// ---------- Scoreboard: the postseason (weeks 19–22), quarter lines, placeholders ----------

describe("ESPN postseason scoreboard", () => {
  let wildCard: Week;
  let superBowl: ProviderGame[];
  /** The coming postseason's Wild Card round, which ESPN lists as "TBD at TBD" until the teams are known. */
  let comingRound: unknown;
  beforeAll(async () => {
    [wildCard, superBowl, comingRound] = await Promise.all([
      scoreboard(lastSeason, 19),
      espnProvider(fetchWithRetry).getWeek(lastSeason, 22),
      getJson(espnScoreboardUrl(seasonYear(now), 19)),
    ]);
  }, 120_000);

  it("serves the Wild Card round as postseason week 1", () => {
    const meta = expectShape(
      z.object({ season: z.object({ type: z.number() }), week: z.object({ number: z.number() }) }),
      wildCard.raw,
      `Scoreboard for ${lastSeason} week 19`,
    );
    expect(meta, "Week 19 should be ESPN's postseason (seasontype 3) week 1").toMatchObject({
      season: { type: 3 },
      week: { number: 1 },
    });
    expect(wildCard.games.length, `${lastSeason} Wild Card round game count`).toBe(6);
    expectNone(gameProblems(wildCard.games), `Wild Card games in ${lastSeason} the app can't use`);
  });

  it("finds the Super Bowl's week in the calendar, and the game in it", () => {
    expect(superBowlWeek(wildCard.raw), "The postseason calendar has no Super Bowl entry").not.toBeNull();
    expect(superBowl.length, `${lastSeason} Super Bowl (week 22) game count`).toBe(1);
    expectNone(gameProblems(superBowl), "The Super Bowl as the app reads it");
    expect(superBowl[0]?.status, "The last Super Bowl should be final").toBe("final");
  });

  it("gives each finished game its cumulative score by quarter, overtime in the final", () => {
    const problems: string[] = [];
    for (const g of [...wildCard.games, ...superBowl]) {
      const name = `${g.awayTeam} @ ${g.homeTeam}`;
      const q = g.periodScores;
      if (g.status !== "final") problems.push(`${name}: not marked final`);
      // A live score is read only while the feed says the game is in progress (state "in").
      if (g.liveScore) problems.push(`${name}: finished but read as still under way`);
      if ((g.period ?? 0) < 4) problems.push(`${name}: finished in period ${g.period}, before the 4th`);
      if (!q?.q1 || !q.half || !q.q3 || !q.final) {
        problems.push(`${name}: missing a quarter (${Object.keys(q ?? {}).join(", ") || "none"})`);
        continue;
      }
      for (const side of ["home", "away"] as const) {
        if (!(q.q1[side] <= q.half[side] && q.half[side] <= q.q3[side] && q.q3[side] <= q.final[side])) {
          problems.push(`${name}: ${side} scores go down between quarters`);
        }
      }
      if (q.final.home !== g.homeScore || q.final.away !== g.awayScore) {
        problems.push(`${name}: the final in the quarter line isn't the game's final score`);
      }
    }
    expectNone(problems, "Quarter lines the app reads wrongly");
  });

  it("adds up each team's periods to its score, overtime included", () => {
    const schema = z.object({
      events: z.array(
        z.object({
          competitions: z.array(
            z.object({
              competitors: z.array(
                z.object({
                  score: z.coerce.number(),
                  team: z.object({ abbreviation: z.string() }),
                  linescores: z.array(z.object({ value: z.number() })),
                }),
              ),
            }),
          ),
        }),
      ),
    });
    const problems = expectShape(schema, wildCard.raw, "Wild Card line scores").events.flatMap((event) =>
      (event.competitions[0]?.competitors ?? []).flatMap((team) => {
        const sum = team.linescores.reduce((total, line) => total + line.value, 0);
        return sum === team.score
          ? []
          : [`${team.team.abbreviation}: periods add to ${sum}, score ${team.score}`];
      }),
    );
    expectNone(problems, "Line scores that don't add up");
  });

  it("lists a round's games as TBD, with negative team ids, until the teams are known", (ctx) => {
    const schema = z.object({
      events: z
        .array(
          z.object({
            competitions: z.array(
              z.object({
                competitors: z.array(
                  z.object({ team: z.object({ abbreviation: z.string(), id: z.string() }) }),
                ),
              }),
            ),
          }),
        )
        .default([]),
    });
    const { events } = expectShape(schema, comingRound, `Scoreboard for ${seasonYear(now)} week 19`);
    if (events.length === 0) return ctx.skip("The coming Wild Card round isn't listed yet");
    const teams = events.flatMap((e) => e.competitions[0]?.competitors.map((c) => c.team) ?? []);
    const odd = teams.filter(
      (t) => !KNOWN_TEAMS.has(t.abbreviation) && !(t.abbreviation === "TBD" && t.id.startsWith("-")),
    );
    expectNone(
      odd.map((t) => `${t.abbreviation} (id ${t.id})`),
      "Teams that are neither real nor the TBD placeholder",
    );
    const known = events.filter((e) =>
      (e.competitions[0]?.competitors ?? []).every((c) => KNOWN_TEAMS.has(c.team.abbreviation)),
    );
    expect(parseEspnScoreboard(comingRound).length, "Placeholder games should be left out").toBe(
      known.length,
    );
  });
});

/**
 * The scoreboard's own description of each posted line, to check the sign of `spread` against: "CIN -3.5"
 * (team first), falling back to the favorite flags. The app reads neither; they're only for this check.
 */
function oddsWithFavorite(raw: unknown) {
  const side = z.object({ favorite: z.boolean().optional() }).optional();
  const schema = z.object({
    events: z.array(
      z.object({
        id: z.string(),
        competitions: z.array(
          z.object({
            competitors: z.array(
              z.object({ homeAway: z.string(), team: z.object({ abbreviation: z.string() }) }),
            ),
            odds: z
              .array(
                z
                  .object({
                    spread: z.number().nullish(),
                    details: z.string().optional(),
                    homeTeamOdds: side,
                    awayTeamOdds: side,
                  })
                  .nullable(),
              )
              .optional(),
          }),
        ),
      }),
    ),
  });
  return expectShape(schema, raw, "Scoreboard odds").events.flatMap((event) => {
    const competition = event.competitions[0];
    const odds = competition?.odds?.[0];
    if (!competition || odds?.spread == null) return [];
    const abbr = (homeAway: string) =>
      competition.competitors.find((c) => c.homeAway === homeAway)?.team.abbreviation;
    const details = odds.details ?? "";
    const named = /^([A-Z]{2,3}) -\d/.exec(details)?.[1];
    let favorite: "home" | "away" | "even" | null = null;
    if (/^(EVEN|PK|PICK)/i.test(details)) favorite = "even";
    else if (named && named === abbr("home")) favorite = "home";
    else if (named && named === abbr("away")) favorite = "away";
    else if (odds.homeTeamOdds?.favorite) favorite = "home";
    else if (odds.awayTeamOdds?.favorite) favorite = "away";
    return [{ id: event.id, details, favorite }];
  });
}

// ---------- Game summary: the matchup sheet ----------

describe("ESPN game summary", () => {
  /** The next game to kick off, as the matchup sheet sees it before kickoff. */
  const nextGame = () => upcoming?.games.find((g) => g.kickoff > now);
  const noGameReason = () =>
    upcoming?.unreadable
      ? "The scoreboard couldn't be read, so there's no game to preview (see the scoreboard checks)"
      : "Offseason: no game to preview";

  it("has every section the matchup sheet shows before kickoff", async (ctx) => {
    const game = nextGame();
    if (!upcoming || !game) return ctx.skip(noGameReason());
    const name = `${game.awayTeam} @ ${game.homeTeam} (${game.externalId})`;
    const summary = (await getJson(espnSummaryUrl(game.externalId))) as Record<string, unknown>;

    for (const [key, schema] of Object.entries(ESPN_SUMMARY_SECTIONS)) {
      // The over/under only appears once a line is posted.
      if (key === "pickcenter" && summary[key] === undefined) continue;
      expectShape(schema, summary[key], `Summary section "${key}" for ${name}`);
    }
    const header = expectShape(ESPN_SUMMARY_SECTIONS.header, summary.header, `Summary header for ${name}`);
    // Any state other than "pre" makes the sheet drop the season averages as if the game had started.
    expect(header.competitions[0]?.status?.type.state, `${name} status before kickoff`).toBe("pre");

    const sheet = parseEspnSummary(summary, game.externalId);
    expect(sheet, `${name}: the summary doesn't name both teams`).not.toBeNull();
    if (!sheet) return;
    // The Matchup Predictor names its teams by id, so it comes out empty if those stop matching the header's.
    expect(sheet.prediction, `${name}: ESPN's win prediction`).not.toBeNull();
    // Week 1 has no season to draw form from yet.
    if (upcoming.week === 1) return;
    const empty: string[] = [];
    for (const side of ["home", "away"] as const) {
      const team = sheet[side];
      if (team.record === null) empty.push(`${side} record`);
      if (team.venueRecord === null) empty.push(`${side} ${side === "home" ? "home" : "road"} record`);
      if (team.lastFive.length === 0) empty.push(`${side} last five games`);
      if (team.leaders.length === 0) empty.push(`${side} leaders`);
    }
    if (sheet.stats.length === 0) empty.push("season stats");
    expectNone(empty, `Matchup sheet parts that came out empty for ${name}`);
  });

  it("names both teams for a finished game", async () => {
    const game = finished.games[0];
    expect(game, `${lastSeason} week 18 has a game`).toBeDefined();
    if (!game) return;
    const summary = await getJson(espnSummaryUrl(game.externalId));
    expect(espnTeamIds(summary), `Summary for ${game.awayTeam} @ ${game.homeTeam}`).not.toBeNull();
  });

  it("serves the whole matchup sheet, news included, through liveInsights", async (ctx) => {
    const game = nextGame();
    if (!game) return ctx.skip(noGameReason());
    const sheet = await liveInsights(fetchWithRetry).getMatchup(game.externalId);
    expect(sheet, "liveInsights found no matchup").not.toBeNull();
    // News failures are swallowed into an empty list, so an empty list is the only sign of one.
    expect(sheet?.home.news.length, `${game.homeTeam} news`).toBeGreaterThan(0);
    expect(sheet?.away.news.length, `${game.awayTeam} news`).toBeGreaterThan(0);
  });
});

// ---------- Team news ----------

describe("ESPN team news", () => {
  it("returns linkable ESPN articles about the team asked for", async () => {
    const game = finished.games[0];
    if (!game) throw new Error(`${lastSeason} week 18 has no games`);
    const ids = espnTeamIds(await getJson(espnSummaryUrl(game.externalId)));
    if (!ids) throw new Error(`Summary for ${game.externalId} doesn't name both teams`);

    const raw = await getJson(espnNewsUrl(ids.home));
    const feed = expectShape(espnNewsSchema, raw, `News for team ${ids.home} (${game.homeTeam})`);
    expect(feed.articles.length, `News for ${game.homeTeam}`).toBeGreaterThan(0);
    // Only https espn.com links are shown, so a feed of other links shows nothing.
    expect(parseEspnNews(raw).length, `Shown headlines for ${game.homeTeam}`).toBeGreaterThan(0);

    // If ESPN starts ignoring `team`, every sheet shows the same league-wide headlines. The app doesn't read
    // the tags; this check does, to catch that.
    const tagged = z.object({
      articles: z.array(
        z.object({ categories: z.array(z.object({ teamId: z.coerce.string().optional() })).default([]) }),
      ),
    });
    const tags = expectShape(tagged, raw, "News article team tags").articles;
    expect(
      tags.some((a) => a.categories.some((c) => c.teamId === ids.home)),
      `No article in team ${ids.home}'s news is tagged with that team`,
    ).toBe(true);
  });
});

// ---------- Team logos ----------

describe("ESPN team logos", () => {
  it("has a logo for every team at the address TeamLogo uses", async () => {
    const missing: string[] = [];
    await Promise.all(
      TEAM_ABBRS.map(async (abbr) => {
        const res = await fetchWithRetry(teamLogoUrl(abbr, 28));
        const type = res.headers.get("content-type") ?? "";
        await res.body?.cancel();
        if (!res.ok || !type.startsWith("image/"))
          missing.push(`${abbr} (HTTP ${res.status}, ${type || "no type"})`);
      }),
    );
    expectNone(missing.sort(), "Teams whose logo doesn't load");
  });
});
