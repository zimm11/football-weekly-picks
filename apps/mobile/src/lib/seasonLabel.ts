import { LEAGUE_TYPE_INFO, type LeagueDetail } from "@picks/shared";

/**
 * How the league header's season selector names a year, for its options and for the chosen one alike.
 * A playoff league's season is its postseason: "2026 playoffs". " · Not started" only where a season starts
 * with its first week, which is Hands-on weekly's way: a type that gets its season when the league is created,
 * or a league that runs itself, has started even while members see no week yet.
 */
export function seasonChoiceLabel(
  league: Pick<LeagueDetail, "type" | "management" | "weeks">,
  year: number,
): string {
  if (league.type === "playoff") return `${year} playoffs`;
  const startsWithFirstWeek = !LEAGUE_TYPE_INFO[league.type].seasonOnCreate && league.management === "manual";
  return startsWithFirstWeek && !league.weeks.some((week) => week.year === year)
    ? `${year} · Not started`
    : String(year);
}
