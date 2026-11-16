import { CaretRightIcon } from "@phosphor-icons/react";
import { type LeagueDetail, type Standings, weekLabel } from "@picks/shared";
import { Card, Eyebrow } from "@/components/ui/card";
import { api, unwrap } from "../api";
import { LoadError } from "../components/LoadError";
import { PickSplitsTable, WeekByWeekTable, YourSeason } from "../components/SeasonDashboard";
import { StandingsSkeleton } from "../components/Skeletons";
import { StandingsTable } from "../components/StandingsTable";
import { ordinal } from "../format";
import { Link } from "../router";
import { rowLink } from "./LeaguesPage";
import { useLoad } from "./useLoad";

/** Results and standings are both per season, and share the season picker. */
export function SeasonTab({
  league,
  year,
  userId,
  show,
}: {
  league: LeagueDetail;
  year: number;
  userId: string;
  show: "results" | "standings";
}) {
  const standings = useLoad(
    () =>
      unwrap<Standings>(
        api.leagues[":leagueId"].standings.$get({
          param: { leagueId: league.id },
          query: { year: year.toString() },
        }),
      ),
    `${league.id}:${year}`,
  );

  if (standings.error) return <LoadError message={standings.error} onRetry={standings.reload} />;
  if (!standings.data) return <StandingsSkeleton />;
  const shownYear = standings.data.year;
  const me = standings.data.entries.find((e) => e.userId === userId);
  const finals = league.weeks.filter(
    (w) => w.status === "final" && (shownYear === null || w.year === shownYear),
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-4xl leading-none font-extrabold">
          {show === "results" ? "Results" : "Standings"}{" "}
          {/* The season pill in the league header already shows the year. */}
          {shownYear !== null && <span className="sr-only">· {shownYear}</span>}
        </h3>
      </div>

      {show === "results" &&
        (finals.length === 0 ? (
          <Card>
            <p className="m-0 text-muted-foreground">
              No week has closed yet. Everyone's picks and the winner show up here once one does.
            </p>
          </Card>
        ) : (
          <ul className="m-0 grid list-none gap-2 p-0">
            {finals.map((week) => {
              const index = standings.data?.weeks.findIndex((w) => w.id === week.id) ?? -1;
              const summary = standings.data?.weeks[index];
              const winners = summary?.winners ?? [];
              const mine = me?.weekly[index];
              return (
                <li key={week.id}>
                  <Link to={`/weeks/${week.id}`} className={rowLink}>
                    <span className="font-display text-2xl font-bold tracking-wide uppercase">
                      {weekLabel(week.number)}
                    </span>
                    <span className="mr-auto grid text-sm text-muted-foreground">
                      <span>
                        {winners.length ? `Won by ${winners.join(", ")}` : "Final"}
                        {summary?.topPoints != null && ` · ${summary.topPoints} pts`}
                      </span>
                      {summary && summary.lowPointLosers.length > 0 && (
                        <span>LPL: {summary.lowPointLosers.join(", ")}</span>
                      )}
                    </span>
                    {mine && (
                      <span className="grid text-right">
                        <span
                          className={`font-display text-xl leading-none font-bold ${mine.isWinner ? "text-win" : ""}`}
                        >
                          {mine.points}
                          <span className="sr-only"> points for you,</span>
                        </span>
                        <span className="text-xs text-muted-foreground">You · {ordinal(mine.rank)}</span>
                      </span>
                    )}
                    <CaretRightIcon aria-hidden className="size-5 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}

      {show === "standings" && (
        <>
          <YourSeason standings={standings.data} currentUserId={userId} />
          <section aria-label="Leaderboard" className="grid gap-3">
            {standings.data.weeks.length > 0 && <Eyebrow>Leaderboard</Eyebrow>}
            <StandingsTable entries={standings.data.entries} currentUserId={userId} />
            <p className="m-0 text-xs text-muted-foreground">
              Closed weeks only. Ties go to POWs won, then wins, then MNF and SNF wins.
            </p>
          </section>
          {standings.data.weeks.length > 0 && (
            <>
              <WeekByWeekTable standings={standings.data} currentUserId={userId} />
              <PickSplitsTable entries={standings.data.entries} currentUserId={userId} />
            </>
          )}
        </>
      )}
    </div>
  );
}
