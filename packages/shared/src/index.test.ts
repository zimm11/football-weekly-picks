import { describe, expect, it } from "vitest";
import {
  canonicalTimeZone,
  createGameSchema,
  createLeagueSchema,
  createWeekSchema,
  formatLine,
  lineFor,
  MESSAGE_REACTIONS,
  messageReactionSchema,
  updateLeagueSchema,
} from "./index";

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

  it("stores time zones in their canonical spelling", () => {
    expect(createLeagueSchema.parse({ name: "x", timeZone: "america/new_york" }).timeZone).toBe(
      "America/New_York",
    );
    expect(updateLeagueSchema.parse({ timeZone: "US/Eastern" }).timeZone).toBe("America/New_York");
  });

  it("accepts only geographic Area/Location zones and UTC", () => {
    expect(canonicalTimeZone("America/Indiana/Indianapolis")).not.toBeNull();
    expect(canonicalTimeZone("Pacific/Honolulu")).toBe("Pacific/Honolulu");
    expect(canonicalTimeZone("UTC")).toBe("UTC");
    for (const timeZone of ["EST5EDT", "+05:30", "-0800", "Etc/GMT+5", "Mars/Olympus", ""]) {
      expect(canonicalTimeZone(timeZone), timeZone).toBeNull();
    }
    expect(canonicalTimeZone(`America/${"X".repeat(60)}`)).toBeNull();
    expect(createLeagueSchema.safeParse({ name: "x", timeZone: "+05:30" }).success).toBe(false);
    expect(updateLeagueSchema.safeParse({ timeZone: "a".repeat(65) }).success).toBe(false);
  });

  it("accepts exactly the offered reactions", () => {
    for (const { emoji } of MESSAGE_REACTIONS) {
      expect(messageReactionSchema.safeParse({ emoji, active: true }).success).toBe(true);
    }
    expect(messageReactionSchema.safeParse({ emoji: "💩", active: true }).success).toBe(false);
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
