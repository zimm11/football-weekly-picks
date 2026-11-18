import { describe, expect, it } from "vitest";
import { exampleCaption, exampleLine, heroHeadline, landingLayout } from "./landing";

describe("landingLayout", () => {
  it("is one column on phones, the page's two columns from 768 and the landing container from 1024", () => {
    expect(landingLayout(320)).toBe("phone");
    expect(landingLayout(767)).toBe("phone");
    expect(landingLayout(768)).toBe("tablet");
    expect(landingLayout(1023)).toBe("tablet");
    expect(landingLayout(1024)).toBe("desktop");
    expect(landingLayout(1920)).toBe("desktop");
  });
});

describe("heroHeadline", () => {
  it("sizes the headline from its column so the longer sentence (6.75 font sizes) fits on one line", () => {
    expect(heroHeadline(320)).toEqual({ fontSize: 42, lineHeight: 39 });
    expect(heroHeadline(390)).toEqual({ fontSize: 52, lineHeight: 48 });
    expect(heroHeadline(768).fontSize).toBe(50);
    expect(heroHeadline(1024).fontSize).toBe(73);
    expect(heroHeadline(1280).fontSize).toBe(82);
    // The landing container stops growing at 1120, so the headline does too.
    expect(heroHeadline(1600)).toEqual(heroHeadline(1280));
    expect(heroHeadline(1920)).toEqual(heroHeadline(1280));
    for (const width of [320, 360, 390, 430, 600, 767, 768, 900, 1023, 1024, 1100, 1280, 1600, 1920]) {
      const { fontSize } = heroHeadline(width);
      expect(fontSize).toBeGreaterThanOrEqual(40);
      expect(fontSize).toBeLessThanOrEqual(88);
    }
  });

  it("keeps the lines tight: 0.92 of the size", () => {
    expect(heroHeadline(1280).lineHeight).toBe(Math.round(82 * 0.92));
  });

  it("never goes under 40, however narrow", () => {
    expect(heroHeadline(200).fontSize).toBe(40);
  });
});

describe("exampleCaption", () => {
  it("writes each side's line with a real minus sign", () => {
    expect(exampleLine("away")).toBe("−3.5");
    expect(exampleLine("home")).toBe("+3.5");
  });

  it("says what each side needs and what a win is worth by the Monday night slot", () => {
    expect(exampleCaption("away", false).text).toBe(
      "Bills −3.5: they need to win by 4 or more. Worth 3 points.",
    );
    expect(exampleCaption("home", false).text).toBe(
      "Dolphins +3.5: win, or lose by 3 or fewer. Worth 3 points.",
    );
  });

  it("adds the POW bonus when the pick is the POW", () => {
    expect(exampleCaption("away", true)).toEqual({
      rule: "Bills −3.5: they need to win by 4 or more.",
      points: 8,
      text: "Bills −3.5: they need to win by 4 or more. Worth 8 points as your POW.",
    });
    expect(exampleCaption("home", true).points).toBe(8);
  });
});
