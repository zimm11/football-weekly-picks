import { updateGameSchema, zonedParts, zonedTimeToUtc } from "@picks/shared";

/** Resolve typed league wall time, refusing impossible dates and DST gaps. */
export function parseLeagueKickoff(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(zonedTimeToUtc(year, month, day, hour, timeZone).getTime() + minute * 60_000);
  const p = zonedParts(date, timeZone);
  return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute
    ? date
    : null;
}

/** What a field that takes a whole number keeps of what was typed or pasted: its digits. */
export const onlyDigits = (text: string) => text.replace(/\D/g, "");

/**
 * A typed spread as a number, or null when it isn't one ("abc", "-"). A typographic minus (−, –, —), which
 * iPhone keyboards and pasted text bring, reads as "-"; a blank is null too.
 */
export function parseSpread(text: string): number | null {
  const value = text.trim().replace(/^[\u2212\u2013\u2014]/, "-");
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export const SPREAD_PROBLEM = "Enter the home spread as a number, like -3.5.";
export const POINTS_PROBLEM = "Enter points as a whole number.";

/** A typed point value as a whole number, or null when it isn't one ("abc", "2.5", blank). */
export function parsePoints(text: string): number | null {
  const value = text.trim();
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

export type GameDraft = { changes?: import("@picks/shared").UpdateGame; problem?: string };
/** Validate a native game row before batching requests. Null scores must always travel as a pair. */
export function gameChanges(
  game: import("@picks/shared").Game,
  fields: { spread: string; points: string; kickoff: string; homeScore: string; awayScore: string },
  timeZone: string,
  status: string,
): GameDraft {
  const changes: import("@picks/shared").UpdateGame = {};
  const name = `${game.awayTeam} at ${game.homeTeam}`;
  for (const field of ["spread", "points"] as const) {
    const value = fields[field].trim();
    if (!value) {
      if (game[field] !== null) return { problem: `Enter ${field} for ${name}.` };
      continue;
    }
    const n = field === "spread" ? parseSpread(value) : parsePoints(value);
    // Checked before the schema, whose own words for "abc" are about NaN.
    if (n === null)
      return {
        problem:
          field === "spread"
            ? `Enter the home spread for ${name} as a number, like -3.5.`
            : `Enter points for ${name} as a whole number.`,
      };
    if (n !== game[field]) changes[field] = n;
  }
  const kickoff = parseLeagueKickoff(fields.kickoff, timeZone);
  if (!kickoff) return { problem: `Enter a valid kickoff for ${game.awayTeam} at ${game.homeTeam}.` };
  if (kickoff.getTime() !== new Date(game.kickoff).getTime()) changes.kickoff = kickoff.toISOString();
  if (status === "open") {
    const home = fields.homeScore.trim() ? parsePoints(fields.homeScore) : null,
      away = fields.awayScore.trim() ? parsePoints(fields.awayScore) : null;
    if ((fields.homeScore.trim() && home === null) || (fields.awayScore.trim() && away === null))
      return { problem: `Enter the scores for ${name} as whole numbers.` };
    if ((home === null) !== (away === null)) return { problem: `Enter both scores for ${name}, or neither.` };
    if (home !== game.homeScore || away !== game.awayScore) {
      changes.homeScore = home;
      changes.awayScore = away;
    }
  }
  const parsed = updateGameSchema.safeParse(changes);
  return parsed.success
    ? { changes: parsed.data }
    : { problem: parsed.error.issues[0]?.message ?? "Check game changes." };
}
