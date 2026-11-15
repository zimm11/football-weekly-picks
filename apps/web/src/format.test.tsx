import { describe, expect, it } from "vitest";
import { relativeTime } from "./format";

// Local times, so the day boundaries match the browser's time zone whatever it is.
const now = new Date(2026, 10, 15, 14, 30);
const at = (month: number, day: number, hour: number, minute = 0, year = 2026) =>
  new Date(year, month, day, hour, minute).toISOString();

describe("relativeTime", () => {
  it("counts minutes for the last hour", () => {
    expect(relativeTime(at(10, 15, 14, 30), now)).toBe("Just now");
    expect(relativeTime(at(10, 15, 14, 18), now)).toBe("12 min ago");
  });

  it("shows the time earlier today and yesterday", () => {
    expect(relativeTime(at(10, 15, 9, 5), now)).toBe("9:05 AM");
    expect(relativeTime(at(10, 14, 21, 15), now)).toBe("Yesterday, 9:15 PM");
  });

  it("names the weekday within a week, then the date", () => {
    expect(relativeTime(at(10, 10, 20, 0), now)).toBe("Tue, 8:00 PM");
    expect(relativeTime(at(10, 2, 20, 0), now)).toBe("Nov 2");
    expect(relativeTime(at(11, 28, 20, 0, 2025), now)).toBe("Dec 28, 2025");
  });
});
