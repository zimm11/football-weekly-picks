import type { Game } from "@picks/shared";
import { describe, expect, it } from "vitest";
import {
  breakdownLine,
  draftCards,
  inProgressWeeks,
  noWeekOpen,
  playoffRoundSteps,
  provisionalPowValue,
  recapTitle,
  resultGuess,
  resultPickCell,
  resultsTileLabels,
  revealedGames,
  sentenceCase,
  sharedName,
  sharesResultsSoFar,
  standingLine,
  statColumns,
  tileRows,
  weeklyRecapHeadline,
} from "./resultsPresentation";

describe("stat tile rows", () => {
  it("puts three across under 1024px and six from 1024, never two", () => {
    expect(statColumns(320)).toBe(3);
    expect(statColumns(390)).toBe(3);
    expect(statColumns(768)).toBe(3);
    expect(statColumns(1023)).toBe(3);
    expect(statColumns(1024)).toBe(6);
  });
  it("pads a short last row so its tiles keep the others' width", () => {
    expect(tileRows([1, 2, 3, 4, 5], 3)).toEqual([
      { items: [1, 2, 3], pad: 0 },
      { items: [4, 5], pad: 1 },
    ]);
    expect(tileRows([1, 2, 3, 4, 5], 6)).toEqual([{ items: [1, 2, 3, 4, 5], pad: 1 }]);
    expect(tileRows([], 3)).toEqual([]);
  });
});

describe("sharedName", () => {
  it("names one, counts several, and is empty with nobody", () => {
    expect(sharedName(["Sam"])).toBe("Sam");
    expect(sharedName(["Sam", "Pat"])).toBe("Shared by 2");
    expect(sharedName([])).toBeUndefined();
  });
});

describe("standingLine", () => {
  const sam = { userId: "s", rank: 1, points: 36, displayName: "Sam" };
  const pat = { userId: "p", rank: 2, points: 34, displayName: "Pat" };
  const entries = [
    sam,
    pat,
    { userId: "c", rank: 3, points: 31, displayName: "Commish" },
    { userId: "a", rank: 4, points: 35 - 8, displayName: "Alex" },
  ];
  it("says the place and the gap to the leader", () => {
    expect(standingLine(entries, "c")).toBe("3rd of 4 · 5 pts behind Sam");
    expect(standingLine(entries, "a")).toBe("4th of 4 · 9 pts behind Sam");
    expect(standingLine([sam, { ...pat, points: 35 }], "p")).toBe("2nd of 2 · 1 pt behind Sam");
  });
  it("says when the player leads, or is level on points but behind on a tiebreaker", () => {
    expect(standingLine(entries, "s")).toBe("1st of 4 · Leading the league");
    expect(standingLine([sam, { ...pat, points: 36 }], "p")).toBe("2nd of 2 · Level on points with Sam");
  });
  it("is null for a player who isn't in the standings", () => {
    expect(standingLine(entries, "x")).toBeNull();
  });
});

describe("playoffRoundSteps", () => {
  const states = (weeks: Parameters<typeof playoffRoundSteps>[0]) =>
    playoffRoundSteps(weeks).map((step) => `${step.label}: ${step.state}`);
  it("marks the first round next before any is listed", () => {
    expect(states([])).toEqual([
      "Wild Card: next",
      "Divisional: later",
      "Conference: later",
      "Super Bowl: later",
    ]);
  });
  it("marks final rounds, then the next one", () => {
    expect(
      states([
        { number: 19, status: "final" },
        { number: 20, status: "draft" },
      ]),
    ).toEqual(["Wild Card: final", "Divisional: next", "Conference: later", "Super Bowl: later"]);
  });
  it("marks an open round open, with nothing next while it is", () => {
    expect(
      states([
        { number: 19, status: "final" },
        { number: 20, status: "open" },
      ]),
    ).toEqual(["Wild Card: final", "Divisional: open", "Conference: later", "Super Bowl: later"]);
  });
  it("marks every round final once the playoffs are over", () => {
    expect(states([19, 20, 21, 22].map((number) => ({ number, status: "final" as const })))).toEqual([
      "Wild Card: final",
      "Divisional: final",
      "Conference: final",
      "Super Bowl: final",
    ]);
  });
});

describe("recapTitle", () => {
  it("names the week, with its year only when it isn't the season on screen", () => {
    expect(recapTitle(9, 2026, 2026)).toBe("Week 9 is final");
    expect(recapTitle(22, 2025, 2026)).toBe("2025 Super Bowl is final");
    expect(recapTitle(1, 2026)).toBe("Week 1 is final");
  });
});

describe("weeklyRecapHeadline", () => {
  const base = { rank: 2, playerCount: 4, isWinner: false, winnerCount: 1, lowPointLoser: false };
  it("cheers a win, shared or not, with the trophy", () => {
    expect(weeklyRecapHeadline({ ...base, rank: 1, isWinner: true })).toEqual({
      text: "You won the week. Take a bow.",
      mood: "won",
    });
    expect(weeklyRecapHeadline({ ...base, rank: 1, isWinner: true, winnerCount: 2 }).text).toBe(
      "You shared the win. Half a trophy is still a trophy.",
    );
  });
  it("names the Low Point Loser, else the finish", () => {
    expect(weeklyRecapHeadline({ ...base, rank: 4, lowPointLoser: true })).toEqual({
      text: "You're this week's Low Point Loser. Somebody had to be.",
      mood: "lpl",
    });
    expect(weeklyRecapHeadline(base)).toEqual({ text: "You finished 2nd of 4.", mood: null });
    expect(weeklyRecapHeadline({ ...base, rank: undefined }).text).toBe("The results are in.");
  });
});

describe("sentenceCase", () => {
  it("lowercases the feed's Title Case after the first word, keeping abbreviations", () => {
    expect(sentenceCase("Total Yards")).toBe("Total yards");
    expect(sentenceCase("Yards Per Play")).toBe("Yards per play");
    expect(sentenceCase("3rd Down Efficiency")).toBe("3rd down efficiency");
    expect(sentenceCase("Passing TDs")).toBe("Passing TDs");
    expect(sentenceCase("Record")).toBe("Record");
  });
});

describe("the Picks tab between weeks", () => {
  const league = (
    management: "manual" | "auto",
    weeks: { number: number; status: "draft" | "open" | "final"; gameCount: number }[],
    admin = true,
  ) => ({
    type: "weekly" as const,
    management,
    admin,
    weeks: weeks.map((w) => ({ ...w, id: `w${w.number}` })),
  });
  const final8 = { number: 8, status: "final" as const, gameCount: 14 };

  it("gives a Hands-on empty draft a card to set it up", () => {
    const l = league("manual", [final8, { number: 9, status: "draft", gameCount: 0 }]);
    expect(draftCards(l)).toEqual([
      {
        weekId: "w9",
        title: "Week 9 is a draft",
        detail: "Players can't see it yet. Add its games, then open it for picks.",
        action: "Set up Week 9",
      },
    ]);
    expect(noWeekOpen(l).action).toBeNull();
  });
  it("gives a Hands-on draft with games a card to review and open it", () => {
    expect(draftCards(league("manual", [{ number: 9, status: "draft", gameCount: 13 }]))).toEqual([
      {
        weekId: "w9",
        title: "Week 9 is ready to review",
        detail: "It's a draft, so players can't see it yet.",
        action: "Review and open Week 9",
      },
    ]);
  });
  it("gives an Automatic empty draft no card: No week is open says when it opens, with no button", () => {
    const l = league("auto", [{ number: 3, status: "draft", gameCount: 0 }]);
    expect(draftCards(l)).toEqual([]);
    expect(noWeekOpen(l)).toEqual({
      title: "No week is open",
      detail: "Week 3 opens by itself on Tuesday at 9 AM Eastern, with that morning's lines.",
      action: null,
    });
  });
  it("gives an Automatic draft with games a card to review it", () => {
    expect(draftCards(league("auto", [final8, { number: 9, status: "draft", gameCount: 13 }]))).toEqual([
      {
        weekId: "w9",
        title: "Week 9 is ready to review",
        detail:
          "It's a draft, so players can't see it yet. It opens by itself on Tuesday at 9 AM Eastern, or as soon as every game has a line after that.",
        action: "Review Week 9",
      },
    ]);
  });
  it("with no draft, offers Set up a week, or Start season before an Automatic season has begun", () => {
    expect(draftCards(league("manual", [final8]))).toEqual([]);
    expect(noWeekOpen(league("manual", [final8]))).toEqual({
      title: "No week is open",
      detail: "Set up a week and open it, and the pick sheet shows up here for everyone.",
      action: "Set up a week",
    });
    expect(noWeekOpen(league("manual", [])).action).toBe("Set up a week");
    expect(noWeekOpen(league("auto", [final8]))).toEqual({
      title: "No week is open",
      detail: "The next week opens by itself on Tuesday at 9 AM Eastern, with that morning's lines.",
      action: "Set up a week",
    });
    expect(noWeekOpen(league("auto", []))).toEqual({
      title: "No week is open",
      detail: "Start the season on the League tab, and each week opens by itself.",
      action: "Start season",
    });
  });
  it("shows a player no draft card and no button, only when the next week opens", () => {
    for (const management of ["manual", "auto"] as const) {
      const l = league(management, [final8, { number: 9, status: "draft", gameCount: 13 }], false);
      expect(draftCards(l)).toEqual([]);
      expect(noWeekOpen(l).action).toBeNull();
    }
    expect(noWeekOpen(league("manual", [final8], false)).detail).toBe(
      "The pick sheet shows up here as soon as the commissioner opens the next week.",
    );
    expect(noWeekOpen(league("auto", [], false)).detail).toBe(
      "Weeks open by themselves on Tuesday at 9 AM Eastern, with that morning's lines.",
    );
  });
});

describe("results so far", () => {
  const kickoff = "2026-11-15T18:00:00.000Z";
  const game = (over: Partial<Game> = {}): Game => ({
    id: "g1",
    homeTeam: "KC",
    awayTeam: "BUF",
    kickoff,
    spread: -3.5,
    points: 1,
    homeScore: null,
    awayScore: null,
    ...over,
  });

  it("lists the open weeks once a game is under way, latest first, and nothing for someone who doesn't see them", () => {
    const weeks = [
      { id: "a", number: 9, status: "final" as const, phase: "final" as const },
      { id: "b", number: 10, status: "open" as const, phase: "underway" as const },
      { id: "c", number: 12, status: "open" as const, phase: "accepting" as const },
      { id: "d", number: 11, status: "open" as const, phase: "awaiting" as const },
      { id: "e", number: 13, status: "draft" as const, phase: "draft" as const },
    ];
    expect(inProgressWeeks(weeks, true).map((w) => w.id)).toEqual(["d", "b"]);
    expect(inProgressWeeks(weeks, false)).toEqual([]);
    expect(inProgressWeeks([], true)).toEqual([]);
  });

  it("follows the server's word on who sees the results so far", () => {
    expect(sharesResultsSoFar({ resultsSoFarFor: "everyone" })).toBe(true);
    expect(sharesResultsSoFar({ resultsSoFarFor: "admins" })).toBe(false);
    // An older server says nothing: commissioners only, whatever the league's management.
    expect(sharesResultsSoFar({})).toBe(false);
  });

  it("words the tiles as an outcome only once the week is final", () => {
    expect(resultsTileLabels({ provisional: false, playoff: false })).toEqual({
      place: "Your finish",
      top: "Winning score",
    });
    expect(resultsTileLabels({ provisional: false, playoff: true }).top).toBe("Top score");
    expect(resultsTileLabels({ provisional: true, playoff: false })).toEqual({
      place: "Your place",
      top: "Top score so far",
    });
    expect(resultsTileLabels({ provisional: true, playoff: true }).top).toBe("Top score so far");
  });

  it("names a final week's cell as it always has", () => {
    const won = game({ homeScore: 27, awayScore: 20 });
    expect(resultPickCell(won, { side: "home" }, { pow: true })).toEqual({
      outcome: "won",
      team: "KC",
      earned: 6,
      label: "BUF at KC, KC -3.5, POW, won, 6 points. Final 20 to 27.",
    });
    expect(resultPickCell(won, { side: "away" }, { pow: false }).label).toBe(
      "BUF at KC, BUF +3.5, lost, 0 points. Final 20 to 27.",
    );
    expect(resultPickCell(won, undefined, { pow: false })).toEqual({
      outcome: "none",
      team: null,
      earned: null,
      label: "BUF at KC, No pick, no pick. Final 20 to 27.",
    });
  });

  it("holds back a game the server didn't reveal, and shows no pick only on one it did", () => {
    expect(resultPickCell(game(), undefined, { pow: false, provisional: true, revealed: false })).toEqual({
      outcome: "hidden",
      team: null,
      earned: null,
      label: "BUF at KC, hidden until kickoff.",
    });
    expect(resultPickCell(game(), undefined, { pow: false, provisional: true, revealed: true }).outcome).toBe(
      "none",
    );
    // A final week never holds a cell back.
    expect(resultPickCell(game(), undefined, { pow: false, revealed: false }).outcome).toBe("none");
  });

  it("shows a revealed pick, pending until its game has a result", () => {
    const cell = resultPickCell(game(), { side: "home" }, { pow: true, provisional: true, revealed: true });
    expect(cell.outcome).toBe("pending");
    expect(cell.label).toBe("BUF at KC, KC -3.5, POW, pending. Not final yet.");
    expect(
      resultPickCell(
        game({ homeScore: 24, awayScore: 21 }),
        { side: "away" },
        {
          pow: false,
          provisional: true,
          revealed: true,
        },
      ).label,
    ).toBe("BUF at KC, BUF +3.5, won, 1 points. Final 21 to 24.");
  });

  it("says a guess shows at kickoff only while the tiebreaker game hasn't locked", () => {
    expect(resultGuess(45)).toBe("45");
    expect(resultGuess(null)).toBe("—");
    expect(resultGuess(null, { provisional: true, tiebreakerLocked: false })).toBe("Shows at kickoff");
    expect(resultGuess(null, { provisional: true, tiebreakerLocked: true })).toBe("—");
    expect(resultGuess(38, { provisional: true, tiebreakerLocked: false })).toBe("38");
  });

  it("says a game's result is pending so far, rather than that nobody got it right", () => {
    expect(breakdownLine({ covered: "home", right: 2, players: 4 })).toBe("2 of 4 got it right");
    expect(breakdownLine({ covered: "push", right: 0, players: 4 })).toBe("Nobody scored");
    expect(breakdownLine({ covered: null, right: 0, players: 4 })).toBe("0 of 4 got it right");
    expect(breakdownLine({ covered: null, right: 0, players: 4, provisional: true })).toBe("Result pending");
    expect(breakdownLine({ covered: "away", right: 1, players: 4, provisional: true })).toBe(
      "1 of 4 got it right",
    );
  });

  it("goes game by game over the games the server revealed only, so far", () => {
    const early = game({ id: "early", kickoff: "2026-11-15T13:00:00.000Z" });
    const late = game({ id: "late", kickoff: "2026-11-16T01:00:00.000Z" });
    const games = [early, game(), late];
    expect(
      revealedGames(games, { provisional: true, lockedGameIds: ["g1", "early"] }).map((g) => g.id),
    ).toEqual(["early", "g1"]);
    expect(revealedGames(games, { provisional: true, lockedGameIds: [] })).toEqual([]);
    expect(revealedGames(games, { provisional: true })).toEqual([]);
    expect(revealedGames(games, { provisional: false })).toEqual(games);
  });

  it("puts the commissioner's own POW as it stands", () => {
    expect(provisionalPowValue(undefined, false)).toBe("None");
    expect(provisionalPowValue(game(), false)).toBe("To play");
    expect(provisionalPowValue(game({ homeScore: 27, awayScore: 20 }), true)).toBe("Won");
    expect(provisionalPowValue(game({ homeScore: 27, awayScore: 20 }), false)).toBe("Lost");
    expect(provisionalPowValue(game({ homeScore: 23, awayScore: 20, spread: -3 }), false)).toBe("Push");
  });
});
