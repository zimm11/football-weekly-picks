import { type LeagueDetail, preferredSeasonYear, seasonYear, type WeekView } from "@picks/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/card";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { api, unwrap } from "../api";
import { now } from "../clock";
import { LeagueLayout, type LeagueTab } from "../components/LeagueNav";
import { LoadError } from "../components/LoadError";
import { LeagueSkeleton } from "../components/Skeletons";
import { WeekRecap } from "../components/WeekRecap";
import { recapDecision } from "../lib/recap";
import { readSeason, rememberSeason } from "../lib/seasonSelection";
import { usePolling } from "../lib/usePolling";
import { requestLeave } from "../router";
import { LeagueTabPanel } from "./LeagueTab";
import { MessagesPage } from "./MessagesPage";
import { PicksTab } from "./PicksTab";
import { SeasonTab } from "./SeasonTab";
import { useLoad } from "./useLoad";

/** The league hub. Each tab is its own address, so the back button and shared links land where expected. */
export function LeaguePage({
  leagueId,
  userId,
  tab,
  threadId,
}: {
  leagueId: string;
  userId: string;
  tab: LeagueTab;
  threadId?: string;
}) {
  const league = useLoad(
    () => unwrap<LeagueDetail>(api.leagues[":leagueId"].$get({ param: { leagueId } })),
    leagueId,
  );
  const [selectedYear, setSelectedYear] = useState(() => readSeason(leagueId));
  const [startingSeason, setStartingSeason] = useState(false);
  const [recapWeekId, setRecapWeekId] = useState<string | null>();
  const loadedRecapWeekId = league.data?.recapWeekId;
  useEffect(() => {
    if (loadedRecapWeekId !== undefined)
      setRecapWeekId((current) => recapDecision(current, loadedRecapWeekId));
  }, [loadedRecapWeekId]);

  useEffect(() => {
    if (league.data && selectedYear === undefined) {
      setSelectedYear(preferredSeasonYear(league.data.weeks, now()));
    }
  }, [league.data, selectedYear]);

  // Availability counts and display phases are computed by the API using its clock.
  usePolling(league.reload, 30_000);

  if (league.error && !league.data) return <LoadError message={league.error} onRetry={league.reload} />;
  if (!league.data) {
    return <LeagueSkeleton shape={tab === "picks" ? "week" : tab === "standings" ? "standings" : "list"} />;
  }
  const detail = league.data;
  const currentYear = seasonYear(now());
  const year = selectedYear ?? preferredSeasonYear(detail.weeks, now());
  const years = [...new Set([currentYear, year, ...detail.weeks.map((week) => week.year)])].sort(
    (a, b) => b - a,
  );
  const nextYear = Math.min(2100, Math.max(currentYear, ...detail.weeks.map((week) => week.year + 1)));
  const seasonLeague = { ...detail, weeks: detail.weeks.filter((week) => week.year === year) };

  function chooseYear(value: number) {
    requestLeave(() => {
      setSelectedYear(value);
      rememberSeason(leagueId, value);
      setStartingSeason(false);
    });
  }

  return (
    <LeagueLayout
      leagueId={leagueId}
      leagueName={detail.name}
      active={tab}
      boardShown={tab === "messages" && !threadId}
      seasonSelector={
        tab !== "messages" && (
          <NativeSelect
            aria-label="Season"
            value={startingSeason ? "new" : year}
            onChange={(event) => {
              if (event.target.value === "new") setStartingSeason(true);
              else chooseYear(Number(event.target.value));
            }}
            className="h-11 w-28 shrink-0 truncate rounded-full border-transparent bg-raised pr-2 pl-4 text-sm font-semibold"
          >
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
                {detail.weeks.some((week) => week.year === value) ? "" : " · Not started"}
              </option>
            ))}
            {detail.role === "admin" && <option value="new">New season…</option>}
          </NativeSelect>
        )
      }
      seasonPanel={
        tab !== "messages" &&
        startingSeason &&
        detail.role === "admin" && (
          <Card aria-label="Start a new season">
            <h3 className="text-2xl">Start a new season</h3>
            <p className="m-0 text-sm text-muted-foreground">
              Use the year the NFL season starts. Your league and members carry over. The season is created
              when you prepare its first week.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                chooseYear(Number(new FormData(event.currentTarget).get("year")));
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <Field label="New season year" className="w-40">
                <Input name="year" type="number" required min={2020} max={2100} defaultValue={nextYear} />
              </Field>
              <Button type="submit">Use season</Button>
              <Button type="button" variant="outline" onClick={() => setStartingSeason(false)}>
                Cancel
              </Button>
            </form>
          </Card>
        )
      }
    >
      {league.error && <Notice kind="alert">{league.error}</Notice>}
      {recapWeekId && tab !== "messages" && tab !== "league" && (
        <RecapLoader weekId={recapWeekId} userId={userId} onClose={() => setRecapWeekId(null)} />
      )}
      {tab === "messages" && (
        <MessagesPage key={threadId ?? "board"} leagueId={leagueId} threadId={threadId} />
      )}
      {tab === "picks" && <PicksTab key={year} league={seasonLeague} userId={userId} />}
      {(tab === "results" || tab === "standings") && (
        <SeasonTab key={`${year}:${tab}`} league={seasonLeague} year={year} userId={userId} show={tab} />
      )}
      {tab === "league" && (
        <LeagueTabPanel
          key={year}
          league={seasonLeague}
          year={year}
          userId={userId}
          onChanged={league.reload}
        />
      )}
    </LeagueLayout>
  );
}

/**
 * Slides the results of a week closed since the player's last visit up over the league, once. Anything that
 * goes wrong loading it is left alone: the results are still on the Results tab.
 */
function RecapLoader({ weekId, userId, onClose }: { weekId: string; userId: string; onClose: () => void }) {
  const week = useLoad(() => unwrap<WeekView>(api.weeks[":weekId"].$get({ param: { weekId } })), weekId);
  const shown = week.data?.status === "final" && week.data.results !== null;

  useEffect(() => {
    if (shown) api.weeks[":weekId"].recap.seen.$post({ param: { weekId } }).catch(() => {});
  }, [shown, weekId]);

  if (!week.data || !shown) return null;
  return <WeekRecap view={week.data} userId={userId} onClose={onClose} />;
}
