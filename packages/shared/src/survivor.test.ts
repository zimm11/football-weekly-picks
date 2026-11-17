import { describe, expect, it } from "vitest";
import {
  checkSurvivorPick,
  type SurvivorGame,
  type SurvivorMember,
  type SurvivorPickInput,
  type SurvivorWeekInput,
  survivorEntrants,
  survivorOutcome,
  survivorReasonText,
  survivorStatus,
  usedTeams,
} from "./survivor";

const day = (n: number) => new Date(Date.UTC(2026, 8, 10 + n, 17));

/** A game in week `week`, kicking off on that week's Sunday; `score` [home, away] once it is final. */
function game(id: string, home: string, away: string, week: number, score?: [number, number]): SurvivorGame {
  return {
    id,
    homeTeam: home,
    awayTeam: away,
    kickoff: day(7 * (week - 1) + 3),
    homeScore: score?.[0] ?? null,
    awayScore: score?.[1] ?? null,
  };
}

function week(number: number, games: SurvivorGame[], status: "open" | "final" = "final"): SurvivorWeekInput {
  return { id: `w${number}`, number, status, games };
}

const pick = (number: number, userId: string, gameId: string, side: "home" | "away"): SurvivorPickInput => ({
  weekId: `w${number}`,
  userId,
  gameId,
  side,
});

const member = (userId: string, joinedAt = new Date("2026-08-01T00:00:00Z"), removedAt: Date | null = null) =>
  ({ userId, joinedAt, removedAt }) satisfies SurvivorMember;

const members = ["ann", "bob", "cat"].map((id) => member(id));

describe("survivor picks", () => {
  const slate = [game("g1", "CHI", "GB", 3), game("g2", "KC", "DEN", 3)];
  // Saturday of Week 3, before its Sunday games.
  const before = day(16);

  it("takes one team straight up from the week's slate", () => {
    const base = { weekNumber: 3, games: slate, existing: null, used: new Map(), now: before };
    expect(checkSurvivorPick({ ...base, pick: { gameId: "g1", side: "home" } })).toBeNull();
    expect(checkSurvivorPick({ ...base, pick: { gameId: "nope", side: "home" } })).toBe(
      "That game is not part of this week.",
    );
  });

  it("refuses a team used earlier in the season, naming the week", () => {
    expect(
      checkSurvivorPick({
        weekNumber: 3,
        games: slate,
        existing: null,
        pick: { gameId: "g1", side: "home" },
        used: new Map([["CHI", 1]]),
        now: before,
      }),
    ).toBe("You used the Bears in Week 1.");
    expect(
      checkSurvivorPick({
        weekNumber: 3,
        games: slate,
        existing: null,
        pick: { gameId: "g1", side: "home" },
        used: new Map([["CHI", 1]]),
        now: before,
        player: "Pat",
      }),
    ).toBe("Pat used the Bears in Week 1.");
  });

  it("locks a pick at its team's kickoff, and only moves it to a game still to start", () => {
    const thursday = { ...game("thu", "NYJ", "NE", 3), kickoff: day(14) };
    const games = [thursday, ...slate];
    const friday = day(15);
    // Picked Thursday's game, which has kicked off: it stays.
    expect(
      checkSurvivorPick({
        weekNumber: 3,
        games,
        existing: { gameId: "thu", side: "home" },
        pick: { gameId: "g1", side: "home" },
        used: new Map(),
        now: friday,
      }),
    ).toBe("Your pick is locked: Patriots at Jets has kicked off.");
    // Picked a Sunday game: it can move to another Sunday game, not to Thursday's.
    const sunday = {
      weekNumber: 3,
      games,
      existing: { gameId: "g1", side: "home" as const },
      used: new Map(),
    };
    expect(checkSurvivorPick({ ...sunday, pick: { gameId: "g2", side: "away" }, now: friday })).toBeNull();
    expect(checkSurvivorPick({ ...sunday, pick: { gameId: "thu", side: "away" }, now: friday })).toBe(
      "Patriots at Jets has already kicked off.",
    );
    // Saving the same pick again is fine even after kickoff.
    expect(
      checkSurvivorPick({
        weekNumber: 3,
        games,
        existing: { gameId: "thu", side: "home" },
        pick: { gameId: "thu", side: "home" },
        used: new Map(),
        now: friday,
      }),
    ).toBeNull();
  });

  it("resets the used teams at the Wild Card round", () => {
    const weeks = [
      week(17, [game("a", "CHI", "GB", 17, [20, 10])]),
      week(18, [game("b", "KC", "DEN", 18, [20, 10])]),
      week(19, [game("c", "BUF", "MIA", 19, [20, 10])]),
      week(20, [game("d", "CHI", "KC", 20)], "open"),
    ];
    const picks = [pick(17, "ann", "a", "home"), pick(18, "ann", "b", "home"), pick(19, "ann", "c", "home")];
    expect([...usedTeams(weeks, picks, "ann", 18)]).toEqual([["CHI", 17]]);
    // Week 20 counts only the postseason before it: the Bears and Chiefs are free again.
    expect([...usedTeams(weeks, picks, "ann", 20)]).toEqual([["BUF", 19]]);
    expect([...usedTeams(weeks, picks, "ann", 19)]).toEqual([]);
  });

  it("lets a player with no unused team on a playoff slate pick any team", () => {
    const superBowl = [game("sb", "KC", "PHI", 22)];
    const used = new Map([
      ["KC", 19],
      ["PHI", 20],
    ]);
    const base = { games: superBowl, existing: null, pick: { gameId: "sb", side: "home" as const }, used };
    const now = new Date(superBowl[0]?.kickoff.getTime() ?? 0);
    now.setUTCDate(now.getUTCDate() - 1);
    expect(checkSurvivorPick({ ...base, weekNumber: 22, now })).toBeNull();
    // In the regular season there is no such waiver.
    expect(checkSurvivorPick({ ...base, weekNumber: 12, now })).toBe("You used the Chiefs in Wild Card.");
    // With one unused team still to play, the used ones stay used.
    const one = new Map([["KC", 19]]);
    expect(checkSurvivorPick({ ...base, used: one, weekNumber: 22, now })).toBe(
      "You used the Chiefs in Wild Card.",
    );
  });
});

describe("survivor outcomes", () => {
  it("scores straight up, with a tie its own outcome", () => {
    expect(survivorOutcome({ homeScore: 24, awayScore: 17 }, "home")).toBe("won");
    expect(survivorOutcome({ homeScore: 24, awayScore: 17 }, "away")).toBe("lost");
    expect(survivorOutcome({ homeScore: 20, awayScore: 20 }, "home")).toBe("tie");
    expect(survivorOutcome({ homeScore: null, awayScore: null }, "home")).toBe("pending");
    expect(survivorReasonText({ kind: "lost", team: "CHI" })).toBe("Bears lost");
    expect(survivorReasonText({ kind: "missed" })).toBe("No pick");
  });
});

describe("survivor status", () => {
  const status = (weeks: SurvivorWeekInput[], picks: SurvivorPickInput[], lives = 1, list = members) =>
    survivorStatus({ startWeek: 1, lives, weeks, picks, members: list });

  it("puts out a loss, a tie and a missed pick, and crowns the last one in", () => {
    const weeks = [
      week(1, [game("a", "CHI", "GB", 1, [20, 10]), game("b", "KC", "DEN", 1, [17, 17])]),
      week(2, [game("c", "BUF", "MIA", 2)], "open"),
    ];
    const picks = [pick(1, "ann", "a", "home"), pick(1, "bob", "b", "home")];
    const s = status(weeks, picks);
    expect(s.over).toBe(true);
    expect(s.winners).toEqual(["ann"]);
    expect(s.players.map((p) => [p.userId, p.alive, p.outWeek, p.outReason])).toEqual([
      ["ann", true, null, null],
      ["bob", false, 1, { kind: "tie", team: "KC" }],
      ["cat", false, 1, { kind: "missed" }],
    ]);
    expect(s.nextWeek).toBeNull();
  });

  it("cancels a week that would put out everyone still in", () => {
    const weeks = [
      week(1, [game("a", "CHI", "GB", 1, [20, 10])]),
      week(2, [game("b", "KC", "DEN", 2, [10, 20])]),
      week(3, [game("c", "BUF", "MIA", 3)], "open"),
    ];
    // Week 1: Cat misses and goes out. Week 2: Ann and Bob both lose, which would leave nobody.
    const picks = [
      pick(1, "ann", "a", "home"),
      pick(1, "bob", "a", "home"),
      pick(2, "ann", "b", "home"),
      pick(2, "bob", "b", "home"),
    ];
    const s = status(weeks, picks);
    expect(s.weeks.map((w) => [w.number, w.cancelled, w.out, w.aliveAfter])).toEqual([
      [1, false, ["cat"], 2],
      [2, true, [], 2],
    ]);
    expect(s.players.filter((p) => p.alive).map((p) => [p.userId, p.strikes])).toEqual([
      ["ann", []],
      ["bob", []],
    ]);
    expect(s.over).toBe(false);
    expect(s.nextWeek).toBe(3);
  });

  it("counts strikes against more than one life", () => {
    const weeks = [
      week(1, [game("a", "CHI", "GB", 1, [10, 20])]),
      week(2, [game("b", "KC", "DEN", 2, [20, 10])]),
      week(3, [game("c", "BUF", "MIA", 3, [10, 20])]),
    ];
    const picks = [
      pick(1, "ann", "a", "home"),
      pick(1, "bob", "a", "away"),
      pick(1, "cat", "a", "away"),
      pick(2, "ann", "b", "home"),
      pick(2, "bob", "b", "home"),
      pick(3, "ann", "c", "home"),
      pick(3, "bob", "c", "away"),
      pick(3, "cat", "c", "away"),
    ];
    const s = status(weeks, picks, 2);
    // Ann: lost in 1 and 3, out in 3. Cat: missed 2, alive with one life. Bob: never struck.
    expect(s.players.map((p) => [p.userId, p.alive, p.livesLeft, p.outWeek])).toEqual([
      ["bob", true, 2, null],
      ["cat", true, 1, null],
      ["ann", false, 0, 3],
    ]);
    expect(s.players.find((p) => p.userId === "cat")?.strikes).toEqual([
      { weekNumber: 2, reason: { kind: "missed" } },
    ]);
    expect(s.over).toBe(false);
  });

  it("puts out a player who leaves, from the week they left", () => {
    const weeks = [
      week(1, [game("a", "CHI", "GB", 1, [20, 10])]),
      week(2, [game("b", "KC", "DEN", 2, [20, 10])]),
      week(3, [game("c", "BUF", "MIA", 3)], "open"),
    ];
    const picks = ["ann", "bob", "cat"].flatMap((u) => [pick(1, u, "a", "home"), pick(2, u, "b", "home")]);
    const left = [member("ann"), member("bob"), member("cat", undefined, day(8))];
    const s = status(weeks, picks, 1, left);
    expect(s.players.find((p) => p.userId === "cat")).toMatchObject({
      alive: false,
      outWeek: 2,
      outReason: { kind: "left" },
    });
    // Recorded participants say the same once each week was final.
    const recorded = new Map([
      ["w1", new Set(["ann", "bob", "cat"])],
      ["w2", new Set(["ann", "bob"])],
    ]);
    const rejoined = [member("ann"), member("bob"), member("cat", day(20))];
    const again = survivorStatus({ startWeek: 1, lives: 1, weeks, picks, members: rejoined, recorded });
    expect(again.players.find((p) => p.userId === "cat")?.outWeek).toBe(2);
  });

  it("keeps a start-week leaver out after they rejoin, so the winner can't flip", () => {
    // Two games in the start week: Sunday (day 3) and Monday (day 4).
    const start = week(1, [
      game("a", "CHI", "GB", 1, [20, 10]),
      { ...game("b", "KC", "DEN", 1, [10, 20]), kickoff: day(4) },
    ]);
    // Ann picks a winner, then leaves before Monday's kickoff. Bob's pick loses.
    const picks = [pick(1, "ann", "a", "home"), pick(1, "bob", "b", "home")];
    const left = [member("ann", undefined, new Date(day(3).getTime() + 3_600_000)), member("bob")];
    // Finalizing records who was in the league at the last kickoff: Bob alone.
    const recorded = new Map([["w1", new Set(["bob"])]]);
    const asRecorded = survivorStatus({
      startWeek: 1,
      lives: 1,
      weeks: [start],
      picks,
      members: left,
      recorded,
    });
    // Ann is out for leaving, so the week would put out everyone: it is cancelled, and Bob is the one left.
    expect(asRecorded.entrants).toEqual(["ann", "bob"]);
    expect(asRecorded.winners).toEqual(["bob"]);
    expect(asRecorded.players.find((p) => p.userId === "ann")).toMatchObject({
      outWeek: 1,
      outReason: { kind: "left" },
    });
    // Ann rejoins a week later: a fresh membership, and nothing changes.
    const rejoined = [member("ann", day(10)), member("bob")];
    const after = survivorStatus({
      startWeek: 1,
      lives: 1,
      weeks: [start],
      picks,
      members: rejoined,
      recorded,
    });
    expect(after).toEqual(asRecorded);
    // Before the record exists (the week not yet final), the membership dates say the same.
    expect(survivorEntrants({ ...start, status: "open" }, left, picks)).toEqual(["ann", "bob"]);
  });

  it("lets in a late joiner only while the start week can still be picked", () => {
    const start = week(1, [
      { ...game("a", "CHI", "GB", 1), kickoff: day(0) },
      { ...game("b", "KC", "DEN", 1), kickoff: day(4) },
    ]);
    const list = [
      member("ann"),
      member("early", day(2)),
      member("late", day(5)),
      member("gone", undefined, day(-1)),
    ];
    expect(survivorEntrants(start, list, [])).toEqual(["ann", "early"]);
    // A player who leaves during the start week without picking never entered; one who picked stays listed.
    const quitter = member("quit", undefined, day(2));
    expect(survivorEntrants(start, [...list, quitter], [])).toEqual(["ann", "early"]);
    expect(survivorEntrants(start, [...list, quitter], [pick(1, "quit", "a", "home")])).toEqual([
      "ann",
      "early",
      "quit",
    ]);
    // Recorded once the start week is final, the list stands, with anyone who picked in it.
    expect(survivorEntrants(start, list, [], new Set(["ann"]))).toEqual(["ann"]);
    expect(survivorEntrants(start, list, [pick(1, "early", "a", "home")], new Set(["ann"]))).toEqual([
      "ann",
      "early",
    ]);
    // Before the slate arrives, every current member is in.
    expect(survivorEntrants(week(1, [], "open"), list, [])).toEqual(["ann", "early", "late"]);
  });

  it("plays on into the playoffs, and shares the title after the Super Bowl", () => {
    const weeks: SurvivorWeekInput[] = [];
    const picks: SurvivorPickInput[] = [];
    for (let n = 17; n <= 22; n++) {
      weeks.push(week(n, [game(`g${n}`, "CHI", "GB", n, [20, 10])]));
      for (const u of ["ann", "bob"]) picks.push(pick(n, u, `g${n}`, "home"));
    }
    const pair = [member("ann"), member("bob")];
    const partWay = survivorStatus({
      startWeek: 17,
      lives: 1,
      weeks: weeks.filter((w) => w.number <= 18),
      picks,
      members: pair,
    });
    expect(partWay).toMatchObject({ over: false, lastFinalWeek: 18, nextWeek: 19 });
    const s = survivorStatus({ startWeek: 17, lives: 1, weeks, picks, members: pair });
    expect(s).toMatchObject({ over: true, lastFinalWeek: 22, winners: ["ann", "bob"], nextWeek: null });
    expect(s.players.every((p) => p.winner)).toBe(true);
  });

  it("waits for the start week, and counts only final weeks in order", () => {
    const s = status([week(1, [game("a", "CHI", "GB", 1)], "open")], []);
    expect(s).toMatchObject({ over: false, lastFinalWeek: null, nextWeek: 1, weeks: [] });
    expect(s.players.every((p) => p.alive)).toBe(true);
  });
});
