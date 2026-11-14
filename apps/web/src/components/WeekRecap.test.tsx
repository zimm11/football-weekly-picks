import type { Game, WeekResults, WeekView } from "@picks/shared";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { WeekAwards } from "./WeekAwards";
import { WeekRecap } from "./WeekRecap";

// Home covers both: NYG -2.5 wins by 7, BAL -4.5 wins by 7 (total 47).
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

const entry = (
  userId: string,
  displayName: string,
  over: Partial<WeekResults["entries"][number]>,
): WeekResults["entries"][number] => ({
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
      points: 11,
      wins: 2,
      powGameId: "mon",
      powWon: true,
      tiebreakerGuess: 47,
      isWinner: true,
    }),
    entry("alex", "Alex", { points: 3, wins: 1, losses: 1, rank: 2 }),
    entry("sam", "Sam", { points: 0, losses: 2, rank: 3 }),
  ],
  picks: [
    { userId: "pat", gameId: "thu", side: "home" },
    { userId: "pat", gameId: "mon", side: "home" },
    { userId: "alex", gameId: "thu", side: "away" },
    { userId: "alex", gameId: "mon", side: "home" },
    { userId: "sam", gameId: "thu", side: "away" },
    { userId: "sam", gameId: "mon", side: "away" },
  ],
};

/** The same week, had Alex and Sam both been wrong about Monday night too. */
const twoWolfGames: WeekResults = {
  ...results,
  picks: results.picks.map((p) => (p.userId === "alex" && p.gameId === "mon" ? { ...p, side: "away" } : p)),
};

const view: WeekView = {
  id: "w10",
  leagueId: "l1",
  leagueName: "Sunday Crew",
  timeZone: "America/New_York",
  role: "member",
  year: 2026,
  number: 10,
  status: "final",
  tiebreakerGameId: "mon",
  games,
  myPicks: [],
  myTiebreakerTotal: null,
  submissions: null,
  results,
};

describe("WeekAwards", () => {
  it("hands out the Low Point Loser, perfect week, bullseye and lone wolf", async () => {
    const screen = await render(<WeekAwards games={games} results={results} tiebreakerGameId="mon" />);
    const awards = screen.getByRole("region", { name: "Week awards" }).getByRole("listitem");
    await expect.element(awards.nth(0)).toMatchTextContent(/Low Point Loser.*Sam.*0 points/);
    await expect.element(awards.nth(1)).toMatchTextContent(/Perfect week.*Pat/);
    await expect.element(awards.nth(2)).toMatchTextContent(/Bullseye.*Pat.*47/);
    await expect.element(awards.nth(3)).toMatchTextContent(/Lone wolf.*Pat.*NYG in WSH at NYG/);
    // The results screen announces the winner itself.
    await expect.element(screen.getByText("Winner", { exact: true })).not.toBeInTheDocument();
  });

  it("gives a player alone on several games one lone wolf row", async () => {
    const screen = await render(<WeekAwards games={games} results={twoWolfGames} tiebreakerGameId="mon" />);
    const wolves = screen.getByRole("listitem").filter({ hasText: "Lone wolf" });
    await expect.element(wolves).toMatchTextContent(/Pat.*Alone on the right side of 2 games/);
  });

  it("renders nothing when there is nothing to hand out", async () => {
    const level: WeekResults = {
      entries: [entry("pat", "Pat", { isWinner: true }), entry("sam", "Sam", { isWinner: true })],
      picks: [],
    };
    const screen = await render(<WeekAwards games={games} results={level} tiebreakerGameId="mon" />);
    await expect.element(screen.getByRole("region", { name: "Week awards" })).not.toBeInTheDocument();
  });
});

describe("WeekRecap", () => {
  it("tells the winner they won and leads the awards with them", async () => {
    const screen = await render(<WeekRecap view={view} userId="pat" onClose={() => {}} />);
    const recap = screen.getByRole("dialog", { name: "Week 10 is final" });
    await expect.element(recap).toMatchTextContent("You won the week");
    await expect.element(recap.getByRole("listitem").nth(0)).toMatchTextContent(/Winner.*Pat.*11 points/);
    await expect
      .element(recap.getByRole("link", { name: "See everyone's picks" }))
      .toHaveAttribute("href", "/weeks/w10");
  });

  it("breaks it to the Low Point Loser, and closes", async () => {
    const onClose = vi.fn();
    const screen = await render(<WeekRecap view={view} userId="sam" onClose={onClose} />);
    const recap = screen.getByRole("dialog", { name: "Week 10 is final" });
    await expect.element(recap).toMatchTextContent("You're this week's Low Point Loser");
    await expect.element(recap.getByLabelText("Your week")).toMatchTextContent(/3rd.*0.*0–2/);
    await recap.getByRole("button", { name: "Close" }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it("gives everyone else their finish, and a player who wasn't in the week just the awards", async () => {
    const screen = await render(<WeekRecap view={view} userId="alex" onClose={() => {}} />);
    await expect.element(screen.getByText("You finished 2nd of 3.")).toBeVisible();
    await screen.rerender(<WeekRecap view={view} userId="newcomer" onClose={() => {}} />);
    await expect.element(screen.getByText("The results are in.")).toBeVisible();
    await expect.element(screen.getByLabelText("Your week")).not.toBeInTheDocument();
  });
});
