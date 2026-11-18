/** The app's color and font tokens, shared by the iPhone app and the web build (see AGENTS.md, Design). */
const palette = {
  background: "#070d1f",
  foreground: "#f1f4fb",
  chrome: "#030817",
  card: "#0f1834",
  raised: "#17234a",
  primary: "#4d7cff",
  primaryForeground: "#04102e",
  secondary: "#1a2750",
  muted: "#16224a",
  mutedForeground: "#94a0bd",
  border: "#94a0bd1f",
  input: "#94a0bd4d",
  pow: "#ff3d5e",
  powForeground: "#ffffff",
  destructive: "#ffa37a",
  win: "#3ddc97",
};
export const colors = {
  ...palette,
  primaryTint: `${palette.primary}1f`,
  powTint: `${palette.pow}1f`,
  winTint: `${palette.win}1a`,
  destructiveTint: `${palette.destructive}1a`,
  /** A selected chip: a stronger primary tint than `primaryTint`. */
  primaryTintStrong: `${palette.primary}33`,
  /**
   * Primary-colored text and icons on a primary tint or on `raised`, where plain `primary` falls under 4.5:1.
   * Fills, links on plain surfaces and the focus ring keep `primary`.
   */
  primaryText: "#86a4ff",
  /**
   * A solid POW fill that carries white text (white on `pow` is only 3.45:1). `pow` stays the color of POW
   * text, icons, the glow and the logo.
   */
  powFill: "#e11d48",
  /** The fill of a text field (and a select), a little darker than the card under it. */
  field: `${palette.background}99`,
  /** A control already filled with `raised` (a secondary button, a selected row) under the mouse. */
  raisedHover: "#1e2d5e",
  popover: "#131f41",
  overlay: "#00000099",
  avatarForeground: "#ffffff",
  /**
   * Player avatars: eight hues the app gives no meaning to (no red, green, coral or the primary blue), each at
   * least 4.5:1 against `avatarForeground`: violet, teal, magenta, olive, brown, slate, indigo, bronze.
   */
  /**
   * The light ends of the squares board's fills: a square of yours runs from `primaryLight` to `primary`, a
   * winning one from `winLight` to `win`, both under `primaryForeground` ink (5:1 and up at every stop).
   */
  primaryLight: "#86a4ff",
  winLight: "#7debb9",
  /** The band of light that sweeps across a winning square, and its clear edges. */
  sheen: "#ffffff66",
  sheenClear: "#ffffff00",
  avatars: ["#7c3aed", "#0e7490", "#a21caf", "#4d7c0f", "#78350f", "#475569", "#4338ca", "#a16207"],
};
export const fonts = {
  body: "Barlow",
  medium: "BarlowMedium",
  semibold: "BarlowSemiBold",
  bold: "BarlowSemiBold",
  display: "BarlowCondensed",
  displaySemibold: "BarlowCondensedSemibold",
  displayBold: "BarlowCondensed",
  displayExtraBold: "BarlowCondensedExtraBold",
};

/**
 * Digits of one width, so numbers line up. Tabular where numbers stack in a column, sit in a row of peers or
 * change in place (a table, a score, a countdown); proportional for a single big value standing alone (a stat
 * tile, a title).
 */
export const tabular = { fontVariant: ["tabular-nums"] } as const;

/**
 * The text styles: font, size, line height and, for the display faces, tracking and capitals. No color, so
 * they spread into any style. Display (Barlow Condensed capitals) for titles, team names, scores and big
 * numbers; Barlow in sentence case for everything else (see AGENTS.md, Design).
 */
export const type = {
  hero: {
    fontFamily: fonts.displayExtraBold,
    fontSize: 48,
    lineHeight: 48,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    fontFamily: fonts.displayExtraBold,
    fontSize: 36,
    lineHeight: 36,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  heading: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  subheading: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  tag: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    lineHeight: 18,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  stat: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 32 },
  statSmall: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 24 },
  cardTitle: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  micro: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
} as const;

/** The spacing scale, for gaps, padding and margins. */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  "2xl": 20,
  "3xl": 24,
  "4xl": 32,
  "5xl": 48,
} as const;

/**
 * Corner radii: `md` controls, `lg` team and POW buttons, `xl` cards, `sheet` bottom sheets, `full` badges and
 * pills. Pass one through `corner` to get iPhone's continuous corners where they show.
 */
export const radius = { xs: 4, sm: 6, md: 10, lg: 12, xl: 16, sheet: 22, full: 999 } as const;

/** A corner radius, continuous (the iPhone's squircle) from 12px up, where the difference shows. Harmless on the web. */
export const corner = (r: number): { borderRadius: number; borderCurve?: "continuous" } =>
  r >= 12 ? { borderRadius: r, borderCurve: "continuous" } : { borderRadius: r };

/** A page's frame: side and top padding, the gap between its sections, the bottom padding, and card padding. */
export const layout = {
  pageX: 16,
  pageTop: 20,
  pageGap: 20,
  pageBottom: 32,
  cardPad: 16,
  cardGap: 12,
  densePad: 12,
} as const;

/** The widest a page's content grows: most pages, reading text, a form, the sign-in card, the signed-out home. */
export const widths = { page: 896, reading: 720, form: 512, auth: 416, landing: 1120 } as const;

/**
 * Shadows, as `boxShadow` strings (React Native and react-native-web both draw them). Only for what floats over
 * the page: surfaces themselves are told apart by fill. `sheet` and `bar` fall upward, from something pinned to
 * the bottom.
 */
export const elevation = {
  /** The banner, a floating pill. */
  float: "0 4px 16px #00000066",
  /** A menu or popover. */
  popover: "0 8px 24px #00000066",
  /** A dialog. */
  dialog: "0 16px 48px #00000080",
  /** A bottom sheet. */
  sheet: "0 -8px 32px #00000066",
  /** A save bar or reply bar pinned to the bottom. */
  bar: "0 -8px 24px #00000059",
  /** A primary button or selected pick, lifted a little. */
  glowPrimary: `0 2px 8px ${palette.primary}40`,
  /** A winning square, lifted a little. */
  glowWin: `0 2px 8px ${palette.win}59`,
  /** A held square's lit top edge, brighter than a card's (`cardEdge`), so the tile reads as glossy. */
  squareEdge: "inset 0 1px 0 #ffffff33",
  /** The Pick of the Week, lifted a little. */
  glowPow: `0 2px 8px ${palette.pow}4d`,
  /**
   * A card's lit top edge: one pixel of light inside its top, clearest on the rounded corners, so the card reads
   * as a surface catching the light rather than a flat fill. A light edge, not an outline: nothing on the other
   * three sides.
   */
  cardEdge: "inset 0 1px 0 #ffffff0a",
} as const;
