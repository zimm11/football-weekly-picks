import { describe, expect, it } from "vitest";
import { keepLastWords, leagueTodoLine, leagueTodoParts, locksPhrase } from "./leagueTodo";

const NY = "America/New_York";
// Tuesday, Nov 17, 2026, 10:00 AM Eastern.
const now = new Date("2026-11-17T15:00:00Z");

describe("locksPhrase", () => {
  it("counts minutes and then hours while the lock is close", () => {
    expect(locksPhrase(new Date("2026-11-17T15:00:30Z"), now, NY)).toBe("now");
    expect(locksPhrase(new Date("2026-11-17T15:01:00Z"), now, NY)).toBe("in 1 minute");
    expect(locksPhrase(new Date("2026-11-17T15:40:00Z"), now, NY)).toBe("in 40 minutes");
    expect(locksPhrase(new Date("2026-11-17T16:00:00Z"), now, NY)).toBe("in 1 hour");
    expect(locksPhrase(new Date("2026-11-17T18:30:00Z"), now, NY)).toBe("in 3 hours");
  });
  it("names today and tomorrow by the device's calendar day", () => {
    expect(locksPhrase(new Date("2026-11-18T01:15:00Z"), now, NY)).toBe("today 8:15 PM");
    expect(locksPhrase(new Date("2026-11-18T18:00:00Z"), now, NY)).toBe("tomorrow 1:00 PM");
    // The same instant is already the next day further east.
    expect(locksPhrase(new Date("2026-11-18T01:15:00Z"), now, "Europe/London")).toBe("tomorrow 1:15 AM");
  });
  it("names the weekday within the week, then the date", () => {
    expect(locksPhrase(new Date("2026-11-20T01:15:00Z"), now, NY)).toBe("Thu 8:15 PM");
    expect(locksPhrase(new Date("2026-11-22T18:00:00Z"), now, NY)).toBe("Sun 1:00 PM");
    expect(locksPhrase(new Date("2026-11-24T17:00:00Z"), now, NY)).toBe("Tue, Nov 24");
  });
  it("writes noon and midnight as 12", () => {
    expect(locksPhrase(new Date("2026-11-19T17:00:00Z"), now, NY)).toBe("Thu 12:00 PM");
    expect(locksPhrase(new Date("2026-11-20T05:05:00Z"), now, NY)).toBe("Fri 12:05 AM");
  });
});

describe("leagueTodoLine", () => {
  const thu = "2026-11-20T01:15:00Z";
  it("says nothing when nothing is waiting, as from an older server", () => {
    expect(leagueTodoLine(undefined, now, NY)).toBeUndefined();
  });
  it("counts the picks due, singular for one", () => {
    expect(
      leagueTodoLine({ kind: "picks", weekId: "w", weekNumber: 12, count: 7, locksAt: thu }, now, NY),
    ).toBe("7 picks due · locks Thu 8:15 PM");
    expect(
      leagueTodoLine({ kind: "picks", weekId: "w", weekNumber: 12, count: 1, locksAt: thu }, now, NY),
    ).toBe("1 pick due · locks Thu 8:15 PM");
  });
  it("words a survivor pick", () => {
    expect(
      leagueTodoLine(
        { kind: "survivor-pick", weekId: "w", weekNumber: 12, locksAt: "2026-11-17T18:00:00Z" },
        now,
        NY,
      ),
    ).toBe("Pick due · locks in 3 hours");
  });
  it("words one open board, and several by the first to lock", () => {
    expect(leagueTodoLine({ kind: "squares", boardId: "b", count: 1, locksAt: thu }, now, NY)).toBe(
      "Squares open · locks Thu 8:15 PM",
    );
    expect(leagueTodoLine({ kind: "squares", boardId: "b", count: 2, locksAt: thu }, now, NY)).toBe(
      "2 boards open · first locks Thu 8:15 PM",
    );
  });
  it("leaves the time out when it can't be read", () => {
    expect(
      leagueTodoLine({ kind: "picks", weekId: "w", weekNumber: 1, count: 2, locksAt: "soon" }, now, NY),
    ).toBe("2 picks due");
  });
});

describe("leagueTodoParts", () => {
  it("splits what is waiting from when it locks, so a narrow row can break between them", () => {
    expect(
      leagueTodoParts(
        { kind: "picks", weekId: "w", weekNumber: 12, count: 13, locksAt: "2026-11-18T01:15:00Z" },
        now,
        NY,
      ),
    ).toEqual({ what: "13 picks due", when: "locks today 8:15 PM" });
    expect(
      leagueTodoParts({ kind: "squares", boardId: "b", count: 2, locksAt: "2026-11-30T17:30:00Z" }, now, NY),
    ).toEqual({ what: "2 boards open", when: "first locks Mon, Nov 30" });
    expect(
      leagueTodoParts({ kind: "survivor-pick", weekId: "w", weekNumber: 12, locksAt: "soon" }, now, NY),
    ).toEqual({ what: "Pick due" });
  });
});

describe("keepLastWords", () => {
  it("joins the last two words with a no-break space, and leaves one word alone", () => {
    expect(keepLastWords("locks tomorrow 12:30 PM")).toBe("locks tomorrow 12:30\u00a0PM");
    expect(keepLastWords("locks in 45 minutes")).toBe("locks in 45\u00a0minutes");
    expect(keepLastWords("locks Sun, Nov 30")).toBe("locks Sun, Nov\u00a030");
    expect(keepLastWords("now")).toBe("now");
  });
  it("is for drawing only: the accessible sentence keeps ordinary spaces", () => {
    const line = leagueTodoLine(
      { kind: "picks", weekId: "w", weekNumber: 12, count: 13, locksAt: "2026-11-18T01:15:00Z" },
      now,
      NY,
    );
    expect(line).toBe("13 picks due · locks today 8:15 PM");
    expect(line).not.toContain("\u00a0");
  });
});
