import type { LeagueDetail } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { seasonChoiceLabel } from "./seasonLabel";

const week = (year: number) => ({ year }) as LeagueDetail["weeks"][number];
const league = (
  type: LeagueDetail["type"],
  management: LeagueDetail["management"],
  weeks: LeagueDetail["weeks"] = [],
) => ({ type, management, weeks });

describe("season choice labels", () => {
  it("marks a Hands-on weekly season with no weeks yet as not started", () => {
    expect(seasonChoiceLabel(league("weekly", "manual"), 2026)).toBe("2026 · Not started");
    expect(seasonChoiceLabel(league("weekly", "manual", [week(2026)]), 2026)).toBe("2026");
    expect(seasonChoiceLabel(league("weekly", "manual", [week(2025)]), 2026)).toBe("2026 · Not started");
  });

  it("never says not started for a league that runs itself or gets its season when created", () => {
    expect(seasonChoiceLabel(league("weekly", "auto"), 2026)).toBe("2026");
    expect(seasonChoiceLabel(league("survivor", "auto"), 2026)).toBe("2026");
    expect(seasonChoiceLabel(league("squares", "auto"), 2026)).toBe("2026");
  });

  it("names a playoff season by its postseason", () => {
    expect(seasonChoiceLabel(league("playoff", "auto"), 2026)).toBe("2026 playoffs");
  });
});
