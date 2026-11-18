function browserSession(): Storage | undefined {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage;
  } catch {
    return undefined;
  }
}

/*
 * Which league each board seen this session belongs to (session storage on the web, memory in the native app).
 * A board that is gone answers 404 with nothing about where it was, so this is how its not-found screen still
 * offers the way back to its league.
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
