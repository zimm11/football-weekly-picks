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
  for (const board of boards) rememberBoardLeague(board.id, leagueId);
  update(leagueId, { boards, error: undefined });
}

/** The boards couldn't be loaded: the tab shows why, with Try again. */
export function setBoardsError(leagueId: string, error: string | undefined, retry: () => void) {
  const current = entry(leagueId);
  // `retry` is also the tab's way to reload the list (pull to refresh), so it is kept from the first call.
  if (current.error !== error || current.retry !== retry) update(leagueId, { error, retry });
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

/*
 * Which league each board seen this session belongs to (kept as the board choice is: session storage on the
 * web, memory in the native app). A board that is gone answers 404 with nothing about where it was, so this is
 * how its not-found screen still offers the way back to its league.
 */
const boardLeagues = new Map<string, string>();
const leagueKey = (boardId: string) => `picks:board-league:${boardId}`;

export function rememberBoardLeague(boardId: string, leagueId: string) {
  if (boardLeagues.get(boardId) === leagueId) return;
  boardLeagues.set(boardId, leagueId);
  try {
    browserSession()?.setItem(leagueKey(boardId), leagueId);
  } catch {
    /* Storage is optional. */
  }
}

/** The league a board was in, when this session has seen the board or its league's list of boards. */
export function leagueOfBoard(boardId: string): string | undefined {
  const known = boardLeagues.get(boardId);
  if (known) return known;
  try {
    const stored = browserSession()?.getItem(leagueKey(boardId));
    // Only ever a league id: it goes into a link.
    return stored && /^[0-9a-f-]{36}$/i.test(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
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
