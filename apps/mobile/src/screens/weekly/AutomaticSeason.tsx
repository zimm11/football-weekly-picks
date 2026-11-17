import type { LeagueDetail } from "@picks/shared";
import { ComingSoon } from "../ComingSoon";

/**
 * Automatic weekly pick'em's admin tool: Start season and pick the start week. Placeholder until automation
 * ships; the admin's week setup below still works as the override.
 */
export function AutomaticSeasonCard(_: { league: LeagueDetail; year: number; reload: () => void }) {
  return (
    <ComingSoon
      title="Runs itself"
      detail="Weeks will set themselves up, open and close from the schedule. Until then, set up weeks below."
    />
  );
}
