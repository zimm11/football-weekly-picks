import type { WeekView } from "@picks/shared";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, Notice } from "@/components/ui/card";
import { api, messageOf, unwrap } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { GameEditor, type GameUpdate } from "../components/GameEditor";
import { LeagueLayout } from "../components/LeagueNav";
import { WeekResultsTable } from "../components/WeekResultsTable";
import { notifyDone, notifyError } from "../notify";
import { Link, useFlash } from "../router";
import { useLoad } from "./useLoad";
import { WeekHeading } from "./WeekPage";

type ApiCall = () => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** The admin's screen for a week: set it up, open it, enter results, close it. Picks are made on the week page. */
export function ManageWeekPage({ weekId, userId }: { weekId: string; userId: string }) {
  const param = { weekId };
  const week = useLoad(() => unwrap<WeekView>(api.weeks[":weekId"].$get({ param })), weekId);
  // Carries the schedule-import warning from the league page when this week was just created.
  const flash = useFlash();
  const [importWarning, setImportWarning] = useState(flash?.kind === "alert" ? flash.text : "");
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  /** Runs admin actions in order; each answers with the updated week. Stops at the first failure. */
  async function act(calls: ApiCall[], done = "") {
    setBusy(true);
    setImportWarning("");
    try {
      for (const call of calls) week.setData(await unwrap<WeekView>(call()));
      // Announced in the banner above the save bar, so it reads from whichever button was pressed.
      if (done) notifyDone(done);
    } catch (err) {
      notifyError(messageOf(err));
    }
    setBusy(false);
  }

  if (week.error) return <Notice kind="alert">{week.error}</Notice>;
  const view = week.data;
  if (!view) return <p className="text-muted-foreground">Loading…</p>;
  if (view.role !== "admin") {
    return (
      <LeagueLayout leagueId={view.leagueId} leagueName={view.leagueName} active="picks">
        <WeekHeading view={view} />
        <p className="m-0">
          Only the league admin can manage a week. <Link to={`/weeks/${view.id}`}>Go to the week</Link>
        </p>
      </LeagueLayout>
    );
  }

  const missingScores = view.games.filter((g) => g.homeScore === null).length;
  const saveGames = (updates: GameUpdate[]) =>
    act(
      updates.map(
        ({ gameId, changes }) =>
          () =>
            api.games[":gameId"].$patch({ param: { gameId }, json: changes }),
      ),
      "Changes saved.",
    );

  async function importSchedule(current: WeekView) {
    const ok =
      current.games.length === 0 ||
      (await confirm({
        title: "Refresh from ESPN?",
        detail: "Kickoffs and spreads you changed by hand will be replaced.",
        action: "Refresh",
      }));
    if (ok) act([() => api.weeks[":weekId"].import.$post({ param })], "Schedule imported.");
  }

  async function closeWeek() {
    const ok = await confirm({
      title: "Close the week?",
      detail: "Everyone's picks and the winner will be revealed.",
      action: "Close week",
    });
    if (ok) act([() => api.weeks[":weekId"].finalize.$post({ param })], "Week closed. Results are in.");
  }

  async function removeGame(current: WeekView, gameId: string) {
    const ok = await confirm({
      title: "Remove this game?",
      detail:
        current.status === "open" ? "Picks already made on it are deleted." : "You can add it back later.",
      action: "Remove game",
    });
    if (ok) act([() => api.games[":gameId"].$delete({ param: { gameId } })], "Game removed.");
  }

  return (
    <LeagueLayout leagueId={view.leagueId} leagueName={view.leagueName} active="league">
      {confirmDialog}
      <WeekHeading
        view={view}
        action={
          view.status !== "draft" && (
            <Link to={`/weeks/${view.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {view.status === "open" ? "Make your own picks" : "See the week as players do"}
            </Link>
          )
        }
      />

      <Card aria-label="Week admin">
        <Eyebrow>Manage week</Eyebrow>

        {view.status === "draft" && (
          <>
            <p className="m-0 text-sm text-muted-foreground">
              Players can't see this week yet. Check the games and spreads, then open it. Spreads stay fixed
              once the week is open unless you change them here.
            </p>
            <div className="grid gap-2 sm:flex">
              <Button
                type="button"
                disabled={busy || view.games.length === 0}
                onClick={() =>
                  act([() => api.weeks[":weekId"].open.$post({ param })], "Week opened for picks.")
                }
              >
                Open week for picks
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => importSchedule(view)}>
                {view.games.length ? "Refresh from ESPN" : "Import from ESPN"}
              </Button>
            </div>
          </>
        )}

        {view.status === "open" && (
          <>
            <p className="m-0 text-sm text-muted-foreground">
              {missingScores > 0
                ? `${missingScores} of ${view.games.length} games still need a final score.`
                : "All games are final."}
            </p>
            <div className="grid gap-2 sm:flex">
              <Button type="button" disabled={busy || missingScores > 0} onClick={closeWeek}>
                Close week
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => act([() => api.weeks[":weekId"].results.$post({ param })], "Results updated.")}
              >
                Pull results from ESPN
              </Button>
            </div>
          </>
        )}

        {view.status === "final" && (
          <>
            <p className="m-0 text-sm text-muted-foreground">
              Reopen to correct a score or spread. Picks are hidden again until you close it.
            </p>
            <div className="grid gap-2 sm:flex">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => act([() => api.weeks[":weekId"].reopen.$post({ param })], "Week reopened.")}
              >
                Reopen week
              </Button>
            </div>
          </>
        )}

        {importWarning && <Notice kind="alert">{importWarning}</Notice>}
      </Card>

      {view.status === "open" && view.submissions && (
        <Card>
          <Eyebrow>Who has picked</Eyebrow>
          <div className="table-scroll">
            <table aria-label="Who has picked" className="data-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th className="num">Picks in</th>
                  <th>POW</th>
                </tr>
              </thead>
              <tbody>
                {view.submissions.map((s) => (
                  <tr key={s.userId}>
                    <td className="font-medium">{s.displayName}</td>
                    <td className="num">
                      {s.pickCount} of {view.games.length}
                    </td>
                    <td>{s.hasPow ? "Chosen" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {view.status === "final" && view.results ? (
        <WeekResultsTable
          games={view.games}
          results={view.results}
          tiebreakerGameId={view.tiebreakerGameId}
          currentUserId={userId}
        />
      ) : (
        <div className="grid gap-3">
          <Eyebrow>Games</Eyebrow>
          <GameEditor
            games={view.games}
            status={view.status}
            tiebreakerGameId={view.tiebreakerGameId}
            timeZone={view.timeZone}
            onSave={saveGames}
            busy={busy}
            onRemove={(gameId) => removeGame(view, gameId)}
            onAdd={(json) => act([() => api.weeks[":weekId"].games.$post({ param, json })], "Game added.")}
            onSetTiebreaker={(tiebreakerGameId) =>
              act(
                [() => api.weeks[":weekId"].$patch({ param, json: { tiebreakerGameId } })],
                "Tiebreaker game changed.",
              )
            }
          />
        </div>
      )}
    </LeagueLayout>
  );
}
