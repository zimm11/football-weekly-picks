import type { Game, GameInsights, TeamInsights } from "@picks/shared";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MatchupSheet } from "./MatchupSheet";

const game: Game = {
  id: "sun",
  awayTeam: "NE",
  homeTeam: "DET",
  kickoff: "2026-11-15T18:00:00Z",
  spread: -3.5,
  points: 1,
  homeScore: null,
  awayScore: null,
};

const team = (over: Partial<TeamInsights> = {}): TeamInsights => ({
  record: "5-4",
  venueRecord: "3-1",
  lastFive: [],
  injuries: [],
  leaders: [],
  news: [],
  ...over,
});

const insights: GameInsights = {
  market: { source: "Kalshi", homeWin: 0.575, cover: { home: 0.425, away: 0.575 }, spread: -2.5 },
  matchup: {
    home: team({
      record: "6-3",
      lastFive: [{ opponent: "MIA", home: false, result: "W", score: "27-20" }],
      injuries: [{ name: "Jared Goff", position: "QB", status: "Questionable", injury: "Ankle" }],
      news: [
        {
          headline: "Lions get healthy for the stretch",
          url: "https://www.espn.com/nfl/story/_/id/1/lions",
          published: "2026-11-13T22:48:46Z",
        },
      ],
    }),
    away: team(),
    stats: [{ label: "Points Per Game", home: "28.4", away: "21.0" }],
    overUnder: 50.5,
    url: "https://www.espn.com/nfl/game/_/gameId/401",
  },
};

const open = (load: (gameId: string) => Promise<GameInsights>, shown: Game | null = game) =>
  render(<MatchupSheet game={shown} timeZone="America/New_York" load={load} onClose={() => {}} />);

describe("MatchupSheet", () => {
  it("stays closed, and loads nothing, until a game is chosen", async () => {
    const load = vi.fn().mockResolvedValue(insights);
    const screen = await open(load, null);
    expect(load).not.toHaveBeenCalled();
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the market's view of the game against the league's line", async () => {
    const load = vi.fn().mockResolvedValue(insights);
    const screen = await open(load);
    expect(load).toHaveBeenCalledWith("sun");
    await expect.element(screen.getByRole("heading", { name: "Patriots at Lions" })).toBeVisible();
    // The bar has no height without the app's stylesheet, so check that it is there rather than seen.
    await expect
      .element(screen.getByRole("img", { name: "Chance to win: Patriots 43%, Lions 57%" }))
      .toBeInTheDocument();

    const market = screen.getByRole("region", { name: "Prediction market" });
    await expect.element(market.getByText("Lions -3.5 covers")).toBeVisible();
    await expect.element(market.getByText("Patriots +3.5 covers")).toBeVisible();
    await expect.element(market.getByText("Lions -2.5", { exact: true })).toBeVisible();
    // The league gives a point more than the market does, which favors the side getting the points.
    await expect
      .element(market.getByText("Patriots get 1 point more here than at the market's line."))
      .toBeVisible();
    await expect.element(market.getByText("Push")).not.toBeInTheDocument();
  });

  it("shows a push chance on a whole-number line", async () => {
    const pushy: GameInsights = {
      matchup: null,
      market: { source: "Kalshi", homeWin: 0.575, cover: { home: 0.425, away: 0.475 }, spread: -3 },
    };
    const screen = await open(async () => pushy, { ...game, spread: -3 });
    const market = screen.getByRole("region", { name: "Prediction market" });
    await expect.element(market.getByText("Push")).toBeVisible();
    await expect.element(market.getByText("10%")).toBeVisible();
    await expect.element(market.getByText(/more here than/)).not.toBeInTheDocument();
  });

  it("sets the teams' form, injuries and headlines side by side", async () => {
    const screen = await open(async () => insights);
    const stats = screen.getByRole("region", { name: "Team stats" });
    await expect.element(stats.getByText("6-3")).toBeVisible();
    await expect.element(stats.getByText("28.4")).toBeVisible();
    await expect.element(stats.getByText("50.5 points")).toBeVisible();
    // Further down the sheet than the test viewport reaches, so these check presence rather than visibility.
    const lastFive = screen.getByRole("region", { name: "Last five games" });
    await expect.element(lastFive.getByText("at MIA")).toBeInTheDocument();
    const injuries = screen.getByRole("region", { name: "Injuries" });
    await expect.element(injuries.getByText("Jared Goff")).toBeInTheDocument();
    // The team with nothing to report still gets its column.
    await expect.element(injuries.getByText("None listed.")).toBeInTheDocument();

    const story = screen.getByRole("link", { name: /Lions get healthy for the stretch/ });
    await expect.element(story).toHaveAttribute("href", "https://www.espn.com/nfl/story/_/id/1/lions");
    await expect.element(story).toHaveAttribute("target", "_blank");
    await expect.element(screen.getByRole("link", { name: "Full game page on ESPN" })).toBeInTheDocument();
  });

  it("says so when there is nothing to show, or the request fails", async () => {
    const empty = await open(async () => ({ matchup: null, market: null }));
    await expect.element(empty.getByText("No stats are available for this game right now.")).toBeVisible();
    await empty.unmount();

    const failed = await open(async () => {
      throw new Error("Week not found");
    });
    await expect.element(failed.getByRole("alert")).toHaveTextContent("Week not found");
  });
});
