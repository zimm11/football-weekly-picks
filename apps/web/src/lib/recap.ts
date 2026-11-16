/**
 * Which week's recap the league page shows, given what it decided so far (`undefined` until the league first
 * loads) and what the latest load says. Decided once: `null` ("no recap") is a decision too, so a week
 * finalized while the player is on the page waits for their next visit instead of sliding up over their work.
 */
export function recapDecision(current: string | null | undefined, loaded: string | null): string | null {
  return current !== undefined ? current : loaded;
}
