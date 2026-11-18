import { describe, expect, it, vi } from "vitest";

vi.mock("expo-router", () => ({ useIsFocused: () => true }));
vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

import { pageTitle, titleFor } from "./pageTitle";

describe("pageTitle", () => {
  it("puts the page before the app's name", () => {
    expect(pageTitle("Settings")).toBe("Settings · POW Pick'em");
    expect(pageTitle("Standings · Sunday Crew")).toBe("Standings · Sunday Crew · POW Pick'em");
  });

  it("is the app's name alone while a page has no title yet", () => {
    expect(pageTitle()).toBe("POW Pick'em");
    expect(pageTitle(null)).toBe("POW Pick'em");
    expect(pageTitle("   ")).toBe("POW Pick'em");
  });

  it("keeps a league's name on one line", () => {
    expect(pageTitle("Picks · Sunday\n Crew")).toBe("Picks · Sunday Crew · POW Pick'em");
  });
});

describe("titleFor", () => {
  it("shows the most recent title asked for, and the app's name when nobody asked", () => {
    expect(titleFor([])).toBe("POW Pick'em");
    expect(titleFor(["Sign in"])).toBe("Sign in · POW Pick'em");
    expect(titleFor(["Messages · Sunday Crew", "Week 3 talk · Sunday Crew"])).toBe(
      "Week 3 talk · Sunday Crew · POW Pick'em",
    );
  });
});
