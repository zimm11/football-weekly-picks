import {
  type CreateLeagueResult,
  LEAGUE_TYPES,
  type LeagueManagement,
  type LeagueSummary,
  type LeagueType,
  managementChoices,
  type PlayoffFormat,
} from "@picks/shared";

/*
 * The New league form's state and the request it sends, kept pure so the type step's rules are tested without a
 * screen: the four types (weekly first and preselected), how a weekly league is run (Automatic preselected, or
 * Hands-on), each type's settings, and "Start with members from".
 */

export type NewLeagueDraft = {
  type: LeagueType;
  name: string;
  timeZone: string;
  management: LeagueManagement;
  /** Playoff pick'em. */
  format: PlayoffFormat;
  /** Survivor. */
  lives: number;
  /** Survivor: null means the next week with no kickoff yet. */
  startWeek: number | null;
  /** A league the player is an admin of, whose members join the new one. Null: nobody. */
  copyMembersFrom: string | null;
};

export function initialDraft(timeZone: string): NewLeagueDraft {
  return chooseType(
    {
      type: "weekly",
      name: "",
      timeZone,
      management: "manual",
      format: "traditional",
      lives: 1,
      startWeek: null,
      copyMembersFrom: null,
    },
    "weekly",
  );
}

/** Switches the draft to `type`, with that type's default way to run it. */
export function chooseType(draft: NewLeagueDraft, type: LeagueType): NewLeagueDraft {
  const [management = "auto"] = managementChoices(type);
  return { ...draft, type, management };
}

/** The type cards to show, in the registry's order (weekly first). */
export const typeChoices = (): readonly LeagueType[] => LEAGUE_TYPES;

/** The leagues a player may copy members from: those they are an admin of. */
export const copyableLeagues = (leagues: LeagueSummary[]) => leagues.filter((l) => l.role === "admin");

/** The body of `POST /leagues` for this draft. */
export function newLeagueBody(draft: NewLeagueDraft) {
  const settings =
    draft.type === "playoff"
      ? { format: draft.format }
      : draft.type === "survivor"
        ? { lives: draft.lives, ...(draft.startWeek !== null && { startWeek: draft.startWeek }) }
        : undefined;
  return {
    name: draft.name,
    timeZone: draft.timeZone,
    type: draft.type,
    management: draft.management,
    ...(settings && { settings }),
    ...(draft.copyMembersFrom && { copyMembersFrom: draft.copyMembersFrom }),
  };
}

/** What to tell the creator about members who couldn't be copied in, or null when everyone came along. */
export function skippedNotice(
  result: Pick<CreateLeagueResult, "skipped">,
  maxLeagues: number,
): string | null {
  const limit = result.skipped.filter((s) => s.reason === "player_limit").map((s) => s.displayName);
  const full = result.skipped.filter((s) => s.reason === "league_full").map((s) => s.displayName);
  const parts = [
    limit.length &&
      `${listNames(limit)} ${limit.length === 1 ? "is" : "are"} already in ${maxLeagues} leagues`,
    full.length && `${listNames(full)} didn't fit: the league is full`,
  ].filter(Boolean);
  return parts.length ? `League created. Not added: ${parts.join("; ")}.` : null;
}

function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
