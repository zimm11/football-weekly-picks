import { describe, expect, it } from "vitest";
import { createGameSchema, createLeagueSchema, createWeekSchema, formatLine, lineFor } from "./index";

describe("request schemas", () => {
  it("trims the league name and defaults the time zone to Eastern", () => {
    expect(createLeagueSchema.parse({ name: "  Sunday Crew  " })).toEqual({
      name: "Sunday Crew",
      timeZone: "America/New_York",
    });
  });

  it("rejects an unknown time zone", () => {
    expect(createLeagueSchema.safeParse({ name: "x", timeZone: "Mars/Olympus" }).success).toBe(false);
  });

  it("allows only regular-season weeks", () => {
    expect(createWeekSchema.safeParse({ year: 2026, number: 18 }).success).toBe(true);
    expect(createWeekSchema.safeParse({ year: 2026, number: 19 }).success).toBe(false);
    expect(createWeekSchema.safeParse({ year: 2026, number: 0 }).success).toBe(false);
  });

  const game = { homeTeam: "PHI", awayTeam: "DAL", kickoff: "2026-11-15T18:00:00Z", spread: -3.5 };

  it("accepts half-point spreads only", () => {
    expect(createGameSchema.safeParse(game).success).toBe(true);
    expect(createGameSchema.safeParse({ ...game, spread: -3.25 }).success).toBe(false);
  });

  it("rejects a team playing itself and unknown teams", () => {
    expect(createGameSchema.safeParse({ ...game, awayTeam: "PHI" }).success).toBe(false);
    expect(createGameSchema.safeParse({ ...game, awayTeam: "XXX" }).success).toBe(false);
  });
});

describe("lines", () => {
  it("gives the away side the opposite of the home line", () => {
    expect(lineFor("home", -3.5)).toBe(-3.5);
    expect(lineFor("away", -3.5)).toBe(3.5);
    expect(lineFor("away", 0)).toBe(0);
  });

  it("formats favorites, underdogs and pick'ems", () => {
    expect(formatLine("PHI", -3.5)).toBe("PHI -3.5");
    expect(formatLine("DAL", 3.5)).toBe("DAL +3.5");
    expect(formatLine("PHI", 0)).toBe("PHI PK");
  });
});
