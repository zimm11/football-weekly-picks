import type { SurvivorView } from "@picks/shared";
import { describe, expect, it } from "vitest";
import {
  aliveCount,
  draftChanged,
  gridCell,
  gridWeeks,
  nextSurvivorWeek,
  outLine,
  pickHeadline,
  playerStatus,
  recapSummary,
  teamChoice,
  teamsUsed,
  usedBy,
  waitingLine,
  weekShort,
} from "./survivor";

const kickoff = "2026-11-22T18:00:00.000Z";
const before = new Date("2026-11-22T17:00:00Z");
const after = new Date("2026-11-22T19:00:00Z");
const game = (id: string, home: string, away: string, time = kickoff) => ({
  id,
  homeTeam: home,
  awayTeam: away,
  kickoff: time,
  homeScore: null,
  awayScore: null,
});
const player = (userId: string, extra: Partial<SurvivorView["players"][number]> = {}) => ({
  userId,
  displayName: userId[0]?.toUpperCase() + userId.slice(1),
  removed: false,
  alive: true,
  livesLeft: 1,
  strikes: 0,
  outWeek: null,
  outReason: null,
  winner: false,
  ...extra,
});

function view(overrides: Partial<SurvivorView> = {}): SurvivorView {
  return {
    leagueId: "league",
    year: 2026,
    years: [2026],
    timeZone: "America/New_York",
    role: "member",
    settings: { lives: 1, startWeek: 11 },
    started: true,
    over: false,
    winners: [],
    players: [
      player("ann"),
      player("bob"),
      player("cat", { alive: false, livesLeft: 0, outWeek: 11, outReason: { kind: "lost", team: "CHI" } }),
    ],
    weeks: [
      {
        id: "w11",
        number: 11,
        status: "final",
        cancelled: false,
        out: ["cat"],
        aliveAfter: 2,
        games: [{ ...game("g1", "CHI", "GB"), homeScore: 10, awayScore: 20 }],
      },
      {
        id: "w12",
        number: 12,
        status: "open",
        cancelled: false,
        out: [],
        aliveAfter: null,
        games: [game("g2", "KC", "LV"), game("g3", "GB", "DET", "2026-11-23T01:20:00.000Z")],
      },
    ],
    picks: [
      { userId: "ann", weekId: "w11", gameId: "g1", side: "away", team: "GB", outcome: "won" },
      { userId: "cat", weekId: "w11", gameId: "g1", side: "home", team: "CHI", outcome: "lost" },
    ],
    current: {
      weekId: "w12",
      number: 12,
      myPick: null,
      used: [{ team: "GB", weekNumber: 11 }],
      usedWaived: false,
    },
    watching: false,
    ...overrides,
  };
}

describe("survivor presentation", () => {
  it("disables a used team and says where it went", () => {
    const v = view();
    const gb = teamChoice({
      view: v,
      game: v.weeks[1]?.games[1] ?? game("x", "A", "B"),
      side: "home",
      draft: null,
      canPick: true,
      now: before,
    });
    expect(gb).toEqual({ selected: false, disabled: true, note: "Used in Week 11" });
    const det = teamChoice({
      view: v,
      game: v.weeks[1]?.games[1] ?? game("x", "A", "B"),
      side: "away",
      draft: { gameId: "g3", side: "away" },
      canPick: true,
      now: before,
    });
    expect(det).toEqual({ selected: true, disabled: false, note: null });
    // When a playoff slate has no unused team left, the used ones are open again.
    const waived = view({
      current: { ...(v.current as NonNullable<SurvivorView["current"]>), usedWaived: true },
    });
    expect(
      teamChoice({
        view: waived,
        game: game("g3", "GB", "DET"),
        side: "home",
        draft: null,
        canPick: true,
        now: before,
      }).disabled,
    ).toBe(false);
  });

  it("locks a team at kickoff, and every team once the saved pick has kicked off", () => {
    const v = view();
    const kc = v.weeks[1]?.games[0] ?? game("x", "A", "B");
    expect(teamChoice({ view: v, game: kc, side: "home", draft: null, canPick: true, now: after })).toEqual({
      selected: false,
      disabled: true,
      note: "Kicked off",
    });
    const picked = view({
      current: {
        ...(v.current as NonNullable<SurvivorView["current"]>),
        myPick: { gameId: "g2", side: "home", byAdmin: false },
      },
    });
    const det = picked.weeks[1]?.games[1] ?? game("x", "A", "B");
    expect(
      teamChoice({ view: picked, game: det, side: "away", draft: null, canPick: true, now: after }).disabled,
    ).toBe(true);
    expect(
      teamChoice({ view: v, game: det, side: "away", draft: null, canPick: false, now: before }).disabled,
    ).toBe(true);
  });

  it("knows an unsaved change", () => {
    const v = view();
    expect(draftChanged(v, null)).toBe(false);
    expect(draftChanged(v, { gameId: "g2", side: "home" })).toBe(true);
    const saved = view({
      current: {
        ...(v.current as NonNullable<SurvivorView["current"]>),
        myPick: { gameId: "g2", side: "home", byAdmin: true },
      },
    });
    expect(draftChanged(saved, { gameId: "g2", side: "home" })).toBe(false);
  });

  it("fills the grid with revealed picks and says nothing about hidden ones", () => {
    const v = view();
    const [w11, w12] = v.weeks as [SurvivorView["weeks"][number], SurvivorView["weeks"][number]];
    const [ann, bob, cat] = v.players as [
      SurvivorView["players"][number],
      SurvivorView["players"][number],
      SurvivorView["players"][number],
    ];
    expect(gridCell(v, ann, w11)).toEqual({
      kind: "pick",
      team: "GB",
      outcome: "won",
      label: "Week 11: Packers, won",
    });
    expect(gridCell(v, cat, w11)).toMatchObject({
      kind: "pick",
      outcome: "lost",
      label: "Week 11: Bears, lost",
    });
    // Bob had no pick in a final week: a strike.
    expect(gridCell(v, bob, w11)).toEqual({ kind: "missed", label: "Week 11: no pick" });
    // This week's picks aren't revealed: an empty cell says nothing either way.
    expect(gridCell(v, bob, w12)).toEqual({ kind: "empty", label: "Week 12: nothing to show" });
    expect(gridCell(v, cat, w12).kind).toBe("empty");
    expect(gridWeeks(v).map((w) => w.number)).toEqual([11, 12]);
  });

  it("counts who is left and says how each player went out", () => {
    const v = view();
    expect(aliveCount(v)).toBe("2 of 3 alive");
    expect(outLine(v.players[2] ?? player("x"))).toBe("Out in Week 11: Bears lost");
    expect(playerStatus(v, v.players[0] ?? player("x"))).toBe("Alive");
    const lives = view({ settings: { lives: 3, startWeek: 11 } });
    expect(playerStatus(lives, { ...player("ann"), livesLeft: 2 })).toBe("Alive · 2 of 3 lives");
    expect(weekShort(7)).toBe("W7");
    expect(weekShort(19)).toBe("WC");
    expect(weekShort(22)).toBe("SB");
  });

  it("heads the pick screen with how the player stands", () => {
    const v = view();
    expect(pickHeadline(v, "ann").title).toBe("You're still in");
    expect(pickHeadline(v, "cat").title).toBe("Out in Week 11: Bears lost");
    expect(pickHeadline(view({ watching: true }), "dan").title).toBe("You're watching this season");
    expect(pickHeadline(view({ settings: null }), "ann").title).toBe("No pool this season");
  });

  describe("between weeks", () => {
    // Week 11 is final and Week 12 isn't open yet: members aren't sent the draft.
    const between = () => {
      const v = view({ current: null });
      return { ...v, weeks: v.weeks.filter((w) => w.status === "final") };
    };

    it("knows the week the pool plays next", () => {
      expect(nextSurvivorWeek(view())).toBe(12);
      expect(nextSurvivorWeek(between())).toBe(12);
      // An admin is sent the draft too; it changes nothing.
      const admin = between();
      admin.weeks.push({
        id: "w12",
        number: 12,
        status: "draft",
        cancelled: false,
        out: [],
        aliveAfter: null,
        games: [],
      });
      expect(nextSurvivorWeek(admin)).toBe(12);
      // Before the start week has been played.
      expect(nextSurvivorWeek({ ...between(), weeks: [] })).toBe(11);
      expect(nextSurvivorWeek({ ...between(), over: true })).toBeNull();
      expect(nextSurvivorWeek({ ...between(), settings: null })).toBeNull();
      expect(nextSurvivorWeek({ ...between(), settings: { lives: 1, startWeek: null } })).toBeNull();
    });

    it("still lists the teams a player has used", () => {
      // While a week is played, the API's list.
      expect(teamsUsed(view(), "ann")).toEqual([{ team: "GB", weekNumber: 11 }]);
      // Between weeks, the same from the player's own picks: not "0 · None yet".
      expect(teamsUsed(between(), "ann")).toEqual([{ team: "GB", weekNumber: 11 }]);
      expect(teamsUsed(between(), "bob")).toEqual([]);
      expect(usedBy(between(), "ann", 12)).toEqual(new Set(["GB"]));
    });

    it("starts the used teams afresh in the postseason", () => {
      const weeks = [17, 18, 19].map((number) => ({
        id: `w${number}`,
        number,
        status: "final" as const,
        cancelled: false,
        out: [],
        aliveAfter: 2,
        games: [],
      }));
      const picks = [
        {
          userId: "ann",
          weekId: "w17",
          gameId: "a",
          side: "home" as const,
          team: "KC",
          outcome: "won" as const,
        },
        {
          userId: "ann",
          weekId: "w18",
          gameId: "b",
          side: "home" as const,
          team: "BUF",
          outcome: "won" as const,
        },
        {
          userId: "ann",
          weekId: "w19",
          gameId: "c",
          side: "home" as const,
          team: "PHI",
          outcome: "won" as const,
        },
      ];
      const settings = { lives: 1, startWeek: 17 };
      // Waiting for the Wild Card round: nothing from the regular season counts.
      const beforeWildCard = view({
        current: null,
        settings,
        weeks: weeks.slice(0, 2),
        picks: picks.slice(0, 2),
      });
      expect(nextSurvivorWeek(beforeWildCard)).toBe(19);
      expect(teamsUsed(beforeWildCard, "ann")).toEqual([]);
      // Waiting for the Divisional round: the Wild Card pick does.
      const beforeDivisional = view({ current: null, settings, weeks, picks });
      expect(teamsUsed(beforeDivisional, "ann")).toEqual([{ team: "PHI", weekNumber: 19 }]);
      // Waiting for Week 18: both regular-season picks... one so far, in the order used.
      const beforeWeek18 = view({
        current: null,
        settings,
        weeks: weeks.slice(0, 1),
        picks: picks.slice(0, 1),
      });
      expect(teamsUsed(beforeWeek18, "ann")).toEqual([{ team: "KC", weekNumber: 17 }]);
    });

    it("says which week is next and what opens it", () => {
      expect(waitingLine(between())).toEqual({
        detail: "Week 12 opens as soon as its games are on the pro football schedule.",
        standings: false,
      });
      expect(waitingLine({ ...between(), weeks: [], picks: [], players: [] }).detail).toBe(
        "The pool starts with Week 11. It opens as soon as its games are on the pro football schedule.",
      );
      const postseason = (finalThrough: number) =>
        view({
          current: null,
          settings: { lives: 1, startWeek: 18 },
          picks: [],
          weeks: Array.from({ length: finalThrough - 17 }, (_, i) => ({
            id: `w${18 + i}`,
            number: 18 + i,
            status: "final" as const,
            cancelled: false,
            out: [],
            aliveAfter: 2,
            games: [],
          })),
        });
      expect(waitingLine(postseason(18)).detail).toBe(
        "The Wild Card round opens as soon as its games are on the pro football schedule.",
      );
      expect(waitingLine(postseason(21)).detail).toBe(
        "The Super Bowl opens as soon as its games are on the pro football schedule.",
      );
      expect(waitingLine({ ...between(), over: true })).toEqual({
        detail: "The pool is over. See how it finished on Standings.",
        standings: true,
      });
      expect(waitingLine({ ...between(), settings: null }).detail).toBe(
        "A commissioner can start the pool from the League tab.",
      );
      expect(waitingLine({ ...between(), settings: null, role: "admin" }).detail).toBe(
        "Start the pool from the League tab.",
      );
      // Nothing here names the data provider.
      expect(waitingLine(between()).detail).not.toMatch(/ESPN|feed/i);
    });
  });

  it("recaps a week: in or out, who went out, how many are left", () => {
    const v = view();
    expect(recapSummary(v, "w11", "ann")).toEqual({
      title: "Week 11 is final",
      headline: "You're still in.",
      wentOut: "Cat went out.",
      left: 2,
      total: 3,
      winners: [],
    });
    expect(recapSummary(v, "w11", "cat")).toMatchObject({
      headline: "You went out: Bears lost.",
      wentOut: null,
    });
    expect(recapSummary(v, "w12", "ann")).toBeNull();
    const cancelled = view({
      weeks: [{ ...(v.weeks[0] as SurvivorView["weeks"][number]), cancelled: true, out: [] }],
    });
    expect(recapSummary(cancelled, "w11", "ann")?.wentOut).toBe(
      "Week 11 would have put out everyone still in, so nobody went out.",
    );
  });
});
