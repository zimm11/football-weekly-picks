import { defaultPoints, POW_BONUS, type Side } from "@picks/shared";
import { layout, space, widths } from "../components/theme";

/**
 * The signed-out home page's layout at a window width: one column under 768px; two equal columns in the page
 * width from 768; from 1024 the wider landing container, with the pitch taking 1.2 parts to the example's 1.
 */
export type LandingLayout = "phone" | "tablet" | "desktop";
export function landingLayout(width: number): LandingLayout {
  return width >= 1024 ? "desktop" : width >= 768 ? "tablet" : "phone";
}

/** The gap between the hero's two columns, and the share of the row the pitch takes from 1024px. */
export const HERO_GAP = { tablet: space["4xl"], desktop: space["5xl"] } as const;
export const HERO_SHARE = 1.2;

/** Room left for a classic (non-overlay) scrollbar in a desktop browser, so the headline never wraps there. */
const SCROLLBAR = 16;

/** The widest a line of the headline runs, in font sizes: "BEAT THE SPREAD." is about 6.75 of them. */
const LINE_EMS = 6.85;

/**
 * The headline's size from the width of its column, so each of its two sentences stays on one line at every
 * window width: worked out from the window and the layout's known paddings, never from a measured layout.
 */
export function heroHeadline(width: number): { fontSize: number; lineHeight: number } {
  const shape = landingLayout(width);
  const max = shape === "desktop" ? widths.landing : widths.page;
  // The page's content box: the window (less a scrollbar on a computer), capped, less the side padding.
  const inner = Math.min(width - (shape === "phone" ? 0 : SCROLLBAR), max) - layout.pageX * 2;
  const column =
    shape === "phone"
      ? inner
      : shape === "tablet"
        ? (inner - HERO_GAP.tablet) / 2
        : ((inner - HERO_GAP.desktop) * HERO_SHARE) / (HERO_SHARE + 1);
  const fontSize = Math.min(88, Math.max(40, Math.floor(column / LINE_EMS)));
  return { fontSize, lineHeight: Math.round(fontSize * 0.92) };
}

/** The example game on the home page: Buffalo at Miami on a Monday night, Miami a 3.5-point underdog at home. */
export const EXAMPLE_GAME = {
  away: { abbr: "BUF", name: "Bills" },
  home: { abbr: "MIA", name: "Dolphins" },
  /** The home team's line, as spreads are stored. */
  spread: 3.5,
  /** Monday, November 23, 2026, 8:15 PM Eastern. */
  kickoff: new Date("2026-11-24T01:15:00Z"),
} as const;

/** A side's line in the example, as players read it: "−3.5" (with a real minus sign), "+3.5" or "PK". */
export function exampleLine(side: Side): string {
  const line = side === "home" ? EXAMPLE_GAME.spread : -EXAMPLE_GAME.spread;
  return line === 0 ? "PK" : `${line > 0 ? "+" : "−"}${Math.abs(line)}`;
}

/**
 * What the example card says under its buttons for a pick: what the side needs to cover, and what a win is
 * worth by the real point rules (the game's slot, plus the POW bonus when it is the POW).
 */
export function exampleCaption(side: Side, pow: boolean): { rule: string; points: number; text: string } {
  const team = EXAMPLE_GAME[side];
  const line = side === "home" ? EXAMPLE_GAME.spread : -EXAMPLE_GAME.spread;
  const by = Math.abs(line);
  const need =
    line < 0
      ? `they need to win by ${Math.floor(by) + 1} or more`
      : line > 0
        ? `win, or lose by ${Math.ceil(by) - 1} or fewer`
        : "they just need to win";
  const rule = `${team.name} ${exampleLine(side)}: ${need}.`;
  const points = defaultPoints(EXAMPLE_GAME.kickoff) + (pow ? POW_BONUS : 0);
  return { rule, points, text: `${rule} Worth ${points} points${pow ? " as your POW" : ""}.` };
}
