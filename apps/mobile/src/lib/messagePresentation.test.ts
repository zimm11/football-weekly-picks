import { describe, expect, it } from "vitest";
import { messageTime } from "./messagePresentation";

describe("message timestamps match the web's day-sensitive wording", () => {
  const now = new Date(2026, 10, 16, 15, 42);
  it("uses Just now for future timestamps and less than one minute ago", () => {
    expect(messageTime(new Date(now.getTime() + 60_000).toISOString(), now)).toBe("Just now");
    expect(messageTime(new Date(now.getTime() - 59_000).toISOString(), now)).toBe("Just now");
  });
  it("switches from elapsed minutes to local clock time after an hour", () => {
    expect(messageTime(new Date(2026, 10, 16, 15, 30).toISOString(), now)).toBe("12 min ago");
    expect(messageTime(new Date(2026, 10, 16, 14, 42).toISOString(), now)).toBe("2:42 PM");
  });
  it("uses calendar days rather than a rolling 24-hour period", () => {
    expect(messageTime(new Date(2026, 10, 15, 23, 59).toISOString(), now)).toBe("Yesterday, 11:59 PM");
    expect(messageTime(new Date(2026, 10, 14, 9, 15).toISOString(), now)).toBe("Sat, 9:15 AM");
  });
  it("shows a date after a week and includes year only for another year", () => {
    expect(messageTime(new Date(2026, 10, 2, 9).toISOString(), now)).toBe("Nov 2");
    expect(messageTime(new Date(2025, 10, 2, 9).toISOString(), now)).toBe("Nov 2, 2025");
  });
});
