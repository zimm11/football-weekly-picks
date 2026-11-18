import { describe, expect, it } from "vitest";
import {
  draftCards,
  noWeekOpen,
  playoffRoundSteps,
  recapTitle,
  sentenceCase,
  sharedName,
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
