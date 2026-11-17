/**
 * Live contract checks against Kalshi's public market data, the matchup sheet's win and cover prices. Run with
 * the ESPN checks (`pnpm test:contract`, and daily in `.github/workflows/contract.yml`).
 *
 * Kalshi's API is documented, but the app leans on conventions it doesn't promise: event tickers built from
 * the Eastern kickoff date and team codes, the team code at the end of each market ticker, spread strikes on
 * the half point. Each failure is quiet in the app: an event it doesn't list comes back as an empty list, a
 * price that doesn't parse counts as no quote, and a missing rung just drops the cover price. These checks
 * take the games kicking off in the next few days (from ESPN, as the app does) and look them up on Kalshi
 * exactly as `liveInsights` does.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  KALSHI_SERIES,
  kalshiCode,
  kalshiEventSuffix,
  kalshiMarketsSchema,
  kalshiMarketsUrl,
  liveInsights,
  parseKalshiBoard,
} from "../../src/insights";
import type { ProviderGame } from "../../src/nfl";
import {
  expectNone,
  expectShape,
  fetchWithRetry,
  findUpcomingWeek,
  gameName,
  getJson,
  kickingOffSoon,
  type Week,
} from "./helpers";

/** ESPN and Kalshi can disagree on a near pick'em; past this, they must agree on who is favored. */
const CLEAR_FAVORITE = 3;

/**
 * Stricter than the app's schema, which turns a price it can't read into "no quote": here a missing or
 * renamed price field is an error. `yes_sub_title` isn't read by the app; it's only for checking strikes.
 */
const price = z.union([z.string(), z.number()]).pipe(z.transform(Number)).pipe(z.number().min(0).max(1));
const strictMarkets = z.object({
  markets: z.array(
    z.object({
      ticker: z.string(),
      status: z.string(),
      floor_strike: z.number().nullish(),
      yes_bid_dollars: price,
      yes_ask_dollars: price,
      yes_sub_title: z.string().optional(),
    }),
  ),
});
type Markets = z.infer<typeof strictMarkets>["markets"];

type Listed = { game: ProviderGame; ticker: string; winner: unknown; spread: unknown };

let upcoming: Week | null;
const listed: Listed[] = [];

beforeAll(async () => {
  upcoming = await findUpcomingWeek();
  // One at a time: Kalshi rate-limits bursts.
  for (const game of kickingOffSoon(upcoming?.games ?? [])) {
    const suffix = kalshiEventSuffix(game);
    const winner = await getJson(kalshiMarketsUrl(KALSHI_SERIES.winner, suffix));
    const spread = await getJson(kalshiMarketsUrl(KALSHI_SERIES.spread, suffix));
    listed.push({ game, ticker: suffix, winner, spread });
  }
}, 180_000);

/** Why there's nothing to check, or null when there is. */
function nothingToCheck(): string | null {
  if (upcoming?.unreadable) return "ESPN's scoreboard couldn't be read, so there are no games to look up";
  if (listed.length === 0) return "No game kicks off in the next 3 days";
  return null;
}

/** Which side a market ticker's team code names: the code is its last part, before any strike digits. */
function sideOf(ticker: string, game: ProviderGame): "home" | "away" | null {
  const code = ticker.split("-").pop()?.replace(/\d+$/, "");
  if (code === kalshiCode(game.homeTeam)) return "home";
  if (code === kalshiCode(game.awayTeam)) return "away";
  return null;
}

/**
 * Whether Kalshi lists the rungs a cover price at ESPN's line is read from. The ladder skips strikes (10.5, then
 * 13.5), so a line between two rungs has no cover price, and that is the feed's gap, not a broken contract.
 */
function ladderHasLine(board: ReturnType<typeof parseKalshiBoard>, spread: number): boolean {
  const margin = spread === 0 ? 0 : -spread;
  // A whole-number line is priced from the half points either side; within half a point it's the winner market.
  const needed = Number.isInteger(margin) ? [margin + 0.5, margin - 0.5] : [margin];
  return needed.every((x) =>
    Math.abs(x) <= 0.5
      ? board.homeWin !== null
      : board.rungs.some((r) => r.side === (x > 0 ? "home" : "away") && r.over === Math.abs(x)),
  );
}

function read(json: unknown, what: string): Markets {
  // The app's own schema first, then the strict one, so a failure says which kind it is.
  expectShape(kalshiMarketsSchema, json, what);
  return expectShape(strictMarkets, json, `${what} (prices)`).markets;
}

describe("Kalshi markets", () => {
  it("lists a winner market for each game kicking off soon, under the ticker the app builds", (ctx) => {
    const reason = nothingToCheck();
    if (reason) return ctx.skip(reason);
    const problems: string[] = [];
    for (const { game, ticker, winner } of listed) {
      const name = `${gameName(game)} (${KALSHI_SERIES.winner}-${ticker})`;
      const markets = read(winner, `Winner markets for ${name}`);
      if (markets.length === 0) {
        problems.push(`${name}: no markets under this ticker`);
        continue;
      }
      const sides = new Set(markets.map((m) => sideOf(m.ticker, game)));
      for (const m of markets) {
        if (sideOf(m.ticker, game) === null) problems.push(`${name}: ${m.ticker} names neither team's code`);
        // The app only quotes markets in this state, so a game yet to start must be in it.
        if (m.status !== "active") problems.push(`${name}: ${m.ticker} is "${m.status}", not "active"`);
      }
      if (!sides.has("home") && !sides.has("away")) problems.push(`${name}: neither team has a market`);
    }
    expectNone(problems, "Winner markets the app can't use");

    const priced = listed.filter((l) => parseKalshiBoard(l.winner, null, l.game).homeWin !== null);
    expect(priced.length, "Games kicking off soon with a usable win price").toBeGreaterThan(0);
  });

  it("prices the spread ladder on half-point strikes, by team", (ctx) => {
    const reason = nothingToCheck();
    if (reason) return ctx.skip(reason);
    const problems: string[] = [];
    let rungs = 0;
    for (const { game, ticker, spread } of listed) {
      const name = `${gameName(game)} (${KALSHI_SERIES.spread}-${ticker})`;
      for (const m of read(spread, `Spread markets for ${name}`)) {
        if (sideOf(m.ticker, game) === null) problems.push(`${name}: ${m.ticker} names neither team's code`);
        const strike = m.floor_strike;
        // The league's lines are on half points (or whole ones, priced from the half points either side).
        if (strike == null || !Number.isInteger(strike * 2) || Number.isInteger(strike)) {
          problems.push(`${name}: ${m.ticker} has strike ${strike}, not a half point`);
          continue;
        }
        // "Baltimore wins by over 7.5 points": the strike is the margin the team must beat.
        const over = /over (\d+(?:\.\d+)?)/.exec(m.yes_sub_title ?? "")?.[1];
        if (over !== undefined && Number(over) !== strike)
          problems.push(`${name}: ${m.ticker} has strike ${strike} but reads "${m.yes_sub_title}"`);
        rungs++;
      }
    }
    expectNone(problems, "Spread markets the app reads wrongly");
    expect(rungs, "Spread rungs across the games kicking off soon").toBeGreaterThan(0);
  });

  it("agrees with ESPN about who is favored, through liveInsights", async (ctx) => {
    const reason = nothingToCheck();
    if (reason) return ctx.skip(reason);
    const lined = listed.filter((l) => l.game.spread !== null);
    if (lined.length === 0) return ctx.skip("No ESPN line on the games kicking off soon");

    const insights = liveInsights(fetchWithRetry);
    const problems: string[] = [];
    for (const { game, winner, spread: ladder } of lined) {
      const spread = game.spread as number;
      const name = `${gameName(game)} (ESPN line ${spread})`;
      const market = await insights.getMarket(game);
      if (!market) {
        problems.push(`${name}: no market prices`);
        continue;
      }
      // A cover price is owed only where the ladder has ESPN's line: on a week's lone game it may not.
      if (!market.cover && ladderHasLine(parseKalshiBoard(winner, ladder, game), spread))
        problems.push(`${name}: Kalshi lists this line's rungs, but the app read no cover price`);
      if (Math.abs(spread) < CLEAR_FAVORITE) continue;
      const espnHome = spread < 0;
      // A home/away mix-up would flip these.
      if (market.homeWin !== null && market.homeWin > 0.5 !== espnHome)
        problems.push(`${name}: Kalshi gives the home team ${market.homeWin} to win`);
      if (market.spread !== null && market.spread !== 0 && market.spread < 0 !== espnHome)
        problems.push(`${name}: Kalshi's own line is ${market.spread}`);
    }
    expectNone(problems, "Market prices that don't fit the game");
  });
});
