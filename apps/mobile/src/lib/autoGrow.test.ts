import { describe, expect, it } from "vitest";
import { grownHeight } from "./autoGrow";

describe("a growing text box", () => {
  it("never goes under its smallest size", () => {
    expect(grownHeight(0, 2, 44, 160)).toEqual({ height: 44, scrolls: false });
    expect(grownHeight(42, 2, 44, 160)).toEqual({ height: 44, scrolls: false });
  });
  it("grows with its text, borders included, so the same text always gives the same height", () => {
    expect(grownHeight(89, 2, 44, 160)).toEqual({ height: 91, scrolls: false });
    // Measuring a box that is already 91px tall with the same text must not shrink it.
    expect(grownHeight(89, 2, 44, 160).height).toBe(91);
    expect(grownHeight(88.4, 2, 44, 160).height).toBe(91);
  });
  it("stops at its largest size and scrolls from there", () => {
    expect(grownHeight(158, 2, 44, 160)).toEqual({ height: 160, scrolls: false });
    expect(grownHeight(159, 2, 44, 160)).toEqual({ height: 160, scrolls: true });
    expect(grownHeight(5000, 2, 44, 160)).toEqual({ height: 160, scrolls: true });
  });
});
