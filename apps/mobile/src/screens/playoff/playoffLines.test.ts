import type { GuillotineStatus, WeekView } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { guillotineBetweenRounds, guillotineLine, playoffWaiting, roundInSentence } from "./playoffLines";

const game = (id: string, away: string, home: string, scores: [number, number] | null = null) => ({
  id,
  awayTeam: away,
  homeTeam: home,
  kickoff: "2027-01-16T21:30:00.000Z",
  spread: -3,
  points: 1,
  awayScore: scores?.[0] ?? null,
  homeScore: scores?.[1] ?? null,
});
const me = (status: Partial<GuillotineStatus> = {}): GuillotineStatus => ({
  userId: "me",
  state: "in",
  outIn: null,
  reason: null,
  ...status,
});
const sheet = (
  changes: Partial<Pick<WeekView, "number" | "games" | "myPicks" | "playoff">> = {},
): Pick<WeekView, "number" | "games" | "myPicks" | "playoff"> => ({
  number: 19,
  games: [game("g1", "MIA", "BUF"), game("g2", "GB", "PHI")],
  myPicks: [],
  playoff: { format: "guillotine", me: me(), mayPick: true },
  ...changes,
});

describe("the Guillotine status line", () => {
  it("shows only in a Guillotine round", () => {
    expect(guillotineLine(sheet({ playoff: { format: "traditional", me: null, mayPick: true } }))).toBeNull();
    expect(guillotineLine(sheet({ playoff: null }))).toBeNull();
  });

  it("asks for a POW until one is saved, then follows it", () => {
    expect(guillotineLine(sheet())).toEqual({
      out: false,
      title: "You're in",
      detail: "Choose a POW: if it loses, or you skip it, you're out from the next round.",
    });
    // Picks without a POW still ask for one.
    expect(
      guillotineLine(sheet({ myPicks: [{ gameId: "g1", side: "home", isPow: false }] }))?.detail,
    ).toMatch(/^Choose a POW/);
    const saved = sheet({
      myPicks: [
        { gameId: "g1", side: "home", isPow: true },
        { gameId: "g2", side: "away", isPow: false },
      ],
    });
    expect(guillotineLine(saved)).toEqual({
      out: false,
      title: "You're in",
      detail: "Your POW: Bills. If it loses, you're out from the next round.",
    });
    expect(guillotineLine(sheet({ myPicks: [{ gameId: "g2", side: "away", isPow: true }] }))?.detail).toBe(
      "Your POW: Packers. If it loses, you're out from the next round.",
    );
  });

  it("says a POW that won, or pushed, keeps the player in", () => {
    const pow = [{ gameId: "g1", side: "home" as const, isPow: true }];
    // Bills -3 win by 7: covered.
    const won = sheet({ games: [game("g1", "MIA", "BUF", [17, 24])], myPicks: pow });
    expect(guillotineLine(won)?.detail).toBe("Your POW (Bills) won: on to the next round.");
    // Bills -3 win by exactly 3: a push, which survives.
    const pushed = sheet({ games: [game("g1", "MIA", "BUF", [17, 20])], myPicks: pow });
    expect(guillotineLine(pushed)?.detail).toBe(
      "Your POW (Bills) pushed, and a push sends you on to the next round.",
    );
  });

  it("says why a player is out, and what is left to them", () => {
    // Their POW lost this round: the rest of the round still counts.
    const thisRound = sheet({
      playoff: {
        format: "guillotine",
        me: me({ state: "out", outIn: 19, reason: "pow_lost" }),
        mayPick: true,
      },
    });
    expect(guillotineLine(thisRound)).toEqual({
      out: true,
      title: "You're out after the Wild Card round",
      detail: "Your POW lost in the Wild Card round. Finish this round's picks: they still count.",
    });
    // Out since an earlier round: read-only, but for the Super Bowl guess.
    const later = sheet({
      number: 22,
      playoff: {
        format: "guillotine",
        me: me({ state: "out", outIn: 20, reason: "no_pow" }),
        mayPick: false,
      },
    });
    expect(guillotineLine(later)).toEqual({
      out: true,
      title: "You're out of picking",
      detail:
        "You had no POW in the Divisional round. You keep your points and your place, and you can still guess the Super Bowl's total.",
    });
  });

  it("has no POW to talk about in the Super Bowl", () => {
    expect(guillotineLine(sheet({ number: 22 }))?.detail).toBe(
      "No POW in the Super Bowl: nobody goes out now. Your pick and your total guess decide the rest.",
    );
  });
});

describe("the Picks tab while no playoff round is open", () => {
  const round = (number: number, status: "draft" | "open" | "final" = "final") => ({
    year: 2026,
    number,
    status,
  });

  it("names the round that opens next", () => {
    expect(playoffWaiting([])).toEqual({
      over: false,
      next: 19,
      title: "No round is open",
      detail:
        "The Wild Card round opens by itself once its games and lines are posted, after the regular season ends.",
    });
    expect(playoffWaiting([round(19)])).toMatchObject({
      next: 20,
      detail: "The Divisional round opens once its games and lines are posted.",
    });
    // A draft of the next round (a commissioner sees it) changes nothing.
    expect(playoffWaiting([round(20, "draft"), round(19)]).next).toBe(20);
    expect(playoffWaiting([round(19), round(20)]).detail).toBe(
      "The Conference round opens once its games and lines are posted.",
    );
    expect(playoffWaiting([round(19), round(20), round(21)])).toMatchObject({
      next: 22,
      detail: "The Super Bowl opens once its game and line are posted.",
    });
  });

  it("says the playoffs are over once all four rounds are final", () => {
    expect(playoffWaiting([22, 21, 20, 19].map((n) => round(n)))).toEqual({
      over: true,
      next: null,
      title: "The 2026 playoffs are over",
      detail: "The champion and everyone's final place are on Standings.",
    });
  });

  it("tells a player the guillotine put out that they are out", () => {
    expect(guillotineBetweenRounds({ state: "out", outIn: 19, reason: "pow_lost" }, 20, 1)).toEqual({
      out: true,
      title: "You're out of picking",
      detail:
        "Your POW lost in the Wild Card round. You keep your points and your place, and you can still guess the Super Bowl's total.",
    });
    expect(guillotineBetweenRounds({ state: "out", outIn: 20, reason: "no_pow" }, 22, 3)?.detail).toMatch(
      /^You had no POW in the Divisional round\./,
    );
    // Still in: said once there is a round behind them, with what the next one asks.
    expect(guillotineBetweenRounds({ state: "in", outIn: null, reason: null }, 20, 1)).toEqual({
      out: false,
      title: "You're in",
      detail: "Choose a POW in the Divisional round: if it loses, or you skip it, you're out.",
    });
    expect(guillotineBetweenRounds({ state: "in", outIn: null, reason: null }, 22, 3)?.detail).toBe(
      "You made it to the Super Bowl: nobody goes out there.",
    );
    // Before the playoffs begin there is nothing to say; nor in a Traditional league, or once they are over.
    expect(guillotineBetweenRounds({ state: "in", outIn: null, reason: null }, 19, 0)).toBeNull();
    expect(guillotineBetweenRounds(null, 20, 1)).toBeNull();
    expect(guillotineBetweenRounds({ state: "out", outIn: 19, reason: "pow_lost" }, null, 4)).toBeNull();
  });

  it("names rounds inside a sentence", () => {
    expect(roundInSentence(19)).toBe("the Wild Card round");
    expect(roundInSentence(21)).toBe("the Conference round");
    expect(roundInSentence(22)).toBe("the Super Bowl");
  });
});
