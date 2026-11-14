import { describe, expect, it } from "vitest";
import { dueReminderDay, missingPicks } from "./reminders";
import { zonedTimeToUtc } from "./time";

const ET = "America/New_York";
const et = (y: number, m: number, d: number, hour: number, minute = 0) =>
  new Date(zonedTimeToUtc(y, m, d, hour, ET).getTime() + minute * 60_000);

// Week 10 of 2026: Thu Nov 12, Sun Nov 15 (two games), Mon Nov 16.
const games = [
  { id: "thu", kickoff: et(2026, 11, 12, 20, 15), final: false },
  { id: "sun-late", kickoff: et(2026, 11, 15, 16, 25), final: false },
  { id: "sun", kickoff: et(2026, 11, 15, 13), final: false },
  { id: "mon", kickoff: et(2026, 11, 16, 20, 15), final: false },
];

describe("dueReminderDay", () => {
  it("is due from 7pm the evening before until the day's first kickoff", () => {
    expect(dueReminderDay(games, ET, et(2026, 11, 11, 18, 59))).toBeNull();
    expect(dueReminderDay(games, ET, et(2026, 11, 11, 19))).toMatchObject({
      date: "2026-11-12",
      remindAt: et(2026, 11, 11, 19),
      expiresAt: et(2026, 11, 12, 20, 15),
      games: [{ id: "thu" }],
    });
    expect(dueReminderDay(games, ET, et(2026, 11, 12, 20, 14))?.date).toBe("2026-11-12");
    expect(dueReminderDay(games, ET, et(2026, 11, 12, 20, 15))).toBeNull();
    // Sunday's reminder ends at the 1pm kickoff, even though the 4:25pm game is still open.
    expect(dueReminderDay(games, ET, et(2026, 11, 15, 12, 59))?.date).toBe("2026-11-15");
    expect(dueReminderDay(games, ET, et(2026, 11, 15, 13))).toBeNull();
  });

  it("lists that day's games in kickoff order, and only that day's", () => {
    const due = dueReminderDay(games, ET, et(2026, 11, 14, 21));
    expect(due?.date).toBe("2026-11-15");
    expect(due?.games.map((g) => g.id)).toEqual(["sun", "sun-late"]);
    expect(dueReminderDay(games, ET, et(2026, 11, 15, 19))?.games.map((g) => g.id)).toEqual(["mon"]);
  });

  it("measures the evening in the league's time zone", () => {
    const PT = "America/Los_Angeles";
    // 7pm Eastern Saturday is only 4pm Pacific: not yet.
    expect(dueReminderDay(games, PT, et(2026, 11, 14, 19))).toBeNull();
    expect(dueReminderDay(games, PT, et(2026, 11, 14, 22))?.date).toBe("2026-11-15");
  });

  it("crosses month boundaries", () => {
    const dec1 = [{ id: "g", kickoff: et(2026, 12, 1, 20, 15), final: false }];
    expect(dueReminderDay(dec1, ET, et(2026, 11, 30, 19))?.date).toBe("2026-12-01");
  });

  it("skips games that already have a result", () => {
    const scored = games.map((g) => (g.id === "thu" ? { ...g, final: true } : g));
    expect(dueReminderDay(scored, ET, et(2026, 11, 11, 20))).toBeNull();
  });
});

describe("missingPicks", () => {
  it("returns the games without a pick", () => {
    expect(missingPicks(games, new Set(["thu", "sun"])).map((g) => g.id)).toEqual(["sun-late", "mon"]);
  });
});
