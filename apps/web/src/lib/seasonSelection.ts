/** Remember explicit season choices within this browser session, independently for each league. */
const key = (leagueId: string) => `picks:season:${leagueId}`;

export function readSeason(leagueId: string): number | undefined {
  try {
    const value = Number(sessionStorage.getItem(key(leagueId)));
    return Number.isInteger(value) && value >= 2020 && value <= 2100 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function rememberSeason(leagueId: string, year: number) {
  try {
    sessionStorage.setItem(key(leagueId), String(year));
  } catch {
    /* Storage is optional. */
  }
}
