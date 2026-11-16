import type { GameInsights, SubmitPicks, WeekView } from "@picks/shared";
import { WEEK_PHASE_LABEL, weekLabel, weekPhase } from "@picks/shared";
import { type ReactNode, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, messageOf, unwrap } from "../api";
import { now as clockNow } from "../clock";
import { LeagueLayout } from "../components/LeagueNav";
import { LoadError } from "../components/LoadError";
import { PickSheet } from "../components/PickSheet";
import { LeagueSkeleton, WeekSkeleton } from "../components/Skeletons";
import { WeekAwards } from "../components/WeekAwards";
import { WeekResultsTable } from "../components/WeekResultsTable";
import { GameBreakdown, WeekSummary } from "../components/WeekSummary";
import { offerHomeScreen } from "../lib/homeScreen";
import { rememberSeason } from "../lib/seasonSelection";
import { usePolling } from "../lib/usePolling";
import { Link } from "../router";
import { useLoad } from "./useLoad";
import { useNow } from "./useNow";

/**
 * The week's number and state, with room on the right for the one thing to do next. `yearShown` says the
 * season is already on screen (the league header's season pill), so the year is left to screen readers.
 */
export function WeekHeading({
  view,
  action,
  now,
  yearShown = false,
}: {
  view: WeekView;
  action?: ReactNode;
  now: Date;
  yearShown?: boolean;
}) {
  const phase = weekPhase(view.status, view.games, now);
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="grid gap-1.5">
        <Badge variant={view.status === "open" ? "default" : "outline"}>{WEEK_PHASE_LABEL[phase]}</Badge>
        <h3 className="text-5xl leading-[0.9] font-extrabold">
          {weekLabel(view.number)}{" "}
          <span className={yearShown ? "sr-only" : "text-2xl text-muted-foreground"}>· {view.year}</span>
        </h3>
      </div>
      {action}
    </div>
  );
}

/** A player's view of a week: their pick sheet while it is open, everyone's results once it is closed. */
export function WeekBody({
  view,
  userId,
  onChange,
  yearShown,
}: {
  view: WeekView;
  userId: string;
  /** The league header is showing the season, so the heading needn't. */
  yearShown?: boolean;
  /** Hands back the week as it stands after a save. */
  onChange: (view: WeekView) => void;
}) {
  const now = useNow();
  const phase = weekPhase(view.status, view.games, now);
  useEffect(() => rememberSeason(view.leagueId, view.year), [view.leagueId, view.year]);

  async function savePicks(json: SubmitPicks) {
    try {
      onChange(await unwrap<WeekView>(api.weeks[":weekId"].picks.$put({ param: { weekId: view.id }, json })));
      // Right after saving is when coming back next week is on the player's mind.
      offerHomeScreen();
      return undefined;
    } catch (err) {
      return messageOf(err);
    }
  }

  return (
    <div className="grid gap-4">
      <WeekHeading
        view={view}
        now={now}
        yearShown={yearShown}
        action={
          view.role === "admin" && (
            <Link
              to={`/weeks/${view.id}/manage`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Manage week
            </Link>
          )
        }
      />

      {phase === "awaiting" && (
        <Card>
          <h4 className="text-lg text-foreground">Awaiting finalization</h4>
          <p className="m-0 text-sm text-muted-foreground">
            All final scores are entered. Picks stay private and this week does not count in standings until
            the admin finalizes it.
          </p>
        </Card>
      )}

      {phase === "underway" &&
        !view.games.some((game) => game.homeScore === null && new Date(game.kickoff) > now) && (
          <p className="m-0 text-sm text-muted-foreground">
            All games have locked. Results fill in as games end; the week counts once an admin finalizes it.
          </p>
        )}

      {view.status === "draft" && (
        <Card>
          <p className="m-0">This week hasn't been opened for picks yet.</p>
        </Card>
      )}

      {view.status === "open" && (
        <>
          <PickSheet
            games={view.games}
            picks={view.myPicks}
            tiebreakerGameId={view.tiebreakerGameId}
            tiebreakerTotal={view.myTiebreakerTotal}
            timeZone={view.timeZone}
            now={now}
            clock={clockNow}
            onSave={savePicks}
            loadInsights={(gameId) =>
              unwrap<GameInsights>(api.games[":gameId"].insights.$get({ param: { gameId } }))
            }
          />
          <p className="m-0 text-sm text-muted-foreground">
            Everyone's picks are revealed when the week closes.
          </p>
        </>
      )}

      {view.status === "final" && view.results && (
        <>
          <WeekSummary
            games={view.games}
            results={view.results}
            tiebreakerGameId={view.tiebreakerGameId}
            currentUserId={userId}
          />
          <WeekResultsTable
            games={view.games}
            results={view.results}
            tiebreakerGameId={view.tiebreakerGameId}
            currentUserId={userId}
          />
          <WeekAwards games={view.games} results={view.results} tiebreakerGameId={view.tiebreakerGameId} />
          <GameBreakdown games={view.games} results={view.results} />
        </>
      )}
    </div>
  );
}

/** How often an open week is fetched again while its games are being played. The API asks ESPN at most this often. */
const RESULTS_REFRESH_MS = 60_000;

/**
 * While any game in an open week has kicked off without a result, fetches the week again every minute (and
 * when the player comes back to the tab), so their picks are marked won or lost as games end. Stops once
 * every game that has started has its result.
 */
function useResultsRefresh(view: WeekView | undefined, reload: () => void) {
  const now = useNow();
  const live =
    view?.status === "open" && view.games.some((g) => g.homeScore === null && new Date(g.kickoff) <= now);
  usePolling(reload, RESULTS_REFRESH_MS, live);
}

const loadWeek = (weekId: string) => unwrap<WeekView>(api.weeks[":weekId"].$get({ param: { weekId } }));

/** Loads a week and shows it. The Picks tab uses this for the current week. */
export function WeekLoader({ weekId, userId }: { weekId: string; userId: string }) {
  const week = useLoad(() => loadWeek(weekId), weekId);
  useResultsRefresh(week.data, week.reload);
  // A refresh that fails leaves the sheet as it was; only a first load that fails has nothing to show.
  if (week.error && !week.data) return <LoadError message={week.error} onRetry={week.reload} />;
  if (!week.data) return <WeekSkeleton />;
  return <WeekBody view={week.data} userId={userId} onChange={week.setData} yearShown />;
}

/** `/weeks/:id`: one week, reached from the results list or a link someone shared. */
export function WeekPage({ weekId, userId }: { weekId: string; userId: string }) {
  const week = useLoad(() => loadWeek(weekId), weekId);
  useResultsRefresh(week.data, week.reload);
  if (week.error && !week.data) return <LoadError message={week.error} onRetry={week.reload} />;
  const view = week.data;
  if (!view) return <LeagueSkeleton />;
  return (
    <LeagueLayout
      leagueId={view.leagueId}
      leagueName={view.leagueName}
      active={view.status === "final" ? "results" : "picks"}
    >
      <WeekBody view={view} userId={userId} onChange={week.setData} />
    </LeagueLayout>
  );
}
