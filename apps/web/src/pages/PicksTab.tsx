import { currentWeek, type LeagueDetail, WEEK_PHASE_LABEL, weekLabel } from "@picks/shared";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "../router";
import { WeekLoader } from "./WeekPage";

export function PicksTab({ league, userId }: { league: LeagueDetail; userId: string }) {
  const isAdmin = league.role === "admin";
  const open = league.weeks.filter((w) => w.status === "open");
  const drafts = league.weeks.filter((w) => w.status === "draft");
  // Refreshing counts must not switch sheets underneath edits that have not been saved.
  const [focusedWeekId] = useState(() => currentWeek(league.weeks)?.id);
  const current = open.find((week) => week.id === focusedWeekId) ?? currentWeek(league.weeks);
  const lastFinal = league.weeks.find((w) => w.status === "final");
  const awaiting = open.filter((week) => week.phase === "awaiting");

  return (
    <div className="grid gap-4">
      {awaiting.map((week) => (
        <Card key={week.id} className="content-start">
          <h3 className="text-xl">{weekLabel(week.number)} · Awaiting finalization</h3>
          <p className="m-0 text-sm text-muted-foreground">
            {isAdmin
              ? "All final scores are entered. Finalize the week to reveal picks and update standings."
              : "All scores are in. Your admin will finalize the week to publish results."}
          </p>
          {isAdmin && (
            <Link to={`/weeks/${week.id}/manage`} className={buttonVariants()}>
              Review &amp; finalize {weekLabel(week.number)}
            </Link>
          )}
        </Card>
      ))}
      {/* Members never receive drafts, so this is the admin's reminder that a week is waiting on them. */}
      {drafts.map((week) => (
        <Card key={week.id} className="grid-cols-[1fr_auto] items-center">
          <p className="m-0">
            <strong>{weekLabel(week.number)}</strong> is a draft. Players can't see it yet.
          </p>
          <Link
            to={`/weeks/${week.id}/manage`}
            aria-label={`Set up ${weekLabel(week.number)}`}
            className={buttonVariants({ size: "sm" })}
          >
            Set up
          </Link>
        </Card>
      ))}

      {open.length > 1 && (
        <nav aria-label="Open weeks" className="flex flex-wrap gap-2">
          {open.map((week) => (
            <Link
              key={week.id}
              to={`/weeks/${week.id}`}
              aria-current={week.id === current?.id ? "page" : undefined}
              className={buttonVariants({
                variant: week.id === current?.id ? "secondary" : "outline",
                size: "sm",
              })}
            >
              {weekLabel(week.number)} · {WEEK_PHASE_LABEL[week.phase]}
            </Link>
          ))}
        </nav>
      )}

      {current ? (
        <WeekLoader key={current.id} weekId={current.id} userId={userId} />
      ) : (
        <Card>
          <h3 className="text-2xl">No week is open</h3>
          <p className="m-0 text-muted-foreground">
            {isAdmin
              ? "Set up a week and open it, and the pick sheet shows up here for everyone."
              : "The pick sheet shows up here as soon as the admin opens the next week."}
          </p>
          <div className="flex flex-wrap gap-2">
            {isAdmin && drafts.length === 0 && (
              <Link to={`/leagues/${league.id}/league`} className={buttonVariants()}>
                Set up a week
              </Link>
            )}
            {lastFinal && (
              <Link to={`/weeks/${lastFinal.id}`} className={buttonVariants({ variant: "outline" })}>
                {weekLabel(lastFinal.number)} results
              </Link>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
