import { TEAM_ABBRS } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { colors } from "../components/theme";
import { TEAM_BADGES, teamBadge } from "./teamBadges";

/** WCAG relative luminance of a `#rrggbb` color. */
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("team badges", () => {
  it("has one for every team, and none for anything else", () => {
    for (const abbr of TEAM_ABBRS) expect(teamBadge(abbr), abbr).toBeDefined();
    expect(teamBadge("AFC")).toBeUndefined();
    expect(teamBadge("toString")).toBeUndefined();
  });

  it("writes every color as six hex digits", () => {
    for (const [abbr, { fill, color, ring }] of Object.entries(TEAM_BADGES))
      for (const value of [fill, color, ...(ring ? [ring] : [])])
        expect(value, abbr).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("keeps each glyph readable on its disc", () => {
    const faint = Object.entries(TEAM_BADGES)
      .filter(([, b]) => contrast(b.color, b.fill) < 3)
      .map(([abbr, b]) => `${abbr} ${contrast(b.color, b.fill).toFixed(2)}`);
    expect(faint).toEqual([]);
  });

  it("keeps each badge's edge visible on the app's surfaces", () => {
    const lost: string[] = [];
    for (const [abbr, b] of Object.entries(TEAM_BADGES))
      for (const surface of [colors.background, colors.card, colors.raised])
        if (contrast(b.ring ?? b.fill, surface) < 2) lost.push(`${abbr} on ${surface}`);
    expect(lost).toEqual([]);
  });

  it("gives no two teams the same glyph on the same disc", () => {
    const looks = Object.values(TEAM_BADGES).map((b) => `${b.glyph} ${b.fill}`);
    expect(new Set(looks).size).toBe(looks.length);
  });
});
