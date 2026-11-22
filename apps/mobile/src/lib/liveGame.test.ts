import type { Game, GameLive, WeekView } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { cleanLive, LIVE_FRESH_MS, liveClock, liveFor, liveLabel, liveScores } from "./liveGame";

const KICKOFF = "2026-11-16T00:00:00Z";
const playing: GameLive = { homeScore: 10, awayScore: 14, period: 3, clock: "4:12", state: "playing" };
const game = (id: string, extra: Partial<Game> = {}): Game => ({
  id,
  homeTeam: "PHI",
  awayTeam: "DAL",
  kickoff: KICKOFF,
  spread: -3.5,
  points: 2,
  homeScore: null,
  awayScore: null,
  ...extra,
});
const week = (games: Game[], status: WeekView["status"] = "open") => ({ status, games });
const arrived = new Date("2026-11-16T01:30:00Z");
const later = (ms: number) => new Date(arrived.getTime() + ms);

describe("the live state a week's answer carries", () => {
  it("keeps each game being played by its id, stamped with when the answer came", () => {
    const scores = liveScores(week([game("a", { live: playing }), game("b")]), arrived);
    expect(scores.at).toBe(arrived);
    expect([...scores.byGameId]).toEqual([["a", playing]]);
  });
  it("takes nothing from a week that isn't open, or for a game with a result", () => {
    expect(liveScores(week([game("a", { live: playing })], "final"), arrived).byGameId.size).toBe(0);
    expect(liveScores(week([game("a", { live: playing })], "draft"), arrived).byGameId.size).toBe(0);
    const scored = game("a", { live: playing, homeScore: 20, awayScore: 17 });
    expect(liveScores(week([scored]), arrived).byGameId.size).toBe(0);
  });
  it("treats an older API's missing field, and null, as not live", () => {
    expect(liveScores(week([game("a"), game("b", { live: null })]), arrived).byGameId.size).toBe(0);
  });
  it("drops a live state it can't trust, and reads what it doesn't know as being played", () => {
    expect(cleanLive({ ...playing, homeScore: null })).toBeNull();
    expect(cleanLive({ ...playing, awayScore: "14" })).toBeNull();
    expect(cleanLive({ ...playing, homeScore: -1 })).toBeNull();
    expect(cleanLive({ ...playing, homeScore: 1.5 })).toBeNull();
    expect(cleanLive("live")).toBeNull();
    expect(cleanLive({ ...playing, state: "delayed" })).toEqual(playing);
    expect(cleanLive({ ...playing, period: 0, clock: "  " })).toEqual({
      ...playing,
      period: null,
      clock: null,
    });
    expect(cleanLive({ ...playing, period: "3", clock: 412 })).toEqual({
      ...playing,
      period: null,
      clock: null,
    });
  });
});

describe("whether the pick sheet shows a game as live", () => {
  const scores = liveScores(week([game("a", { live: playing })]), arrived);
  it("shows a locked game with no result from a fresh answer", () => {
    expect(liveFor(game("a"), scores, arrived)).toEqual(playing);
    expect(liveFor(game("a"), scores, later(LIVE_FRESH_MS - 1))).toEqual(playing);
  });
  it("stops once the answer is a few minutes old: the reloads stopped and the score would be stale", () => {
    expect(liveFor(game("a"), scores, later(LIVE_FRESH_MS))).toBeNull();
    expect(liveFor(game("a"), scores, later(60 * 60_000))).toBeNull();
  });
  it("stops when the clock was set back past the answer's stamp, which would otherwise never age", () => {
    expect(liveFor(game("a"), scores, later(-1000))).toEqual(playing);
    expect(liveFor(game("a"), scores, later(-LIVE_FRESH_MS))).toBeNull();
  });
  it("stops the moment the game has a result, whatever the answer said", () => {
    expect(liveFor(game("a", { homeScore: 20, awayScore: 17 }), scores, arrived)).toBeNull();
    expect(liveFor(game("a", { homeScore: 20 }), scores, arrived)).toBeNull();
  });
  it("stops for a game whose kickoff moved later, and for one the answer doesn't name", () => {
    expect(liveFor(game("a", { kickoff: "2026-11-16T03:00:00Z" }), scores, arrived)).toBeNull();
    // A game removed from the week, or another week's games.
    expect(liveFor(game("other"), scores, arrived)).toBeNull();
  });
  it("shows nothing before any answer has come", () => {
    expect(liveFor(game("a"), undefined, arrived)).toBeNull();
  });
});

describe("where a live game stands, in words", () => {
  const at = (state: GameLive["state"], period: number | null, clock: string | null = null) =>
    liveClock({ state, period, clock });
  it("says the quarter and the clock while it is being played", () => {
    expect(at("playing", 3, "4:12")).toEqual({ shown: "Q3 4:12", spoken: "3rd quarter, 4:12 left" });
    expect(at("playing", 1, "15:00")).toEqual({ shown: "Q1 15:00", spoken: "1st quarter, 15:00 left" });
    expect(at("playing", 3)).toEqual({ shown: "Q3", spoken: "3rd quarter" });
  });
  it("says overtime, then which overtime", () => {
    expect(at("playing", 5, "2:10")).toEqual({ shown: "OT 2:10", spoken: "overtime, 2:10 left" });
    expect(at("playing", 6, "9:00")).toEqual({ shown: "2OT 9:00", spoken: "2nd overtime, 9:00 left" });
    expect(at("playing", 7)).toEqual({ shown: "3OT", spoken: "3rd overtime" });
  });
  it("says the breaks", () => {
    expect(at("halftime", 2)).toEqual({ shown: "Halftime", spoken: "halftime" });
    expect(at("end_of_period", 1)).toEqual({ shown: "End of Q1", spoken: "end of the 1st quarter" });
    expect(at("end_of_period", 3)).toEqual({ shown: "End of Q3", spoken: "end of the 3rd quarter" });
    // The end of the 2nd quarter is halftime, and of the 4th the end of regulation, before overtime.
    expect(at("end_of_period", 2)).toEqual({ shown: "Halftime", spoken: "halftime" });
    expect(at("end_of_period", 4)).toEqual({ shown: "End of Q4", spoken: "end of the 4th quarter" });
    expect(at("end_of_period", 5)).toEqual({ shown: "End of OT", spoken: "end of overtime" });
    expect(at("end_of_period", 6)).toEqual({ shown: "End of 2OT", spoken: "end of the 2nd overtime" });
  });
  it("ignores a clock at a break", () => {
    expect(at("halftime", 2, "0:00").shown).toBe("Halftime");
    expect(at("end_of_period", 1, "0:00").shown).toBe("End of Q1");
  });
  it("says what it can when the feed doesn't name the period", () => {
    expect(at("playing", null, "4:12")).toEqual({ shown: "4:12", spoken: "4:12 left" });
    expect(at("playing", null)).toEqual({ shown: null, spoken: "in progress" });
    expect(at("halftime", null)).toEqual({ shown: "Halftime", spoken: "halftime" });
    expect(at("end_of_period", null)).toEqual({ shown: "End of quarter", spoken: "end of a quarter" });
  });
  it("reads a state it doesn't know as being played", () => {
    const unknown = { state: "delayed", period: 2, clock: "7:30" } as unknown as GameLive;
    expect(liveClock(unknown)).toEqual({ shown: "Q2 7:30", spoken: "2nd quarter, 7:30 left" });
  });
  it("names the live line in one sentence, away team first", () => {
    expect(liveLabel(game("a"), playing)).toBe("Live: DAL 14, PHI 10, 3rd quarter, 4:12 left");
    expect(liveLabel(game("a"), { ...playing, state: "halftime", clock: null, period: 2 })).toBe(
      "Live: DAL 14, PHI 10, halftime",
    );
  });
});
