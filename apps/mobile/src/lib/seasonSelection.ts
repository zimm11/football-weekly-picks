/**
 * Remembers an explicit season choice per league for this session: in the browser's session
 * storage on the web build (so a reload keeps it), in memory in the native app.
 */
const chosen = new Map<string, number>();
const key = (leagueId: string) => `picks:season:${leagueId}`;
function browserSession(): Storage | undefined {
  try {
    return (globalThis as { sessionStorage?: Storage }).sessionStorage;
  } catch {
    return undefined;
  }
}

export function readSeason(leagueId: string): number | undefined {
  const remembered = chosen.get(leagueId);
  if (remembered !== undefined) return remembered;
  try {
    const value = Number(browserSession()?.getItem(key(leagueId)));
    return Number.isInteger(value) && value >= 2020 && value <= 2100 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function rememberSeason(leagueId: string, year: number) {
  chosen.set(leagueId, year);
  try {
    browserSession()?.setItem(key(leagueId), String(year));
  } catch {
    /* Storage is optional. */
  }
}
