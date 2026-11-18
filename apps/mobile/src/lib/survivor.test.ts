import type { SurvivorView } from "@picks/shared";
import { describe, expect, it } from "vitest";
import {
  aliveCount,
  draftChanged,
  gridCell,
  gridLayout,
  gridWeeks,
  kickoffWhen,
  livesLeftLabel,
  nextSurvivorWeek,
  outLine,
  pickBanner,
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
      lives: { left: 1, of: 1 },
      winners: [],
    });
    expect(recapSummary(v, "w11", "cat")).toMatchObject({
      headline: "You went out: Bears lost.",
      wentOut: null,
      lives: null,
    });
    expect(recapSummary(v, "w12", "ann")).toBeNull();
    const cancelled = view({
      weeks: [{ ...(v.weeks[0] as SurvivorView["weeks"][number]), cancelled: true, out: [] }],
    });
    expect(recapSummary(cancelled, "w11", "ann")?.wentOut).toBe(
      "Week 11 would have put out everyone still in, so nobody went out.",
    );
  });

  describe("the pick status banner", () => {
    const current = (v: SurvivorView, myPick: NonNullable<SurvivorView["current"]>["myPick"]) =>
      view({ current: { ...(v.current as NonNullable<SurvivorView["current"]>), myPick } });
    // Thursday, Nov 19, noon in New York: the week's games are on Sunday.
    const thursday = new Date("2026-11-19T17:00:00Z");

    it("asks for a pick, naming the first kickoff still open", () => {
      expect(pickBanner(view(), "ann", thursday)).toEqual({
        kind: "needs",
        title: "Pick a team for Week 12",
        detail: "First kickoff Sunday at 1:00 PM EST.",
      });
      // Once a game has kicked off, the next one that can still be picked.
      expect(pickBanner(view(), "ann", after)?.detail).toBe("Next kickoff today at 8:20 PM EST.");
    });

    it("says the player is all set once a pick is saved, and until when it can change", () => {
      const v = current(view(), { gameId: "g3", side: "away", byAdmin: false });
      expect(pickBanner(v, "ann", thursday)).toEqual({
        kind: "set",
        title: "You're all set for Week 12",
        detail: "You picked the Lions. You can change it until they kick off Sunday at 8:20 PM EST.",
      });
      expect(pickBanner(v, "ann", before)?.detail).toMatch(/until they kick off today at 8:20 PM EST\.$/);
    });

    it("says the pick is in once its game kicks off, then how it went", () => {
      const v = current(view(), { gameId: "g2", side: "home", byAdmin: false });
      expect(pickBanner(v, "ann", after)).toEqual({
        kind: "locked",
        title: "Your pick is in: Chiefs",
        detail: "Their game is under way.",
      });
      const scored = (home: number, away: number, lives = 1) =>
        view({
          ...v,
          players: v.players.map((p) => (p.userId === "ann" ? { ...p, livesLeft: lives } : p)),
          weeks: v.weeks.map((w) =>
            w.id === "w12"
              ? {
                  ...w,
                  games: w.games.map((g) => (g.id === "g2" ? { ...g, homeScore: home, awayScore: away } : g)),
                }
              : w,
          ),
        });
      // Won: through. A next week is named only when someone else is sure to stay in too, since otherwise
      // this week could end the pool.
      expect(pickBanner(scored(27, 20), "ann", after)).toEqual({
        kind: "won",
        title: "Chiefs won: you're through",
        detail: "Final: Chiefs 27, Raiders 20.",
      });
      const bobSpare = (w: SurvivorView) =>
        view({ ...w, players: w.players.map((p) => (p.userId === "bob" ? { ...p, livesLeft: 2 } : p)) });
      expect(pickBanner(bobSpare(scored(27, 20)), "ann", after)?.title).toBe(
        "Chiefs won: you're through to Week 13",
      );
      const bobWon = (w: SurvivorView) =>
        view({
          ...w,
          picks: [
            ...w.picks,
            { userId: "bob", weekId: "w12", gameId: "g2", side: "home", team: "KC", outcome: "won" },
          ],
        });
      expect(pickBanner(bobWon(scored(27, 20)), "ann", after)?.title).toBe(
        "Chiefs won: you're through to Week 13",
      );
      // A pick still to play, or lost, says nothing about whether Bob stays in.
      const bobLost = view({
        ...scored(27, 20),
        picks: [{ userId: "bob", weekId: "w12", gameId: "g2", side: "away", team: "LV", outcome: "lost" }],
      });
      expect(pickBanner(bobLost, "ann", after)?.title).toBe("Chiefs won: you're through");
      // The Super Bowl has no week after it.
      const superBowl = bobSpare(
        view({
          ...scored(27, 20),
          weeks: scored(27, 20).weeks.map((w) => (w.id === "w12" ? { ...w, number: 22 } : w)),
        }),
      );
      expect(pickBanner(superBowl, "ann", after)?.title).toBe("Chiefs won: you're through");

      // Lost with a life to spare: a strike for certain (the player stays in, so the week can't be cancelled).
      expect(pickBanner(scored(17, 20, 2), "ann", after)).toEqual({
        kind: "lost",
        title: "Chiefs lost: that's a strike",
        detail: "Chiefs 17, Raiders 20. You'll have 1 life left once the week is final.",
      });
      expect(pickBanner(scored(17, 20, 3), "ann", after)?.detail).toBe(
        "Chiefs 17, Raiders 20. You'll have 2 lives left once the week is final.",
      );
      // On the last life: never "you're out" before the week is final.
      expect(pickBanner(scored(17, 20), "ann", after)).toEqual({
        kind: "lost",
        title: "Chiefs lost on your last life",
        detail: "You're out when the week is final, unless everyone still in goes out too.",
      });
      // A tie counts as a loss, both ways.
      expect(pickBanner(scored(20, 20, 2), "ann", after)).toMatchObject({
        kind: "lost",
        title: "Chiefs tied: that's a strike",
      });
      expect(pickBanner(scored(20, 20), "ann", after)?.title).toBe("Chiefs tied on your last life");
      for (const b of [scored(17, 20), scored(20, 20), scored(17, 20, 2)].map((w) =>
        pickBanner(w, "ann", after),
      )) {
        expect(`${b?.title} ${b?.detail}`).not.toMatch(/you're out(?! when the week is final)/i);
      }
    });

    it("leaves a final week to the status card", () => {
      const v = current(view(), { gameId: "g2", side: "home", byAdmin: false });
      const final = view({
        ...v,
        weeks: v.weeks.map((w) => (w.id === "w12" ? { ...w, status: "final" } : w)),
      });
      expect(pickBanner(final, "ann", after)).toBeNull();
    });

    it("names the next round in the playoffs", () => {
      const v = view({
        weeks: [{ ...(view().weeks[1] as SurvivorView["weeks"][number]), number: 19 }],
        current: { ...(view().current as NonNullable<SurvivorView["current"]>), number: 19 },
      });
      expect(pickBanner(v, "ann", thursday)?.title).toBe("Pick a team for the Wild Card round");
    });

    it("says when no team is left to pick", () => {
      const late = new Date("2026-11-23T02:00:00Z");
      expect(pickBanner(view(), "ann", late)).toEqual({
        kind: "missed",
        title: "No pick for Week 12 on your last life",
        detail: "You're out when the week is final, unless everyone still in goes out too.",
      });
      const spare = view({
        players: view().players.map((p) => (p.userId === "ann" ? { ...p, livesLeft: 2 } : p)),
      });
      expect(pickBanner(spare, "ann", late)).toEqual({
        kind: "missed",
        title: "No pick for Week 12: that's a strike",
        detail: "No team is left for you to pick. You'll have 1 life left once the week is final.",
      });
    });

    it("shows nothing for a player with no pick to make", () => {
      expect(pickBanner(view(), "cat", thursday)).toBeNull();
      expect(pickBanner(view({ watching: true }), "dan", thursday)).toBeNull();
      expect(pickBanner(view({ over: true }), "ann", thursday)).toBeNull();
      expect(pickBanner(view({ current: null }), "ann", thursday)).toBeNull();
    });
  });

  it("words a kickoff in the league's time zone", () => {
    const tz = "America/New_York";
    const at = new Date("2026-11-19T17:00:00Z");
    expect(kickoffWhen("2026-11-20T01:15:00Z", tz, at)).toBe("today at 8:15 PM EST");
    expect(kickoffWhen("2026-11-20T18:00:00Z", tz, at)).toBe("tomorrow at 1:00 PM EST");
    expect(kickoffWhen("2026-11-24T01:15:00Z", tz, at)).toBe("Monday at 8:15 PM EST");
    expect(kickoffWhen("2026-11-27T01:20:00Z", tz, at)).toBe("Thursday, Nov 26 at 8:20 PM EST");
    expect(livesLeftLabel(1, 2)).toBe("1 of 2 lives left");
    expect(livesLeftLabel(1, 1)).toBe("1 of 1 life left");
  });

  it("lays the grid out in whole columns", () => {
    // A phone, many weeks: whole 56px-or-wider cells in view, none cut.
    const phone = gridLayout({ width: 358, weeks: 10, name: 148, fixed: 0 });
    expect(phone.visible).toBe(3);
    expect(phone.cell * phone.visible + phone.name).toBeCloseTo(358);
    // One week: the name column takes the slack, up to 320.
    expect(gridLayout({ width: 358, weeks: 1, name: 148, fixed: 0 })).toEqual({
      name: 302,
      cell: 56,
      visible: 1,
    });
    // A desktop card with a few weeks: the name column caps at 320 and the cells grow, to 96 at most.
    const desktop = gridLayout({ width: 864, weeks: 4, name: 210, fixed: 72, maxCell: 96 });
    expect(desktop).toEqual({ name: 320, cell: 96, visible: 4 });
  });
});
