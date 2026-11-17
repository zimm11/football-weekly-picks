import { type BoardSummary, preferredBoard } from "@picks/shared";
import { useSyncExternalStore } from "react";

/*
 * Which board a squares league shows, shared by the header's board selector (which loads the league's boards)
 * and the Board tab (which draws the chosen one). A choice is remembered per league for this session: in the
 * browser's session storage on the web build, in memory in the native app, as the season choice is.
 */

type Entry = { boards?: BoardSummary[]; chosen?: string; error?: string; retry?: () => void };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const key = (leagueId: string) => `picks:board:${leagueId}`;

function browserSession(): Storage | undefined {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage;
  } catch {
    return undefined;
  }
}

function entry(leagueId: string): Entry {
  let current = entries.get(leagueId);
  if (!current) {
    let chosen: string | undefined;
    try {
      chosen = browserSession()?.getItem(key(leagueId)) ?? undefined;
    } catch {
      chosen = undefined;
    }
    current = { chosen };
    entries.set(leagueId, current);
  }
  return current;
}

function update(leagueId: string, patch: Entry) {
  entries.set(leagueId, { ...entry(leagueId), ...patch });
  for (const listener of listeners) listener();
}

export function setBoards(leagueId: string, boards: BoardSummary[]) {
  update(leagueId, { boards, error: undefined });
}

/** The boards couldn't be loaded: the tab shows why, with Try again. */
export function setBoardsError(leagueId: string, error: string | undefined, retry: () => void) {
  if (entry(leagueId).error !== error) update(leagueId, { error, retry });
}

export function chooseBoard(leagueId: string, boardId: string) {
  update(leagueId, { chosen: boardId });
  try {
    browserSession()?.setItem(key(leagueId), boardId);
  } catch {
    /* Storage is optional. */
  }
}

/** A board was deleted: drop it from the list at once, so the Board tab doesn't try to load it. */
export function forgetBoard(leagueId: string, boardId: string) {
  const current = entry(leagueId);
  update(leagueId, {
    boards: current.boards?.filter((b) => b.id !== boardId),
    chosen: current.chosen === boardId ? undefined : current.chosen,
  });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The league's boards (undefined until the selector has loaded them) and the one to show: the chosen board while
 * it exists, else the next to finish (`preferredBoard`).
 */
export function useBoardChoice(leagueId: string) {
  const current = useSyncExternalStore(subscribe, () => entry(leagueId));
  const boards = current.boards;
  const shown = boards?.find((b) => b.id === current.chosen) ?? (boards ? preferredBoard(boards) : undefined);
  return { boards, boardId: shown?.id, error: current.error, retry: current.retry };
}
