import type { Game, WeekView } from "@picks/shared";
import { describe, expect, it } from "vitest";
import { draftChanged, draftSubmission, reconcileDraft, savedDraft } from "./pickDraft";

const kickoff = new Date("2026-11-16T20:00:00Z");
const before = new Date(kickoff.getTime() - 1);
const game = (id: string): Game => ({
  id,
  homeTeam: "PHI",
  awayTeam: "DAL",
  kickoff: kickoff.toISOString(),
  spread: -3.5,
  points: 3,
  homeScore: null,
  awayScore: null,
});
const week = (): WeekView => ({
  id: "week",
  leagueId: "league",
  leagueName: "League",
  timeZone: "UTC",
  role: "member",
  year: 2026,
  number: 11,
  status: "open",
  tiebreakerGameId: "b",
  games: [game("a"), game("b")],
  myPicks: [{ gameId: "a", side: "home", isPow: true }],
  myTiebreakerTotal: 40,
  submissions: null,
  results: null,
});

describe("native pick draft reconciliation", () => {
  it("keeps editable side, POW and tiebreaker changes", () => {
    const view = week();
    const draft = { sides: { a: "away", b: "home" } as const, pow: "b", total: "44" };
    expect(reconcileDraft(draft, view, before)).toEqual({ draft, undone: [] });
  });
  it("restores saved sides, POW and total exactly at kickoff", () => {
    const view = week();
    const result = reconcileDraft({ sides: { a: "away", b: "home" }, pow: "b", total: "44" }, view, kickoff);
    expect(result.draft).toEqual(savedDraft(view));
    expect(result.undone).toContain("your POW");
    expect(result.undone).toContain("your tiebreaker guess");
  });
  it("locks a game whose result was entered before kickoff", () => {
    const view = week();
    view.games = [{ ...game("a"), homeScore: 24, awayScore: 17 }, game("b")];
    const result = reconcileDraft({ ...savedDraft(view), sides: { a: "away" } }, view, before);
    expect(result.draft.sides.a).toBe("home");
    expect(result.undone).toEqual(["DAL at PHI"]);
  });
  it("releases a POW when its game was removed and preserves other edits", () => {
    const view = week();
    const draft = { sides: { a: "home", b: "away" } as const, pow: "b", total: "40" };
    view.games = [game("b")];
    view.myPicks = [];
    expect(reconcileDraft(draft, view, before).draft).toEqual({
      sides: { b: "away" },
      pow: "b",
      total: "40",
    });
    expect(reconcileDraft(draft, view, before).undone).toContain("a removed game");
  });
  it("prevents moving an already locked POW onto a later game", () => {
    const view = week();
    view.games = [game("a"), { ...game("b"), kickoff: new Date(kickoff.getTime() + 60_000).toISOString() }];
    const result = reconcileDraft({ sides: { a: "home", b: "away" }, pow: "b", total: "44" }, view, kickoff);
    expect(result.draft.pow).toBe("a");
    expect(result.draft.sides.b).toBe("away");
    expect(result.draft.total).toBe("44");
  });
  it("does not invent a POW for a player who did not choose one", () => {
    const view = week();
    view.myPicks = [{ gameId: "a", side: "home", isPow: false }];
    expect(reconcileDraft(savedDraft(view), view, before).draft.pow).toBeNull();
  });
  it("does not let a disappeared tiebreaker leave a changed guess", () => {
    const view = week();
    view.tiebreakerGameId = null;
    expect(reconcileDraft({ ...savedDraft(view), total: "44" }, view, before).draft.total).toBe("40");
  });
  it("compares numeric text without whitespace and serializes an empty guess as null", () => {
    const saved = savedDraft(week());
    expect(draftChanged(saved, { ...saved, total: " 40 " })).toBe(false);
    expect(draftSubmission({ sides: {}, pow: null, total: " " }).tiebreakerTotal).toBeNull();
  });
});
