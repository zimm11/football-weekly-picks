import { z } from "zod";
import { type PlayoffSettings, playoffSettingsSchema } from "./playoff";
import { type SquaresSettings, squaresSettingsSchema } from "./squares";
import { type SurvivorSettings, survivorSettingsSchema } from "./survivor";

/*
 * The league type registry. Every league has one type, fixed when it is created; this says what each type owns:
 * its name and description, its settings, the NFL weeks it covers, whether it runs itself, when other players'
 * picks become visible, and its tabs. The API, the app and the scheduled jobs all read the same entry.
 *
 * Adding a type adds an entry here and its own module per layer (rules in packages/shared/src/<type>.ts, routes in
 * apps/api/src/<type>.ts, automation in apps/api/src/automation/<type>.ts, screens in apps/mobile/src/screens/<type>/).
 */

/** Also in the database (`LEAGUE_TYPE_VALUES` in packages/db/src/schema.ts), held equal by a test. */
export const LEAGUE_TYPES = ["weekly", "playoff", "squares", "survivor"] as const;
export type LeagueType = (typeof LEAGUE_TYPES)[number];

/** auto: the feed imports, opens and finalizes each week by itself. manual: the admins do (hands-on). */
export const LEAGUE_MANAGEMENT = ["auto", "manual"] as const;
export type LeagueManagement = (typeof LEAGUE_MANAGEMENT)[number];

/**
 * Weekly pick'em's season settings. `startWeek`: where an automatic season began (Start season); it then runs
 * through Week 18. Hands-on seasons have none.
 */
export const weeklySettingsSchema = z.object({ startWeek: z.int().min(1).max(18).optional() });
export type WeeklySettings = z.infer<typeof weeklySettingsSchema>;

export type LeagueSettings = {
  weekly: WeeklySettings;
  playoff: PlayoffSettings;
  squares: SquaresSettings;
  survivor: SurvivorSettings;
};

/** Every tab a league can have. Each type lists its own, in order (`LeagueTypeInfo.tabs`). */
export const LEAGUE_TABS = {
  picks: { title: "Picks", icon: "football" },
  pick: { title: "Pick", icon: "target" },
  board: { title: "Boards", icon: "grid" },
  results: { title: "Results", icon: "list" },
  standings: { title: "Standings", icon: "trophy" },
  messages: { title: "Messages", icon: "chat" },
  league: { title: "League", icon: "users" },
} as const;
export type LeagueTabId = keyof typeof LEAGUE_TABS;

/** When other players can see a player's pick: when the week (or round) is final, at the picked game's kickoff, or always. */
export type RevealPoint = "final" | "kickoff" | "always";

export type LeagueTypeInfo<T extends LeagueType = LeagueType> = {
  type: T;
  name: string;
  /** One line for the New league card. */
  description: string;
  /** A name in the app's icon set (apps/mobile/src/components/Icon.tsx). */
  icon: "football" | "trophy" | "grid" | "heart";
  /** What one unit of play is called: the selector and labels use it. */
  unit: "week" | "round" | "board";
  /** Validates and fills in a season's settings (`seasons.settings`). */
  settings: z.ZodType<LeagueSettings[T]>;
  /** The NFL weeks the type plays, on the 1–22 line (see `weekLabel`). Null for squares: any one game. */
  weeks: { first: number; last: number } | null;
  /**
   * Whether a new league gets its first season, with the settings New league asks for, when it is created.
   * Weekly pick'em's season starts with its first week (or Start season), and squares has boards, not seasons.
   */
  seasonOnCreate: boolean;
  /** How the league can be run, the default for a new league first. Only weekly pick'em offers hands-on. */
  management: readonly LeagueManagement[];
  /** When another player's pick becomes visible. */
  reveal: RevealPoint;
  /** The league's tabs in order. The first is the league's own URL, `/leagues/:id`. */
  tabs: readonly LeagueTabId[];
};

export const LEAGUE_TYPE_INFO: { [T in LeagueType]: LeagueTypeInfo<T> } = {
  weekly: {
    type: "weekly",
    name: "Weekly pick'em",
    description: "Pick every game against the spread, every week of the regular season.",
    icon: "football",
    unit: "week",
    settings: weeklySettingsSchema,
    weeks: { first: 1, last: 18 },
    seasonOnCreate: false,
    management: ["auto", "manual"],
    reveal: "final",
    tabs: ["picks", "results", "standings", "messages", "league"],
  },
  playoff: {
    type: "playoff",
    name: "Playoff pick'em",
    description: "Pick every playoff game against the spread, Wild Card to Super Bowl, for one champion.",
    icon: "trophy",
    unit: "round",
    settings: playoffSettingsSchema,
    weeks: { first: 19, last: 22 },
    seasonOnCreate: true,
    management: ["auto"],
    reveal: "final",
    tabs: ["picks", "results", "standings", "messages", "league"],
  },
  squares: {
    type: "squares",
    name: "Squares",
    description: "Claim squares on a 10 by 10 board for one game. Each quarter has a winner.",
    icon: "grid",
    unit: "board",
    settings: squaresSettingsSchema,
    weeks: null,
    seasonOnCreate: false,
    management: ["auto"],
    reveal: "always",
    tabs: ["board", "messages", "league"],
  },
  survivor: {
    type: "survivor",
    name: "Survivor",
    description: "Pick one team to win each week, never the same team twice. Last player standing wins.",
    icon: "heart",
    unit: "week",
    settings: survivorSettingsSchema,
    weeks: { first: 1, last: 22 },
    seasonOnCreate: true,
    management: ["auto"],
    reveal: "kickoff",
    tabs: ["pick", "standings", "messages", "league"],
  },
};

export const leagueTypeInfo = <T extends LeagueType>(type: T): LeagueTypeInfo<T> =>
  LEAGUE_TYPE_INFO[type] as unknown as LeagueTypeInfo<T>;

// ---------- Management ----------

/** Whether a league of `type` can be run the `management` way (on create, or by switching). */
export function mayUseManagement(type: LeagueType, management: LeagueManagement): boolean {
  return LEAGUE_TYPE_INFO[type].management.includes(management);
}

/** How a new league of `type` can be run, the default first. One choice means there is nothing to ask. */
export function managementChoices(type: LeagueType): LeagueManagement[] {
  return [...LEAGUE_TYPE_INFO[type].management];
}

/** What a create request without `management` means: hands-on for weekly (the old web build), else automatic. */
export const defaultManagement = (type: LeagueType): LeagueManagement =>
  type === "weekly" ? "manual" : "auto";

// ---------- Settings and weeks ----------

/** A season's settings for `type` with every default filled in. Throws (a ZodError) on invalid input. */
export function parseSeasonSettings<T extends LeagueType>(type: T, value: unknown): LeagueSettings[T] {
  return leagueTypeInfo(type).settings.parse(value ?? {});
}

/** A stored season's settings, read leniently: anything that no longer parses falls back to the defaults. */
export function readSeasonSettings<T extends LeagueType>(type: T, value: unknown): LeagueSettings[T] {
  const parsed = leagueTypeInfo(type).settings.safeParse(value ?? {});
  return parsed.success ? parsed.data : leagueTypeInfo(type).settings.parse({});
}

export const defaultSeasonSettings = <T extends LeagueType>(type: T): LeagueSettings[T] =>
  parseSeasonSettings(type, {});

/** Whether `type` plays NFL week `number` (1–22). Squares plays single games, not weeks. */
export function coversWeek(type: LeagueType, number: number): boolean {
  const weeks = LEAGUE_TYPE_INFO[type].weeks;
  return !!weeks && number >= weeks.first && number <= weeks.last;
}

// ---------- Tabs ----------

/** The URL segment under `/leagues/:id` for a tab: "" for the type's first tab, else the tab's id. */
export function leagueTabPath(type: LeagueType, tab: LeagueTabId): string {
  return LEAGUE_TYPE_INFO[type].tabs[0] === tab ? "" : tab;
}

/**
 * The tab a URL segment under `/leagues/:id` opens for this type: "" is the first tab. Null when the type has no
 * such tab, which the app shows as not found (a squares league has no Results).
 */
export function leagueTabFromPath(type: LeagueType, segment: string): LeagueTabId | null {
  const tabs = LEAGUE_TYPE_INFO[type].tabs;
  if (segment === "") return tabs[0] ?? null;
  return tabs.find((tab) => tab === segment && tab !== tabs[0]) ?? null;
}
