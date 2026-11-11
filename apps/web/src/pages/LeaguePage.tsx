import { type LeagueDetail, MAX_WEEK, type Standings, type WeekSummary, weekLabel } from "@picks/shared";
import { type FormEvent, useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { StandingsTable } from "../components/StandingsTable";
import { seasonYear } from "../format";
import { Link, navigate, useFlash } from "../router";
import { useLoad } from "./useLoad";

/** The zones offered for the 6am lock. A league already on another zone keeps it as an extra option. */
const TIME_ZONES: Record<string, string> = {
  "America/New_York": "Eastern",
  "America/Chicago": "Central",
  "America/Denver": "Mountain",
  "America/Phoenix": "Arizona",
  "America/Los_Angeles": "Pacific",
  "America/Anchorage": "Alaska",
  "Pacific/Honolulu": "Hawaii",
};
const zoneName = (timeZone: string) => TIME_ZONES[timeZone] ?? timeZone;

export function LeaguePage({ leagueId, userId }: { leagueId: string; userId: string }) {
  const [year, setYear] = useState<number>();
  const flash = useFlash();
  const league = useLoad(
    () => unwrap<LeagueDetail>(api.leagues[":leagueId"].$get({ param: { leagueId } })),
    leagueId,
  );
  const standings = useLoad(
    () =>
      unwrap<Standings>(
        api.leagues[":leagueId"].standings.$get({ param: { leagueId }, query: { year: year?.toString() } }),
      ),
    `${leagueId}:${year}`,
  );

  if (league.error) return <p role="alert">{league.error}</p>;
  if (!league.data) return <p>Loading…</p>;
  const isAdmin = league.data.role === "admin";
  const shownYear = standings.data?.year ?? null;
  const weeks = league.data.weeks.filter((w) => shownYear === null || w.year === shownYear);

  return (
    <>
      <p className="muted">
        <Link to="/">← All leagues</Link>
      </p>
      <h2>{league.data.name}</h2>
      {flash && <p role={flash.kind}>{flash.text}</p>}

      {standings.data && standings.data.years.length > 1 && (
        <label className="inline">
          Season
          <select value={shownYear ?? ""} onChange={(e) => setYear(Number(e.target.value))}>
            {standings.data.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      )}

      <section className="card">
        <h3>Weeks{shownYear ? ` · ${shownYear} season` : ""}</h3>
        {weeks.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No weeks yet.{isAdmin ? " Set one up below." : " The admin hasn't opened one."}
          </p>
        ) : (
          <ul className="plain">
            {weeks.map((week) => (
              <WeekRow
                key={week.id}
                week={week}
                isAdmin={isAdmin}
                winners={standings.data?.weeks.find((w) => w.id === week.id)?.winners ?? []}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h3>Season standings{shownYear ? ` · ${shownYear}` : ""}</h3>
        {standings.error && <p role="alert">{standings.error}</p>}
        {standings.data && <StandingsTable entries={standings.data.entries} currentUserId={userId} />}
        <p className="muted">
          Standings count closed weeks only. The 6am game-day lock uses {zoneName(league.data.timeZone)} time.
        </p>
      </section>

      {isAdmin && (
        <AdminPanel league={league.data} userId={userId} onChanged={league.reload} defaultYear={shownYear} />
      )}
    </>
  );
}

function WeekRow({ week, isAdmin, winners }: { week: WeekSummary; isAdmin: boolean; winners: string[] }) {
  const remaining = week.gameCount - week.myPickCount;
  let status: string;
  if (week.status === "draft") status = "Draft: not visible to players";
  else if (week.status === "final") status = winners.length ? `Won by ${winners.join(", ")}` : "Final";
  else if (week.myPickCount === 0) status = "Open: you haven't picked yet";
  else if (remaining > 0) status = `Open: you've picked ${week.myPickCount} of ${week.gameCount}`;
  else status = `Open: all ${week.gameCount} picked`;
  const needsPicks = week.status === "open" && remaining > 0;

  return (
    <li>
      {/* A draft has nothing to pick yet, so it leads straight to the admin's setup screen. */}
      <Link to={week.status === "draft" ? `/weeks/${week.id}/manage` : `/weeks/${week.id}`}>
        {weekLabel(week.number)}
      </Link>
      <span className="row">
        <span className={needsPicks ? "badge pow" : "muted"}>{status}</span>
        {isAdmin && week.status !== "draft" && (
          <Link to={`/weeks/${week.id}/manage`} aria-label={`Manage ${weekLabel(week.number)}`}>
            Manage
          </Link>
        )}
      </span>
    </li>
  );
}

function AdminPanel({
  league,
  userId,
  onChanged,
  defaultYear,
}: {
  league: LeagueDetail;
  userId: string;
  onChanged: () => void;
  defaultYear: number | null;
}) {
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [copied, setCopied] = useState(false);
  const param = { leagueId: league.id };
  const inviteUrl = `${window.location.origin}/join/${league.inviteCode}`;
  const year = defaultYear ?? seasonYear(new Date());
  const lastWeek = Math.max(0, ...league.weeks.filter((w) => w.year === year).map((w) => w.number));

  /** Runs a change to the league, then reloads it. */
  async function change(request: () => Promise<{ ok: boolean; json(): Promise<unknown> }>, done: string) {
    setError(undefined);
    setNotice(undefined);
    try {
      await unwrap(request());
      setNotice(done);
      onChanged();
    } catch (err) {
      setError(messageOf(err));
    }
  }

  async function createWeek(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(undefined);
    try {
      const { id, importError } = await unwrap<{ id: string; importError: string | null }>(
        api.leagues[":leagueId"].weeks.$post({
          param,
          json: {
            year: Number(form.get("year")),
            number: Number(form.get("number")),
            importGames: form.get("importGames") === "on",
          },
        }),
      );
      navigate(`/weeks/${id}/manage`, importError ? { kind: "alert", text: importError } : undefined);
    } catch (err) {
      setError(messageOf(err));
    }
  }

  function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    change(
      () =>
        api.leagues[":leagueId"].$patch({
          param,
          json: { name: String(form.get("name")), timeZone: String(form.get("timeZone")) },
        }),
      "League settings saved.",
    );
  }

  function rotate() {
    if (!window.confirm("Make a new invite link? The current link will stop working.")) return;
    setCopied(false);
    change(() => api.leagues[":leagueId"].invite.$post({ param }), "New invite link created.");
  }

  function remove(member: LeagueDetail["members"][number]) {
    const warning = `Remove ${member.displayName} from the league? They lose access. Weeks already played keep their results.`;
    if (!window.confirm(warning)) return;
    change(
      () =>
        api.leagues[":leagueId"].members[":userId"].$delete({ param: { ...param, userId: member.userId } }),
      `${member.displayName} removed.`,
    );
  }

  return (
    <section className="card stack" aria-label="League admin">
      <h3 style={{ margin: 0 }}>Admin</h3>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      <form onSubmit={createWeek} className="stack">
        <strong>Set up a week</strong>
        <div className="row" style={{ alignItems: "end" }}>
          <label>
            Season
            <input name="year" type="number" required min={2020} max={2100} defaultValue={year} />
          </label>
          <label>
            Week
            <input
              // Remount when a week is added, so the default moves on to the next one.
              key={lastWeek}
              name="number"
              type="number"
              required
              min={1}
              max={MAX_WEEK}
              defaultValue={Math.min(lastWeek + 1, MAX_WEEK)}
            />
          </label>
          <button type="submit" className="primary">
            Create week
          </button>
        </div>
        <label className="inline">
          <input name="importGames" type="checkbox" defaultChecked />
          Import games and spreads from ESPN
        </label>
      </form>

      <div className="stack">
        <label>
          Invite link: send this to anyone who should join
          <input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <div className="row">
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(inviteUrl);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <button type="button" className="link" onClick={rotate}>
            Make a new link
          </button>
        </div>
      </div>

      <div>
        <strong>Members ({league.members.length})</strong>
        <ul className="plain" style={{ marginTop: 8 }}>
          {league.members.map((member) => (
            <li key={member.userId}>
              <span>
                {member.displayName} {member.role === "admin" && <span className="badge">Admin</span>}
              </span>
              {member.userId !== userId && (
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove ${member.displayName}`}
                  onClick={() => remove(member)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={saveSettings} className="stack">
        <strong>League settings</strong>
        <div className="row" style={{ alignItems: "end" }}>
          <label>
            League name
            <input name="name" required maxLength={80} defaultValue={league.name} />
          </label>
          <label>
            Time zone for the 6am lock
            <select name="timeZone" defaultValue={league.timeZone}>
              {!(league.timeZone in TIME_ZONES) && <option value={league.timeZone}>{league.timeZone}</option>}
              {Object.entries(TIME_ZONES).map(([zone, name]) => (
                <option key={zone} value={zone}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Save settings</button>
        </div>
      </form>
    </section>
  );
}
