import { describe, expect, it } from "vitest";
import { createLeagueSchema, updateLeagueSchema } from "./index";
import {
  coversWeek,
  defaultManagement,
  defaultSeasonSettings,
  LEAGUE_TABS,
  LEAGUE_TYPE_INFO,
  LEAGUE_TYPES,
  leagueTabFromPath,
  leagueTabPath,
  managementChoices,
  mayUseManagement,
  parseSeasonSettings,
  readSeasonSettings,
  resultsSoFarAudience,
} from "./leagueTypes";

describe("league type registry", () => {
  it("has an entry for every type, weekly first", () => {
    expect(LEAGUE_TYPES[0]).toBe("weekly");
    for (const type of LEAGUE_TYPES) {
      const info = LEAGUE_TYPE_INFO[type];
      expect(info.type).toBe(type);
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.description).toMatch(/\.$/);
      expect(info.tabs).toContain("messages");
      expect(info.tabs.at(-1)).toBe("league");
      for (const tab of info.tabs) expect(LEAGUE_TABS[tab]).toBeDefined();
    }
  });

  it("gives each type the tabs the spec lists", () => {
    expect(LEAGUE_TYPE_INFO.weekly.tabs).toEqual(["picks", "results", "standings", "messages", "league"]);
    expect(LEAGUE_TYPE_INFO.playoff.tabs).toEqual(["picks", "results", "standings", "messages", "league"]);
    expect(LEAGUE_TYPE_INFO.survivor.tabs).toEqual(["pick", "standings", "messages", "league"]);
    expect(LEAGUE_TYPE_INFO.squares.tabs).toEqual(["board", "messages", "league"]);
  });

  it("says when each type reveals picks", () => {
    expect(LEAGUE_TYPE_INFO.weekly.reveal).toBe("final");
    expect(LEAGUE_TYPE_INFO.playoff.reveal).toBe("final");
    expect(LEAGUE_TYPE_INFO.survivor.reveal).toBe("kickoff");
    expect(LEAGUE_TYPE_INFO.squares.reveal).toBe("always");
  });

  it("covers the weeks each type plays", () => {
    expect(coversWeek("weekly", 1)).toBe(true);
    expect(coversWeek("weekly", 18)).toBe(true);
    expect(coversWeek("weekly", 19)).toBe(false);
    expect(coversWeek("playoff", 18)).toBe(false);
    expect([19, 20, 21, 22].every((n) => coversWeek("playoff", n))).toBe(true);
    expect(coversWeek("survivor", 22)).toBe(true);
    expect(coversWeek("squares", 22)).toBe(false);
  });

  it("maps URL segments to tabs, the first tab at the league's own URL", () => {
    expect(leagueTabFromPath("weekly", "")).toBe("picks");
    expect(leagueTabFromPath("weekly", "results")).toBe("results");
    expect(leagueTabFromPath("squares", "")).toBe("board");
    expect(leagueTabFromPath("survivor", "")).toBe("pick");
    // A tab the type doesn't have is not found.
    expect(leagueTabFromPath("squares", "results")).toBeNull();
    expect(leagueTabFromPath("squares", "standings")).toBeNull();
    expect(leagueTabFromPath("survivor", "results")).toBeNull();
    // The first tab has one URL only.
    expect(leagueTabFromPath("weekly", "picks")).toBeNull();
    expect(leagueTabPath("weekly", "picks")).toBe("");
    expect(leagueTabPath("squares", "board")).toBe("");
    expect(leagueTabPath("survivor", "standings")).toBe("standings");
  });
});

describe("management", () => {
  it("lets weekly pick'em choose, Automatic first, and runs the rest automatically", () => {
    expect(mayUseManagement("weekly", "auto")).toBe(true);
    expect(mayUseManagement("weekly", "manual")).toBe(true);
    expect(mayUseManagement("playoff", "manual")).toBe(false);
    expect(mayUseManagement("playoff", "auto")).toBe(true);
    expect(managementChoices("weekly")).toEqual(["auto", "manual"]);
    expect(managementChoices("squares")).toEqual(["auto"]);
    // A request without management: hands-on for weekly (the old web build), automatic for the rest.
    expect(defaultManagement("weekly")).toBe("manual");
    expect(defaultManagement("survivor")).toBe("auto");
  });
});

describe("results so far", () => {
  it("shows them to everyone in a league that runs itself, and in a Hands-on one only once it is turned on", () => {
    expect(resultsSoFarAudience({ management: "manual", shareResultsSoFar: false })).toBe("admins");
    expect(resultsSoFarAudience({ management: "manual", shareResultsSoFar: true })).toBe("everyone");
    // The setting is kept while a league runs itself, but decides nothing.
    expect(resultsSoFarAudience({ management: "auto", shareResultsSoFar: false })).toBe("everyone");
    expect(resultsSoFarAudience({ management: "auto", shareResultsSoFar: true })).toBe("everyone");
  });

  it("is a change a league update can carry alone", () => {
    expect(updateLeagueSchema.safeParse({ shareResultsSoFar: false }).success).toBe(true);
    expect(updateLeagueSchema.safeParse({ shareResultsSoFar: "yes" }).success).toBe(false);
    expect(updateLeagueSchema.safeParse({}).success).toBe(false);
  });
});

describe("season settings", () => {
  it("fills in each type's defaults", () => {
    expect(defaultSeasonSettings("weekly")).toEqual({});
    expect(defaultSeasonSettings("playoff")).toEqual({ format: "traditional" });
    expect(defaultSeasonSettings("survivor")).toEqual({ lives: 1 });
    expect(defaultSeasonSettings("squares")).toEqual({});
  });

  it("validates on write and falls back to defaults on a bad read", () => {
    expect(parseSeasonSettings("survivor", { lives: 3, startWeek: 4 })).toEqual({ lives: 3, startWeek: 4 });
    expect(() => parseSeasonSettings("survivor", { lives: 4 })).toThrow();
    expect(() => parseSeasonSettings("playoff", { format: "bracket" })).toThrow();
    expect(readSeasonSettings("survivor", { lives: 9 })).toEqual({ lives: 1 });
    expect(readSeasonSettings("playoff", null)).toEqual({ format: "traditional" });
  });

  it("checks a create request's settings and management against its type", () => {
    expect(
      createLeagueSchema.safeParse({ name: "Pool", type: "survivor", settings: { lives: 2 } }).success,
    ).toBe(true);
    expect(
      createLeagueSchema.safeParse({ name: "Pool", type: "survivor", settings: { lives: 0 } }).success,
    ).toBe(false);
    expect(
      createLeagueSchema.safeParse({ name: "Pool", type: "squares", management: "manual" }).success,
    ).toBe(false);
    expect(createLeagueSchema.safeParse({ name: "Crew", management: "auto" }).success).toBe(true);
    expect(createLeagueSchema.safeParse({ name: "Crew", type: "golf" }).success).toBe(false);
    expect(createLeagueSchema.safeParse({ name: "Crew", copyMembersFrom: "not-an-id" }).success).toBe(false);
    expect(updateLeagueSchema.safeParse({ management: "auto" }).success).toBe(true);
  });
});
