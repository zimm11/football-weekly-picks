import { describe, expect, it } from "vitest";
import { gameChanges, parseLeagueKickoff } from "./leagueLogic";

describe("native admin kickoff entry", () => {
  it("interprets kickoff in the league time zone instead of the phone time zone", () => {
    expect(parseLeagueKickoff("2026-11-16 20:15", "America/New_York")?.toISOString()).toBe(
      "2026-11-17T01:15:00.000Z",
    );
    expect(parseLeagueKickoff("2026-11-16T20:15", "America/Los_Angeles")?.toISOString()).toBe(
      "2026-11-17T04:15:00.000Z",
    );
  });
  it("refuses invalid dates rather than silently rolling them into another day", () => {
    for (const value of [
      "2026-02-30 13:00",
      "2026-00-10 13:00",
      "2026-11-16 25:00",
      "2026-11-16 13:60",
      "not a date",
    ]) {
      expect(parseLeagueKickoff(value, "America/New_York")).toBeNull();
    }
  });
  it("refuses a nonexistent time during the daylight saving transition", () => {
    expect(parseLeagueKickoff("2026-03-08 02:30", "America/New_York")).toBeNull();
  });
  it("handles UTC league times and leap days", () => {
    expect(parseLeagueKickoff("2028-02-29 23:59", "UTC")?.toISOString()).toBe("2028-02-29T23:59:00.000Z");
  });
});

describe("native admin batch edits", () => {
  const game = {
    id: "game",
    awayTeam: "BUF",
    homeTeam: "NYJ",
    kickoff: "2026-11-17T01:15:00.000Z",
    spread: -3.5,
    points: 3,
    homeScore: null,
    awayScore: null,
  };
  const fields = { spread: "-3.5", points: "3", kickoff: "2026-11-16 20:15", homeScore: "", awayScore: "" };
  it("keeps an untouched row out of the batch, including equivalent numeric text", () => {
    expect(gameChanges(game, fields, "America/New_York", "open")).toEqual({ changes: {} });
    expect(gameChanges(game, { ...fields, points: "03" }, "America/New_York", "open")).toEqual({
      changes: {},
    });
  });
  it("requires paired final scores and keeps invalid rows unsendable", () => {
    expect(gameChanges(game, { ...fields, homeScore: "20" }, "America/New_York", "open").problem).toContain(
      "both scores",
    );
    expect(gameChanges(game, { ...fields, spread: "-3.2" }, "America/New_York", "open").problem).toContain(
      "half-point",
    );
  });
  it("sends both scores when clearing a previously entered result", () => {
    expect(
      gameChanges({ ...game, homeScore: 20, awayScore: 17 }, fields, "America/New_York", "open"),
    ).toEqual({ changes: { homeScore: null, awayScore: null } });
  });
  it("converts a changed kickoff without overriding the API's default point recalculation", () => {
    expect(
      gameChanges(game, { ...fields, kickoff: "2026-11-17 20:15" }, "America/New_York", "draft"),
    ).toEqual({ changes: { kickoff: "2026-11-18T01:15:00.000Z" } });
  });
});
