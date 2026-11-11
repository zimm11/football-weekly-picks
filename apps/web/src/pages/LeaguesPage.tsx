import type { InvitePreview, LeagueSummary } from "@picks/shared";
import { type FormEvent, useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { Link, navigate } from "../router";
import { useLoad } from "./useLoad";

export function LeaguesPage() {
  const leagues = useLoad(() => unwrap<LeagueSummary[]>(api.leagues.$get()), "leagues");
  const [error, setError] = useState<string>();

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name"));
    // The 6am game-day lock is measured in the league's time zone; start with the creator's.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
      const { id } = await unwrap<{ id: string }>(api.leagues.$post({ json: { name, timeZone } }));
      navigate(`/leagues/${id}`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (leagues.error) return <p role="alert">{leagues.error}</p>;
  if (!leagues.data) return <p>Loading…</p>;
  return (
    <>
      <h2>Your leagues</h2>
      <section className="card">
        {leagues.data.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            You're not in a league yet. To join one, open the invite link from its admin. Or start your own
            below.
          </p>
        ) : (
          <ul className="plain">
            {leagues.data.map((league) => (
              <li key={league.id}>
                <Link to={`/leagues/${league.id}`}>{league.name}</Link>
                {league.role === "admin" && <span className="badge">Admin</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h3>Start a league</h3>
        <form onSubmit={create} className="row" style={{ alignItems: "end" }}>
          <label>
            League name
            <input name="name" required maxLength={80} />
          </label>
          <button type="submit" className="primary">
            Create league
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}

export function JoinPage({ code }: { code: string }) {
  const invite = useLoad(() => unwrap<InvitePreview>(api.invites[":code"].$get({ param: { code } })), code);
  const [error, setError] = useState<string>();

  async function join() {
    try {
      const { leagueId } = await unwrap<{ leagueId: string }>(
        api.invites[":code"].join.$post({ param: { code } }),
      );
      navigate(`/leagues/${leagueId}`);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  if (invite.error) return <p role="alert">{invite.error}</p>;
  if (!invite.data) return <p>Loading…</p>;
  return (
    <section className="card stack">
      <h2>{invite.data.leagueName}</h2>
      {invite.data.alreadyMember ? (
        <p>
          You're already in this league. <Link to={`/leagues/${invite.data.leagueId}`}>Go to the league</Link>
        </p>
      ) : (
        <>
          <p style={{ margin: 0 }}>You've been invited to join this league.</p>
          <div>
            <button type="button" className="primary" onClick={join}>
              Join league
            </button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
