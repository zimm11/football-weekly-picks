import { describe, expect, it } from "vitest";
import {
  activeMute,
  mutedMessage,
  REPORT_NOTE_MAX,
  reportSchema,
  SCREENING_THRESHOLDS,
  screeningVerdict,
  strikeConsequence,
} from "./moderation";

describe("screeningVerdict", () => {
  it("blocks at the block threshold and allows everything below it", () => {
    expect(screeningVerdict({ allow: 0.3, block: SCREENING_THRESHOLDS.block })).toBe("block");
    expect(screeningVerdict({ allow: 0.31, block: SCREENING_THRESHOLDS.block - 0.01 })).toBe("allow");
    expect(screeningVerdict({ allow: 0.98, block: 0.02 })).toBe("allow");
  });

  it("takes other thresholds", () => {
    expect(screeningVerdict({ allow: 0.5, block: 0.5 }, { block: 0.5 })).toBe("block");
  });
});

describe("strikeConsequence", () => {
  it("does nothing on a first removal", () => {
    expect(strikeConsequence(0)).toBeNull();
    expect(strikeConsequence(1)).toBeNull();
  });
  it("mutes for a day on the second and a week, with a suspension review, from the third", () => {
    expect(strikeConsequence(2)).toEqual({ mute: "24h", reviewSuspension: false });
    expect(strikeConsequence(3)).toEqual({ mute: "7d", reviewSuspension: true });
    expect(strikeConsequence(9)).toEqual({ mute: "7d", reviewSuspension: true });
  });
});

describe("activeMute", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  it("is the later of the mutes still running", () => {
    const league = new Date("2026-11-16T18:00:00Z");
    const app = new Date("2026-11-17T12:00:00Z");
    expect(activeMute(now, league, app)).toEqual(app);
    expect(activeMute(now, league, null)).toEqual(league);
  });
  it("ignores mutes already over", () => {
    expect(activeMute(now, new Date("2026-11-16T11:59:59Z"), undefined)).toBeNull();
  });
});

describe("mutedMessage", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  it("rounds up to whole hours, then days", () => {
    expect(mutedMessage(new Date("2026-11-16T12:10:00Z"), now)).toBe("You're muted for another 1 hour.");
    expect(mutedMessage(new Date("2026-11-17T11:00:00Z"), now)).toBe("You're muted for another 23 hours.");
    expect(mutedMessage(new Date("2026-11-23T12:00:00Z"), now)).toBe("You're muted for another 7 days.");
  });
});

describe("reportSchema", () => {
  const ids = {
    leagueId: "11111111-1111-4111-8111-111111111111",
    threadId: "22222222-2222-4222-8222-222222222222",
    postId: "33333333-3333-4333-8333-333333333333",
  };
  it("accepts a message report with an optional note", () => {
    expect(reportSchema.safeParse({ kind: "post", ...ids, reason: "spam" }).success).toBe(true);
    expect(
      reportSchema.safeParse({ kind: "post", ...ids, reason: "spam", note: " why " }).data,
    ).toMatchObject({
      note: "why",
    });
  });
  it("refuses unknown reasons, missing targets and long notes", () => {
    expect(reportSchema.safeParse({ kind: "post", ...ids, reason: "flagged" }).success).toBe(false);
    expect(
      reportSchema.safeParse({ kind: "display_name", leagueId: ids.leagueId, reason: "hate" }).success,
    ).toBe(false);
    expect(
      reportSchema.safeParse({
        kind: "league_name",
        leagueId: ids.leagueId,
        reason: "other",
        note: "x".repeat(REPORT_NOTE_MAX + 1),
      }).success,
    ).toBe(false);
  });
});
