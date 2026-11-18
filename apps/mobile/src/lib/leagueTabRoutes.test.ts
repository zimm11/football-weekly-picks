import { LEAGUE_TYPE_INFO, type LeagueType } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { tabOfRoute, tabRouteName } from "./leagueTabRoutes";

describe("league tab routes", () => {
  it("names each tab's route after its file", () => {
    expect(tabRouteName("weekly", "picks")).toBe("index");
    expect(tabRouteName("weekly", "results")).toBe("results/index");
    expect(tabRouteName("weekly", "messages")).toBe("messages");
    expect(tabRouteName("squares", "board")).toBe("index");
    expect(tabRouteName("survivor", "standings")).toBe("standings/index");
  });

  it("round-trips every type's tabs", () => {
    for (const type of Object.keys(LEAGUE_TYPE_INFO) as LeagueType[])
      for (const tab of LEAGUE_TYPE_INFO[type].tabs)
        expect(tabOfRoute(type, tabRouteName(type, tab))).toBe(tab);
  });

  it("has no tab for a route the type lacks", () => {
    expect(tabOfRoute("squares", "results/index")).toBeNull();
    expect(tabOfRoute("squares", "standings/index")).toBeNull();
    expect(tabOfRoute("survivor", "results/index")).toBeNull();
    expect(tabOfRoute("weekly", "league/index")).toBe("league");
  });
});
