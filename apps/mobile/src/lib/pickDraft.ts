import { type Game, isLocked, type Side, type SubmitPicks, type WeekView } from "@picks/shared";

export type PickDraft = { sides: Record<string, Side>; pow: string | null; total: string };
export const gameLocked = (game: Game, at: Date) =>
  isLocked(
    { kickoff: new Date(game.kickoff), final: game.homeScore !== null || game.awayScore !== null },
    at,
  );
export const matchup = (game: Game) => `${game.awayTeam} at ${game.homeTeam}`;

export function savedDraft(view: WeekView): PickDraft {
  return {
    sides: Object.fromEntries(view.myPicks.map((pick) => [pick.gameId, pick.side])),
    pow: view.myPicks.find((pick) => pick.isPow)?.gameId ?? null,
    total: view.myTiebreakerTotal === null ? "" : String(view.myTiebreakerTotal),
  };
}

export function draftChanged(a: PickDraft, b: PickDraft): boolean {
  return (
    a.pow !== b.pow ||
    a.total.trim() !== b.total.trim() ||
    Object.keys(a.sides).length !== Object.keys(b.sides).length ||
    Object.entries(a.sides).some(([id, side]) => b.sides[id] !== side)
  );
}

/** Reconciles edits against a fresh server slate and the save-time clock. */
export function reconcileDraft(draft: PickDraft, view: WeekView, at: Date) {
  const saved = savedDraft(view);
  const slate = new Map(view.games.map((game) => [game.id, game]));
  const undone: string[] = [];
  const sides = { ...saved.sides };
  for (const [id, side] of Object.entries(draft.sides)) {
    const game = slate.get(id);
    if (!game) {
      undone.push("a removed game");
    } else if (side !== saved.sides[id] && gameLocked(game, at)) {
      undone.push(matchup(game));
    } else {
      sides[id] = side;
    }
  }
  let pow = draft.pow && slate.has(draft.pow) ? draft.pow : null;
  if (pow !== draft.pow) undone.push("your POW");
  if (pow !== saved.pow) {
    const from = saved.pow ? slate.get(saved.pow) : undefined;
    const to = pow ? slate.get(pow) : undefined;
    if ((from && gameLocked(from, at)) || (to && (gameLocked(to, at) || !sides[to.id]))) {
      pow = saved.pow;
      undone.push("your POW");
    }
  }
  let total = draft.total;
  const tiebreaker = slate.get(view.tiebreakerGameId ?? "");
  if (total.trim() !== saved.total && (!tiebreaker || gameLocked(tiebreaker, at))) {
    total = saved.total;
    undone.push("your tiebreaker guess");
  }
  return { draft: { sides, pow, total }, undone: [...new Set(undone)] };
}

export function draftSubmission(draft: PickDraft): SubmitPicks {
  return {
    picks: Object.entries(draft.sides).map(([gameId, side]) => ({ gameId, side })),
    powGameId: draft.pow,
    tiebreakerTotal: draft.total.trim() === "" ? null : Number(draft.total),
  };
}
