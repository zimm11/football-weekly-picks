import { describe, expect, it } from "vitest";
import type { WeekSummary } from "./index";
import {
  currentWeek,
  estimatedWeekStart,
  nextStartWeek,
  nextWeekNumber,
  openingThursday,
  preferredSeasonYear,
  seasonYear,
  weekLabel,
  weekPhase,
  weekPickAvailability,
} from "./seasons";

const now = new Date("2026-11-15T12:00:00Z"); // Sunday, 7am Eastern.
const game = (id: string, kickoff = "2026-11-15T18:00:00Z", scored = false) => ({
  id,
  kickoff,
  homeScore: scored ? 24 : null,
  awayScore: scored ? 17 : null,
});
const week = (number: number, changes: Partial<WeekSummary> = {}): WeekSummary => ({
  id: `w${number}`,
  year: 2026,
  number,
  status: "open",
  phase: "accepting",
  gameCount: 16,
  myPickCount: 0,
  availablePickCount: 16,
  myAvailablePickCount: 16,
  myMissingPickCount: 16,
  ...changes,
});

describe("season selection", () => {
  it("uses the NFL starting year through January and February, in Eastern time", () => {
    expect(seasonYear(new Date("2027-01-10T18:00:00Z"))).toBe(2026);
    expect(seasonYear(new Date("2027-03-01T02:00:00Z"))).toBe(2026);
    expect(seasonYear(new Date("2027-03-01T12:00:00Z"))).toBe(2027);
  });

  it("does not let future or draft-only preparation replace a published season", () => {
    const seasons = [
      week(18, { year: 2025, status: "final" }),
      week(1, { status: "draft" }),
      week(1, { year: 2027, status: "draft" }),
    ];
    expect(preferredSeasonYear(seasons, now)).toBe(2025);
    expect(preferredSeasonYear([...seasons, week(2)], now)).toBe(2026);
    expect(preferredSeasonYear([week(1, { year: 2027, status: "draft" })], now)).toBe(2026);
  });

  it("opens a playoff or survivor league on this season once it has started, before any week shows", () => {
    // Last season's four rounds are final; this season was started, and its first round comes in January.
    const lastSeason = [19, 20, 21, 22].map((number) => week(number, { year: 2025, status: "final" }));
    expect(preferredSeasonYear(lastSeason, now)).toBe(2025);
    expect(preferredSeasonYear(lastSeason, now, [2026, 2025])).toBe(2026);
    // Not started yet: stay on the finished season, so "the playoffs are over" has something to show.
    expect(preferredSeasonYear(lastSeason, now, [2025])).toBe(2025);
    // A season started for next year doesn't displace anything.
    expect(preferredSeasonYear(lastSeason, now, [2027, 2025])).toBe(2025);
    expect(preferredSeasonYear([], now, [2027])).toBe(2026);
    // A brand-new league, and one whose current season has weeks already.
    expect(preferredSeasonYear([], now, [2026])).toBe(2026);
    expect(preferredSeasonYear([...lastSeason, week(11)], now, [2026, 2025])).toBe(2026);
  });

  it("keeps weekly pick'em on its latest published season, whatever is drafted", () => {
    // Weekly leagues send no started seasons, so a draft-only current season still doesn't displace last year's.
    const weeks = [week(18, { year: 2025, status: "final" }), week(1, { status: "draft" })];
    expect(preferredSeasonYear(weeks, now)).toBe(2025);
    expect(preferredSeasonYear(weeks, now, [])).toBe(2025);
    expect(preferredSeasonYear([week(1, { status: "draft" })], now, [])).toBe(2026);
  });

  it("continues the slate, offers gaps after week 18, and stops when all weeks exist", () => {
    expect(nextWeekNumber([], 18)).toBe(1);
    expect(nextWeekNumber([week(6), week(9)], 18)).toBe(10);
    const full = Array.from({ length: 18 }, (_, index) => week(index + 1));
    expect(nextWeekNumber(full, 18)).toBeNull();
    expect(
      nextWeekNumber(
        full.filter((item) => item.number !== 5),
        18,
      ),
    ).toBe(5);
  });
});

describe("week phases", () => {
  it("uses the clock and recorded scores, while preserving draft and final states", () => {
    expect(weekPhase("draft", [game("a", undefined, true)], now)).toBe("draft");
    expect(weekPhase("final", [game("a")], now)).toBe("final");
    expect(weekPhase("open", [game("a")], now)).toBe("accepting");
    expect(weekPhase("open", [game("a", now.toISOString())], now)).toBe("underway");
    expect(weekPhase("open", [game("a", undefined, true), game("b")], now)).toBe("underway");
    expect(weekPhase("open", [game("a", undefined, true)], now)).toBe("awaiting");
    expect(weekPhase("open", [], now)).not.toBe("awaiting");
  });

  it("does not assume a game has finished merely because it kicked off", () => {
    expect(weekPhase("open", [game("a", "2026-11-12T18:00:00Z")], now)).toBe("underway");
  });
});

describe("pick availability", () => {
  it("counts games that haven't kicked off or been scored, picked or not", () => {
    const games = [
      game("saved"),
      game("missing"),
      game("finished", undefined, true),
      game("past", "2026-11-12T18:00:00Z"),
    ];
    expect(weekPickAvailability(games, new Set(["saved"]), now)).toEqual({
      availablePickCount: 2,
      myAvailablePickCount: 2,
      myMissingPickCount: 1,
    });
  });

  it("prioritizes missing actionable picks over stale weeks and already completed sheets", () => {
    const stale = week(9, { availablePickCount: 0, myAvailablePickCount: 0, myMissingPickCount: 0 });
    const complete = week(10, { myPickCount: 16, myMissingPickCount: 0 });
    const upcoming = week(11);
    expect(currentWeek([stale, complete, upcoming])?.number).toBe(11);
    expect(currentWeek([stale, complete])?.number).toBe(10);
    expect(currentWeek([stale])?.number).toBe(9);
    expect(currentWeek([week(12, { status: "draft" }), week(8, { status: "final" })])).toBeUndefined();
  });
});

describe("weekLabel", () => {
  it("names regular-season weeks by number and the postseason rounds by name", () => {
    expect(weekLabel(1)).toBe("Week 1");
    expect(weekLabel(18)).toBe("Week 18");
    expect([19, 20, 21, 22].map(weekLabel)).toEqual(["Wild Card", "Divisional", "Conference", "Super Bowl"]);
  });
});

describe("the season calendar", () => {
  it("starts Week 1 on the Thursday after Labor Day", () => {
    expect(openingThursday(2026)).toBe(10);
    expect(openingThursday(2025)).toBe(4);
    expect(estimatedWeekStart(2026, 1).toISOString()).toBe("2026-09-10T23:00:00.000Z");
    expect(estimatedWeekStart(2025, 1).toISOString()).toBe("2025-09-04T23:00:00.000Z");
    expect(estimatedWeekStart(2026, 11).toISOString()).toBe("2026-11-19T23:00:00.000Z");
  });

  it("starts Thanksgiving's week at noon Eastern, when its games do", () => {
    // Thursday, Nov 26 2026 is Thanksgiving: the first game is in the early afternoon.
    expect(estimatedWeekStart(2026, 12).toISOString()).toBe("2026-11-26T17:00:00.000Z");
    expect(nextStartWeek(2026, new Date("2026-11-26T16:00:00Z"))).toBe(12);
    expect(nextStartWeek(2026, new Date("2026-11-26T18:00:00Z"))).toBe(13);
    // 2025's is Nov 27, Week 13.
    expect(estimatedWeekStart(2025, 13).toISOString()).toBe("2025-11-27T17:00:00.000Z");
  });

  it("finds the next week with no kickoff yet", () => {
    expect(nextStartWeek(2026, new Date("2026-07-01T00:00:00Z"))).toBe(1);
    // Monday night of Week 10: Week 11 is next.
    expect(nextStartWeek(2026, new Date("2026-11-17T01:00:00Z"))).toBe(11);
    expect(nextStartWeek(2026, new Date("2027-01-10T00:00:00Z"))).toBeNull();
  });
});
