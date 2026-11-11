import type { Game, WeekResults } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { StandingsTable } from "./StandingsTable";
import { WeekResultsTable } from "./WeekResultsTable";

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
    spread: -4.5,
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
    entry("pat", "Pat", { points: 11, wins: 2, powGameId: "mon", tiebreakerGuess: 50, isWinner: true }),
    entry("sam", "Sam", { points: 0, wins: 0, losses: 1, rank: 2 }),
  ],
  picks: [
    { userId: "pat", gameId: "thu", side: "home" },
    { userId: "pat", gameId: "mon", side: "home" },
    { userId: "sam", gameId: "thu", side: "away" },
  ],
};

describe("WeekResultsTable", () => {
  it("names the winner and shows every player's picks", async () => {
    const screen = await render(<WeekResultsTable games={games} results={results} tiebreakerGameId="mon" />);
    await expect.element(screen.getByText("Winner: Pat")).toBeVisible();

    const cells = (row: number) => screen.getByRole("row").nth(row).getByRole("cell");
    // Rank, player, points, W–L, tiebreaker guess, then one cell per game.
    for (const [i, text] of ["1", "Pat", "11", "2–0", "50", "NYG", "BAL POW"].entries()) {
      await expect.element(cells(1).nth(i)).toHaveTextContent(text);
    }
    // Sam made no tiebreaker guess and no Monday pick.
    for (const [i, text] of ["2", "Sam", "0", "0–1", "—", "WSH", "—"].entries()) {
      await expect.element(cells(2).nth(i)).toHaveTextContent(text);
    }
  });

  it("shows the actual tiebreaker total", async () => {
    const screen = await render(<WeekResultsTable games={games} results={results} tiebreakerGameId="mon" />);
    await expect.element(screen.getByText("Tiebreaker (47)")).toBeVisible();
  });
});

const rec = { wins: 0, losses: 0, pushes: 0 };

describe("StandingsTable", () => {
  it("lists players in rank order with their tiebreaker stats", async () => {
    const base = {
      losses: 0,
      pushes: 0,
      mondayWins: 0,
      sundayNightWins: 0,
      weeksWon: 0,
      removed: false,
      powLosses: 1,
      powPushes: 0,
      splits: { favorite: rec, underdog: rec, home: rec, away: rec },
      rankChange: null,
    };
    const screen = await render(
      <StandingsTable
        entries={[
          {
            ...base,
            userId: "pat",
            displayName: "Pat",
            points: 42,
            wins: 20,
            powWins: 3,
            weeksWon: 2,
            rank: 1,
            rankChange: 1,
            weekly: [
              { points: 30, rank: 1, isWinner: true },
              { points: 12, rank: 2, isWinner: false },
            ],
          },
          {
            ...base,
            userId: "sam",
            displayName: "Sam",
            points: 30,
            wins: 18,
            powWins: 1,
            losses: 4,
            rank: 2,
            rankChange: -1,
            weekly: [null, { points: 30, rank: 1, isWinner: true }],
          },
        ]}
      />,
    );
    const cells = (row: number) => screen.getByRole("row").nth(row).getByRole("cell");
    // Rank (with movement), player, points, POW record, W–L, win %, average points.
    for (const [i, text] of ["1", "Pat", "42", "3–1", "20–0", "100%", "21"].entries()) {
      await expect.element(cells(1).nth(i)).toMatchTextContent(text);
    }
    await expect.element(cells(1).nth(0)).toMatchTextContent("up 1 since last week");
    // Sam missed a week, so the average is over the one week played.
    for (const [i, text] of ["2", "Sam", "30", "1–1", "18–4", "82%", "30"].entries()) {
      await expect.element(cells(2).nth(i)).toMatchTextContent(text);
    }
  });
});
