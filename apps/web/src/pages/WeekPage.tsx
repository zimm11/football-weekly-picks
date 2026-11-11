import type { SubmitPicks, WeekView } from "@picks/shared";
import { WEEK_PHASE_LABEL, weekLabel, weekPhase } from "@picks/shared";
import { type ReactNode, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/card";
import { api, messageOf, unwrap } from "../api";
import { LeagueLayout } from "../components/LeagueNav";
import { PickSheet } from "../components/PickSheet";
import { WeekResultsTable } from "../components/WeekResultsTable";
import { GameBreakdown, WeekSummary } from "../components/WeekSummary";
import { rememberSeason } from "../lib/seasonSelection";
import { Link } from "../router";
import { useLoad } from "./useLoad";
import { useNow } from "./useNow";

/** The week's number and state, with room on the right for the one thing to do next. */
export function WeekHeading({ view, action, now }: { view: WeekView; action?: ReactNode; now: Date }) {
  const phase = weekPhase(view.status, view.games, now);
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="grid gap-1.5">
        <Badge variant={view.status === "open" ? "default" : "outline"}>{WEEK_PHASE_LABEL[phase]}</Badge>
        <h3 className="text-5xl leading-[0.9] font-extrabold">
          {weekLabel(view.number)} <span className="text-2xl text-muted-foreground">· {view.year}</span>
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
}: {
  view: WeekView;
  userId: string;
  /** Hands back the week as it stands after a save. */
  onChange: (view: WeekView) => void;
}) {
  const now = useNow();
  const phase = weekPhase(view.status, view.games, now);
  useEffect(() => rememberSeason(view.leagueId, view.year), [view.leagueId, view.year]);

  async function savePicks(json: SubmitPicks) {
    try {
      onChange(await unwrap<WeekView>(api.weeks[":weekId"].picks.$put({ param: { weekId: view.id }, json })));
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
          <h4 className="text-xl">Awaiting finalization</h4>
          <p className="m-0 text-sm text-muted-foreground">
            All final scores are entered. Picks stay private and this week does not count in standings until
            the admin finalizes it.
          </p>
        </Card>
      )}

      {phase === "underway" &&
        !view.games.some((game) => game.homeScore === null && new Date(game.kickoff) > now) && (
          <p className="m-0 text-sm text-muted-foreground">
            All games have locked for picks. Waiting for final scores and admin finalization.
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
            onSave={savePicks}
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
          <GameBreakdown games={view.games} results={view.results} />
        </>
      )}
    </div>
  );
}

/** Loads a week and shows it. The Picks tab uses this for the current week. */
export function WeekLoader({ weekId, userId }: { weekId: string; userId: string }) {
  const week = useLoad(() => unwrap<WeekView>(api.weeks[":weekId"].$get({ param: { weekId } })), weekId);
  if (week.error) return <Notice kind="alert">{week.error}</Notice>;
  if (!week.data) return <p className="text-muted-foreground">Loading…</p>;
  return <WeekBody view={week.data} userId={userId} onChange={week.setData} />;
}

/** `/weeks/:id`: one week, reached from the results list or a link someone shared. */
export function WeekPage({ weekId, userId }: { weekId: string; userId: string }) {
  const week = useLoad(() => unwrap<WeekView>(api.weeks[":weekId"].$get({ param: { weekId } })), weekId);
  if (week.error) return <Notice kind="alert">{week.error}</Notice>;
  const view = week.data;
  if (!view) return <p className="text-muted-foreground">Loading…</p>;
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
