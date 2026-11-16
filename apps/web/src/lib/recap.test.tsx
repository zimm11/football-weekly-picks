import { describe, expect, it } from "vitest";
import { recapDecision } from "./recap";

describe("recapDecision", () => {
  it("takes the first load's answer", () => {
    expect(recapDecision(undefined, "week-1")).toBe("week-1");
    expect(recapDecision(undefined, null)).toBeNull();
  });

  it("keeps a week finalized mid-visit for the next visit", () => {
    expect(recapDecision(null, "week-2")).toBeNull();
  });

  it("keeps the recap it is already showing", () => {
    expect(recapDecision("week-1", "week-2")).toBe("week-1");
  });
});
