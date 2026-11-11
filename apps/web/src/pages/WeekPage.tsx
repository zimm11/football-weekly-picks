import { type SubmitPicks, type WeekView, weekLabel } from "@picks/shared";
import { useEffect, useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { PickSheet } from "../components/PickSheet";
import { WeekResultsTable } from "../components/WeekResultsTable";
import { Link, navigate } from "../router";
import { useLoad } from "./useLoad";

export const STATUS_LABEL = { draft: "Draft", open: "Open for picks", final: "Final" } as const;

/** Re-renders every 30 seconds so locks take effect on screen without a reload. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function WeekHeading({ view }: { view: WeekView }) {
  return (
    <>
      <p className="muted">
        <Link to={`/leagues/${view.leagueId}`}>← {view.leagueName}</Link>
      </p>
      <div className="row">
        <h2>
          {weekLabel(view.number)} · {view.year}
        </h2>
        <span className="badge">{STATUS_LABEL[view.status]}</span>
      </div>
    </>
  );
}

/** A player's view of a week: their pick sheet while it is open, everyone's results once it is closed. */
export function WeekPage({ weekId, userId }: { weekId: string; userId: string }) {
  const param = { weekId };
  const week = useLoad(() => unwrap<WeekView>(api.weeks[":weekId"].$get({ param })), weekId);
  const now = useNow();

  async function savePicks(json: SubmitPicks) {
    try {
      const saved = await unwrap<WeekView>(api.weeks[":weekId"].picks.$put({ param, json }));
      // Back to the league, where the week now shows how many games are picked.
      navigate(`/leagues/${saved.leagueId}`, {
        kind: "status",
        text: `${weekLabel(saved.number)} picks saved: ${saved.myPicks.length} of ${saved.games.length} games picked.`,
      });
      return undefined;
    } catch (err) {
      return messageOf(err);
    }
  }

  if (week.error) return <p role="alert">{week.error}</p>;
  const view = week.data;
  if (!view) return <p>Loading…</p>;

  return (
    <>
      <WeekHeading view={view} />
      {view.role === "admin" && (
        <p>
          <Link to={`/weeks/${view.id}/manage`}>Manage this week</Link>
          <span className="muted"> · games, spreads, results</span>
        </p>
      )}

      {view.status === "draft" && (
        <section className="card">
          <p style={{ margin: 0 }}>This week hasn't been opened for picks yet.</p>
        </section>
      )}

      {view.status === "open" && (
        <section className="card">
          <h3>Your picks</h3>
          <PickSheet
            games={view.games}
            picks={view.myPicks}
            tiebreakerGameId={view.tiebreakerGameId}
            tiebreakerTotal={view.myTiebreakerTotal}
            timeZone={view.timeZone}
            now={now}
            onSave={savePicks}
          />
          <p className="muted">Everyone's picks are revealed when the week closes.</p>
        </section>
      )}

      {view.status === "final" && view.results && (
        <section className="card">
          <h3>Results</h3>
          <WeekResultsTable
            games={view.games}
            results={view.results}
            tiebreakerGameId={view.tiebreakerGameId}
            currentUserId={userId}
          />
        </section>
      )}
    </>
  );
}
