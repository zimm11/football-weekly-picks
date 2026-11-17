import { describe, expect, it } from "vitest";
import { firstKickoff, missingLineDue, nextRegularWeek, slateEditable, weeklyOpensAt } from "./weekly";

describe("weeklyOpensAt", () => {
  it("opens a Thursday-to-Monday week on its Tuesday at 9 AM Eastern", () => {
    // Thursday, Nov 19 2026, 8:15 PM ET (EST, UTC-5).
    expect(weeklyOpensAt(new Date("2026-11-20T01:15:00Z")).toISOString()).toBe("2026-11-17T14:00:00.000Z");
  });

  it("uses daylight time in September", () => {
    // Thursday, Sep 10 2026, 8:20 PM EDT: the Tuesday is Sep 8, 9 AM EDT (13:00 UTC).
    expect(weeklyOpensAt(new Date("2026-09-11T00:20:00Z")).toISOString()).toBe("2026-09-08T13:00:00.000Z");
  });

  it("opens a week that starts on the weekend on the Tuesday before", () => {
    // Week 18 starts Saturday, Jan 9 2027: the Tuesday is Jan 5.
    expect(weeklyOpensAt(new Date("2027-01-09T21:30:00Z")).toISOString()).toBe("2027-01-05T14:00:00.000Z");
  });

  it("crosses a month's edge", () => {
    // Thursday, Oct 1 2026: the Tuesday is Sep 29.
    expect(weeklyOpensAt(new Date("2026-10-02T00:15:00Z")).toISOString()).toBe("2026-09-29T13:00:00.000Z");
  });

  it("opens a Tuesday game before 9 AM with the Tuesday before", () => {
    const kickoff = new Date("2026-11-24T12:00:00Z"); // Tuesday 7 AM ET
    expect(weeklyOpensAt(kickoff).toISOString()).toBe("2026-11-17T14:00:00.000Z");
    // Later on Tuesday: that same morning.
    expect(weeklyOpensAt(new Date("2026-11-25T01:00:00Z")).toISOString()).toBe("2026-11-24T14:00:00.000Z");
  });
});

describe("nextRegularWeek", () => {
  it("suggests the first week whose Thursday night is still ahead", () => {
    expect(nextRegularWeek(2026, new Date("2026-08-01T12:00:00Z"))).toBe(1);
    // Tuesday, Nov 17 2026: Week 11 starts Thursday the 19th.
    expect(nextRegularWeek(2026, new Date("2026-11-17T12:00:00Z"))).toBe(11);
    expect(nextRegularWeek(2026, new Date("2026-11-20T02:00:00Z"))).toBe(12);
    expect(nextRegularWeek(2026, new Date("2027-02-01T12:00:00Z"))).toBe(18);
  });
});

describe("missing lines and slate edits", () => {
  const kickoff = new Date("2026-11-20T01:15:00Z");
  const games = [
    { kickoff, spread: -3 },
    { kickoff: new Date("2026-11-22T18:00:00Z"), spread: null },
  ];

  it("reports a missing line from 24 hours before the first kickoff", () => {
    expect(missingLineDue(games, new Date("2026-11-19T01:14:00Z"))).toBe(false);
    expect(missingLineDue(games, new Date("2026-11-19T01:15:00Z"))).toBe(true);
    expect(missingLineDue([{ kickoff, spread: 1 }], new Date("2026-11-19T12:00:00Z"))).toBe(false);
    expect(missingLineDue([], new Date("2026-11-19T12:00:00Z"))).toBe(false);
  });

  it("lets spreads and points change until the first kickoff", () => {
    expect(slateEditable(games, new Date("2026-11-20T01:14:59Z"))).toBe(true);
    expect(slateEditable(games, kickoff)).toBe(false);
    expect(slateEditable([], kickoff)).toBe(true);
    expect(firstKickoff(games)).toEqual(kickoff);
  });
});
