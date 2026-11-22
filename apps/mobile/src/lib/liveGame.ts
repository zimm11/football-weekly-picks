import type { Game, GameLive, WeekView } from "@picks/shared";
import { gameLocked } from "./pickDraft";
import { ordinal } from "./weekPresentation";

/**
 * How long a live score is shown after the `GET /weeks/:id` answer that carried it. The pick sheet asks again
 * every minute while a game is under way and the server's copy of the feed is up to a minute old, so an answer
 * older than this means the asking stopped (no connection, the app asleep): the score would be stale, so the
 * game reads as locked again until a fresh answer comes.
 */
export const LIVE_FRESH_MS = 3 * 60_000;

/** The live state of an open week's games, from one `GET /weeks/:id` answer, and when it arrived. */
export type LiveScores = { at: Date; byGameId: ReadonlyMap<string, GameLive> };

const STATES = new Set<GameLive["state"]>(["playing", "halftime", "end_of_period"]);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * A game's `live` as the app can trust it, or null: both scores whole numbers, a period of 1 or more (else
 * null), a clock with something in it (else null), and a state it doesn't know read as being played.
 */
export function cleanLive(live: unknown): GameLive | null {
  if (!live || typeof live !== "object") return null;
  const value = live as Partial<Record<keyof GameLive, unknown>>;
  if (!isCount(value.homeScore) || !isCount(value.awayScore)) return null;
  const clock = typeof value.clock === "string" ? value.clock.trim() : "";
  return {
    homeScore: value.homeScore,
    awayScore: value.awayScore,
    period: isCount(value.period) && value.period > 0 ? value.period : null,
    clock: clock || null,
    state: STATES.has(value.state as GameLive["state"]) ? (value.state as GameLive["state"]) : "playing",
  };
}

/**
 * The live state in a `GET /weeks/:id` answer, stamped with when it arrived. Only from that answer: the load
 * cache and a pick save's response are any age, so they never set it. Nothing for a week that isn't open, or
 * for a game that already has a result.
 */
export function liveScores(view: Pick<WeekView, "status" | "games">, at: Date): LiveScores {
  const byGameId = new Map<string, GameLive>();
  if (view.status === "open")
    for (const game of view.games) {
      const live = cleanLive(game.live);
      if (live && game.homeScore === null && game.awayScore === null) byGameId.set(game.id, live);
    }
  return { at, byGameId };
}

/**
 * What the pick sheet shows as live for a game right now, or null: only a game with no result that has locked
 * by `now`, from an answer less than `LIVE_FRESH_MS` old. That one check covers a game gone final, a kickoff
 * moved later, a game removed, another week's answer, and a connection that died. An answer stamped that far
 * ahead of `now` (the device's clock was set back) is no fresher, so it is dropped too.
 */
export function liveFor(game: Game, scores: LiveScores | undefined, now: Date): GameLive | null {
  if (!scores || Math.abs(now.getTime() - scores.at.getTime()) >= LIVE_FRESH_MS) return null;
  if (game.homeScore !== null || game.awayScore !== null || !gameLocked(game, now)) return null;
  return scores.byGameId.get(game.id) ?? null;
}

/** A period as shown ("Q3", "OT", "2OT") and as said ("3rd quarter", "overtime", "2nd overtime"). */
function periodWords(period: number) {
  if (period <= 4) return { shown: `Q${period}`, spoken: `${ordinal(period)} quarter` };
  const overtime = period - 4;
  return overtime === 1
    ? { shown: "OT", spoken: "overtime" }
    : { shown: `${overtime}OT`, spoken: `${ordinal(overtime)} overtime` };
}

/**
 * Where a live game stands, as shown ("Q3 4:12", "Halftime", "End of Q1", "OT 2:10") and as said to a screen
 * reader ("3rd quarter, 4:12 left"). `shown` is null when the feed says nothing beyond being under way.
 */
export function liveClock(live: Pick<GameLive, "period" | "clock" | "state">): {
  shown: string | null;
  spoken: string;
} {
  const { period, clock } = live;
  const words = period === null ? null : periodWords(period);
  if (live.state === "halftime" || (live.state === "end_of_period" && period === 2))
    return { shown: "Halftime", spoken: "halftime" };
  if (live.state === "end_of_period") {
    if (!words) return { shown: "End of quarter", spoken: "end of a quarter" };
    return {
      shown: `End of ${words.shown}`,
      spoken: period === 5 ? "end of overtime" : `end of the ${words.spoken}`,
    };
  }
  // Being played, or a state this app doesn't know.
  if (words && clock) return { shown: `${words.shown} ${clock}`, spoken: `${words.spoken}, ${clock} left` };
  if (words) return { shown: words.shown, spoken: words.spoken };
  if (clock) return { shown: clock, spoken: `${clock} left` };
  return { shown: null, spoken: "in progress" };
}

/** The opened card's live line in words, for its accessible name: "Live: DAL 14, PHI 10, 3rd quarter, 4:12 left". */
export const liveLabel = (game: Pick<Game, "homeTeam" | "awayTeam">, live: GameLive) =>
  `Live: ${game.awayTeam} ${live.awayScore}, ${game.homeTeam} ${live.homeScore}, ${liveClock(live).spoken}`;
