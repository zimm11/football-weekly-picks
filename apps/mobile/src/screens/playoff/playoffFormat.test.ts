import type { WeekSummary } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { automaticNextStep } from "../weekly/weeklyNextStep";
import { playoffFormatLocked } from "./playoffFormat";

const week = (number: number, status: WeekSummary["status"], phase: WeekSummary["phase"], gameCount = 3) =>
  ({
    id: `w${number}`,
    year: 2026,
    number,
    status,
    phase,
    gameCount,
    myPickCount: 0,
    availablePickCount: 0,
    myAvailablePickCount: 0,
    myMissingPickCount: 0,
  }) satisfies WeekSummary;

describe("the playoff format", () => {
  it("stays editable until the Wild Card round is under way", () => {
    expect(playoffFormatLocked([])).toBe(false);
    expect(playoffFormatLocked([week(19, "draft", "draft")])).toBe(false);
    expect(playoffFormatLocked([week(19, "open", "accepting")])).toBe(false);
    expect(playoffFormatLocked([week(19, "open", "underway")])).toBe(true);
    expect(playoffFormatLocked([week(19, "final", "final")])).toBe(true);
  });
});

describe("an automatic weekly season's next step", () => {
  it("says what happens next, from the weeks as they stand", () => {
    expect(automaticNextStep([])).toBe("");
    // An empty draft: its games and lines are drawn, and it opens, on its Tuesday.
    expect(automaticNextStep([week(13, "draft", "draft", 0)])).toMatch(
      /Week 13 opens by itself on Tuesday at 9 AM Eastern: its games and that morning's lines/,
    );
    expect(automaticNextStep([week(12, "final", "final"), week(13, "draft", "draft")])).toMatch(
      /Week 13 opens by itself on Tuesday/,
    );
    expect(automaticNextStep([week(13, "open", "accepting")])).toMatch(/Week 13 is open/);
    expect(automaticNextStep([week(13, "final", "final")])).toMatch(/Week 14 is set up and opens on Tuesday/);
    expect(automaticNextStep([week(18, "final", "final")])).toMatch(/season is complete/);
  });
});
