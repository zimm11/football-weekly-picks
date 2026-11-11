import type { WeekView } from "@picks/shared";
import { useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { GameEditor, type GameUpdate } from "../components/GameEditor";
import { WeekResultsTable } from "../components/WeekResultsTable";
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
  const [error, setError] = useState(flash?.kind === "alert" ? flash.text : "");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  /** Runs admin actions in order; each answers with the updated week. Stops at the first failure. */
  async function act(calls: ApiCall[], done = "") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      for (const call of calls) week.setData(await unwrap<WeekView>(call()));
      setNotice(done);
    } catch (err) {
      setError(messageOf(err));
    }
    setBusy(false);
  }

  if (week.error) return <p role="alert">{week.error}</p>;
  const view = week.data;
  if (!view) return <p>Loading…</p>;
  if (view.role !== "admin") {
    return (
      <>
        <WeekHeading view={view} />
        <p>
          Only the league admin can manage a week. <Link to={`/weeks/${view.id}`}>Go to the week</Link>
        </p>
      </>
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

  return (
    <>
      <WeekHeading view={view} />
      <p>
        {view.status === "open" && <Link to={`/weeks/${view.id}`}>Make your own picks</Link>}
        {view.status === "final" && <Link to={`/weeks/${view.id}`}>See the week as players do</Link>}
      </p>

      <section className="card stack" aria-label="Week admin">
        <h3 style={{ margin: 0 }}>Manage week</h3>

        {view.status === "draft" && (
          <>
            <p className="muted" style={{ margin: 0 }}>
              Players can't see this week yet. Check the games and spreads, then open it. Spreads stay fixed
              once the week is open unless you change them here.
            </p>
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={busy || view.games.length === 0}
                onClick={() =>
                  act([() => api.weeks[":weekId"].open.$post({ param })], "Week opened for picks.")
                }
              >
                Open week for picks
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const warning =
                    "Refresh from ESPN? Kickoffs and spreads you changed by hand will be replaced.";
                  if (view.games.length === 0 || window.confirm(warning)) {
                    act([() => api.weeks[":weekId"].import.$post({ param })], "Schedule imported.");
                  }
                }}
              >
                {view.games.length ? "Refresh from ESPN" : "Import from ESPN"}
              </button>
            </div>
          </>
        )}

        {view.status === "open" && (
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() => act([() => api.weeks[":weekId"].results.$post({ param })], "Results updated.")}
            >
              Pull results from ESPN
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || missingScores > 0}
              onClick={() => {
                if (window.confirm("Close the week? Everyone's picks and the winner will be revealed.")) {
                  act([() => api.weeks[":weekId"].finalize.$post({ param })]);
                }
              }}
            >
              Close week
            </button>
            <span className="muted">
              {missingScores > 0
                ? `${missingScores} of ${view.games.length} games still need a final score.`
                : "All games are final."}
            </span>
          </div>
        )}

        {view.status === "final" && (
          <div className="row">
            <button
              type="button"
              disabled={busy}
              onClick={() => act([() => api.weeks[":weekId"].reopen.$post({ param })], "Week reopened.")}
            >
              Reopen week
            </button>
            <span className="muted">
              Reopen to correct a score or spread. Picks are hidden again until you close it.
            </span>
          </div>
        )}

        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>

      {view.status === "open" && view.submissions && (
        <section className="card">
          <h3>Who has picked</h3>
          <div className="table-scroll">
            <table aria-label="Who has picked">
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
                    <td>{s.displayName}</td>
                    <td className="num">
                      {s.pickCount} of {view.games.length}
                    </td>
                    <td>{s.hasPow ? "Chosen" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view.status === "final" && view.results ? (
        <section className="card">
          <h3>Results</h3>
          <WeekResultsTable
            games={view.games}
            results={view.results}
            tiebreakerGameId={view.tiebreakerGameId}
            currentUserId={userId}
          />
        </section>
      ) : (
        <section className="card">
          <h3>Games</h3>
          <GameEditor
            games={view.games}
            status={view.status}
            tiebreakerGameId={view.tiebreakerGameId}
            timeZone={view.timeZone}
            onSave={saveGames}
            onRemove={(gameId) => {
              const warning =
                view.status === "open"
                  ? "Remove this game? Picks already made on it are deleted."
                  : "Remove this game?";
              if (window.confirm(warning)) act([() => api.games[":gameId"].$delete({ param: { gameId } })]);
            }}
            onAdd={(json) => act([() => api.weeks[":weekId"].games.$post({ param, json })], "Game added.")}
            onSetTiebreaker={(tiebreakerGameId) =>
              act([() => api.weeks[":weekId"].$patch({ param, json: { tiebreakerGameId } })])
            }
          />
        </section>
      )}
    </>
  );
}
