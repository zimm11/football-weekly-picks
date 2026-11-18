import { LeagueTabScroll } from "../LeagueTabScroll";
import type { LeagueTabProps, LeagueTypeScreens } from "../leagueTypeScreens";
import { Disclosure } from "../leagueUi";
import { AutomaticSeasonCard } from "./AutomaticSeason";
import { PicksPanel, SeasonPanel, WeekRecap } from "./WeeklyTabs";
import { WeekSetupCard } from "./WeekSetup";

export function WeeklyPicks({ league, year, header, reload, fresh }: LeagueTabProps) {
  return (
    <PicksPanel
      key={`${league.id}:${year}`}
      league={league}
      year={year}
      header={header}
      reload={reload}
      fresh={fresh}
    />
  );
}

export function WeeklyResults({ league, year, userId, header, reload }: LeagueTabProps) {
  return (
    <LeagueTabScroll header={header} reload={reload}>
      <SeasonPanel key={`${year}:results`} league={league} year={year} userId={userId} show="results" />
    </LeagueTabScroll>
  );
}

export function WeeklyStandings({ league, year, userId, header, reload }: LeagueTabProps) {
  return (
    <LeagueTabScroll header={header} reload={reload}>
      <SeasonPanel key={`${year}:standings`} league={league} year={year} userId={userId} show="standings" />
    </LeagueTabScroll>
  );
}

export const weeklyScreens: LeagueTypeScreens = {
  tabs: { picks: WeeklyPicks, results: WeeklyResults, standings: WeeklyStandings },
  // Hands-on: Set up a week, as always. Automatic: Start season, with week setup kept as the admin's override.
  AdminTools: ({ league, year, reload }) =>
    league.management === "auto" ? (
      <>
        <AutomaticSeasonCard league={league} year={year} reload={reload} />
        {/* The season runs itself: setting a week up by hand is the override, out of the way. */}
        <Disclosure title="Set up a week by hand">
          <WeekSetupCard key={year} league={league} year={year} reload={reload} />
        </Disclosure>
      </>
    ) : (
      <WeekSetupCard key={year} league={league} year={year} reload={reload} />
    ),
  Recap: WeekRecap,
  seasonSelector: true,
};
