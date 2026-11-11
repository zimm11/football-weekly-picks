import { describe, expect, it } from "vitest";
import type { WeekSummary } from "./index";
import {
  currentWeek,
  nextWeekNumber,
  preferredSeasonYear,
  seasonYear,
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
  it("distinguishes late missing picks, frozen saved picks, and early recorded results", () => {
    const games = [
      game("saved"),
      game("missing"),
      game("finished", undefined, true),
      game("past", "2026-11-12T18:00:00Z"),
    ];
    expect(weekPickAvailability(games, new Set(["saved"]), "America/New_York", now)).toEqual({
      availablePickCount: 2,
      myAvailablePickCount: 1,
      myMissingPickCount: 1,
    });
    // At the same instant it is only 4am Pacific, so the saved pick is still editable.
    expect(
      weekPickAvailability(games, new Set(["saved"]), "America/Los_Angeles", now).myAvailablePickCount,
    ).toBe(2);
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
