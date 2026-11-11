import type { Game, Standings, WeekResults } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { PickSplitsTable, WeekByWeekTable, YourSeason } from "./SeasonDashboard";
import { GameBreakdown, WeekSummary } from "./WeekSummary";

const rec = (wins: number, losses: number, pushes = 0) => ({ wins, losses, pushes });

const player = (userId: string, displayName: string, over: Partial<Standings["entries"][number]>) => ({
  userId,
  displayName,
  removed: false,
  points: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  powWins: 0,
  powLosses: 0,
  powPushes: 0,
  mondayWins: 0,
  sundayNightWins: 0,
  weeksWon: 0,
  rank: 1,
  rankChange: null,
  weekly: [],
  splits: { favorite: rec(0, 0), underdog: rec(0, 0), home: rec(0, 0), away: rec(0, 0) },
  ...over,
});

const standings: Standings = {
  years: [2026],
  year: 2026,
  weeks: [
    { id: "w1", number: 1, winners: ["Pat"], topPoints: 14, averagePoints: 10 },
    { id: "w2", number: 2, winners: ["Sam"], topPoints: 12, averagePoints: 8.5 },
  ],
  entries: [
    player("pat", "Pat", {
      points: 20,
      wins: 9,
      losses: 3,
      powWins: 1,
      powLosses: 1,
      weeksWon: 1,
      rank: 1,
      rankChange: 0,
      weekly: [
        { points: 14, rank: 1, isWinner: true },
        { points: 6, rank: 2, isWinner: false },
      ],
      splits: { favorite: rec(6, 2), underdog: rec(3, 1), home: rec(5, 1), away: rec(4, 2) },
    }),
    player("sam", "Sam", {
      points: 12,
      wins: 6,
      losses: 2,
      powWins: 1,
      weeksWon: 1,
      rank: 2,
      weekly: [null, { points: 12, rank: 1, isWinner: true }],
    }),
  ],
};

describe("YourSeason", () => {
  it("sums up the player's season against the leader", async () => {
    const screen = await render(<YourSeason standings={standings} currentUserId="sam" />);
    const stats = screen.getByRole("region", { name: "Your season stats" });
    await expect.element(stats).toMatchTextContent("Rank2nd8 pts behind Pat");
    await expect.element(stats).toMatchTextContent("Points1212 a week");
    await expect.element(stats).toMatchTextContent("Record6–275% against the spread");
    await expect.element(stats).toMatchTextContent("Best week12Week 2 · 1st");
    // The chart reads out each week for screen readers; Sam missed week 1.
    const chart = screen.getByRole("list", { name: "Your points by week" });
    await expect.element(chart).toMatchTextContent("Week 1: Didn't play · league average 10 · top 14");
    await expect.element(chart).toMatchTextContent("Week 2: 12 pts, 1st (won the week)");
  });

  it("says when the player leads", async () => {
    const screen = await render(<YourSeason standings={standings} currentUserId="pat" />);
    await expect.element(screen.getByText("Leading the league")).toBeVisible();
  });
});

describe("WeekByWeekTable", () => {
  it("shows each player's points per week and marks the winner", async () => {
    const screen = await render(<WeekByWeekTable standings={standings} />);
    const row = (name: string) => screen.getByRole("row", { name: new RegExp(name) });
    await expect.element(row("Pat")).toMatchTextContent("14 (won the week)620");
    await expect.element(row("Sam")).toMatchTextContent("—12 (won the week)12");
    await expect.element(row("Avg")).toMatchTextContent("108.5");
  });
});

describe("PickSplitsTable", () => {
  it("shows records and win rates", async () => {
    const screen = await render(<PickSplitsTable entries={standings.entries} />);
    await expect
      .element(screen.getByRole("row", { name: /Pat/ }))
      .toMatchTextContent("6–275%3–175%5–183%4–267%");
    await expect.element(screen.getByRole("row", { name: /Sam/ })).toMatchTextContent("Sam————");
  });
});

const games: Game[] = [
  {
    id: "thu",
    awayTeam: "WSH",
    homeTeam: "NYG",
    kickoff: "2026-11-13T01:15:00Z",
    spread: -2.5,
    points: 3,
    homeScore: 24,
    awayScore: 17,
  },
  {
    id: "mon",
    awayTeam: "LAC",
    homeTeam: "BAL",
    kickoff: "2026-11-17T01:15:00Z",
    spread: -7,
    points: 3,
    homeScore: 27,
    awayScore: 20,
  },
];

const entry = (userId: string, displayName: string, over: Partial<WeekResults["entries"][number]>) => ({
  userId,
  displayName,
  points: 0,
  wins: 0,
  losses: 0,
  pushes: 0,
  powGameId: null,
  powWon: false,
  mondayWins: 0,
  sundayNightWins: 0,
  tiebreakerGuess: null,
  rank: 1,
  isWinner: false,
  removed: false,
  ...over,
});

const results: WeekResults = {
  entries: [
    entry("pat", "Pat", {
      points: 8,
      wins: 1,
      pushes: 1,
      powGameId: "thu",
      powWon: true,
      tiebreakerGuess: 50,
      isWinner: true,
    }),
    entry("sam", "Sam", { points: 0, losses: 1, pushes: 1, powGameId: "mon", rank: 2 }),
  ],
  picks: [
    { userId: "pat", gameId: "thu", side: "home" },
    { userId: "pat", gameId: "mon", side: "home" },
    { userId: "sam", gameId: "thu", side: "away" },
    { userId: "sam", gameId: "mon", side: "away" },
  ],
};

describe("WeekSummary", () => {
  it("shows the player's finish beside the league's numbers", async () => {
    const screen = await render(
      <WeekSummary games={games} results={results} tiebreakerGameId="mon" currentUserId="sam" />,
    );
    const stats = screen.getByRole("region", { name: "Week summary" });
    await expect.element(stats).toMatchTextContent("Your finish2ndof 2 players");
    await expect.element(stats).toMatchTextContent("Your POWPushLAC at BAL");
    await expect.element(stats).toMatchTextContent("Winning score8");
    await expect.element(stats).toMatchTextContent("League average41 of 2 POWs hit");
    await expect.element(stats).toMatchTextContent("Tiebreaker total47");
  });
});

describe("GameBreakdown", () => {
  it("shows who covered and how the league split", async () => {
    const screen = await render(<GameBreakdown games={games} results={results} />);
    const card = (name: string) => screen.getByRole("listitem", { name });
    await expect.element(card("WSH at NYG")).toMatchTextContent("NYG covered");
    await expect.element(card("WSH at NYG")).toMatchTextContent("1 of 2 got it right");
    // BAL -7 wins by 7: a push.
    await expect.element(card("LAC at BAL")).toMatchTextContent("Push");
    await expect.element(card("LAC at BAL")).toMatchTextContent("Nobody scored");
  });
});
