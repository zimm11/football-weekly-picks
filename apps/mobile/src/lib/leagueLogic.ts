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

export type GameDraft = { changes?: import("@picks/shared").UpdateGame; problem?: string };
/** Validate a native game row before batching requests. Null scores must always travel as a pair. */
export function gameChanges(
  game: import("@picks/shared").Game,
  fields: { spread: string; points: string; kickoff: string; homeScore: string; awayScore: string },
  timeZone: string,
  status: string,
): GameDraft {
  const changes: import("@picks/shared").UpdateGame = {};
  for (const field of ["spread", "points"] as const) {
    const value = fields[field].trim();
    if (!value) {
      if (game[field] !== null)
        return { problem: `Enter ${field} for ${game.awayTeam} at ${game.homeTeam}.` };
    } else if (Number(value) !== game[field]) changes[field] = Number(value);
  }
  const kickoff = parseLeagueKickoff(fields.kickoff, timeZone);
  if (!kickoff) return { problem: `Enter a valid kickoff for ${game.awayTeam} at ${game.homeTeam}.` };
  if (kickoff.getTime() !== new Date(game.kickoff).getTime()) changes.kickoff = kickoff.toISOString();
  if (status === "open") {
    const home = fields.homeScore.trim() ? Number(fields.homeScore) : null,
      away = fields.awayScore.trim() ? Number(fields.awayScore) : null;
    if ((home === null) !== (away === null))
      return { problem: `Enter both scores for ${game.awayTeam} at ${game.homeTeam}, or neither.` };
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
