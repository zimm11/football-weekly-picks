import { CaretRightIcon } from "@phosphor-icons/react";
import { type LeagueDetail, MAX_WEEK, type Standings, type WeekSummary, weekLabel } from "@picks/shared";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, Notice } from "@/components/ui/card";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { api, messageOf, unwrap } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { LeagueLayout, type LeagueTab } from "../components/LeagueNav";
import { PickSplitsTable, WeekByWeekTable, YourSeason } from "../components/SeasonDashboard";
import { StandingsTable } from "../components/StandingsTable";
import { ordinal, seasonYear } from "../format";
import { notifyDone, notifyError } from "../notify";
import { Link, navigate } from "../router";
import { rowLink } from "./LeaguesPage";
import { useLoad } from "./useLoad";
import { STATUS_LABEL, WeekLoader } from "./WeekPage";

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

/** The league hub. Each tab is its own address, so the back button and shared links land where expected. */
export function LeaguePage({ leagueId, userId, tab }: { leagueId: string; userId: string; tab: LeagueTab }) {
  const league = useLoad(
    () => unwrap<LeagueDetail>(api.leagues[":leagueId"].$get({ param: { leagueId } })),
    leagueId,
  );

  if (league.error) return <Notice kind="alert">{league.error}</Notice>;
  if (!league.data) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <LeagueLayout leagueId={leagueId} leagueName={league.data.name} active={tab}>
      {tab === "picks" && <PicksTab league={league.data} userId={userId} />}
      {(tab === "results" || tab === "standings") && (
        <SeasonTab league={league.data} userId={userId} show={tab} />
      )}
      {tab === "league" && <LeagueTabPanel league={league.data} userId={userId} onChanged={league.reload} />}
    </LeagueLayout>
  );
}

/** The week that needs the player's attention: the earliest open week with picks missing, else the latest open one. */
export function currentWeek(weeks: WeekSummary[]): WeekSummary | undefined {
  const open = weeks
    .filter((w) => w.status === "open")
    .sort((a, b) => a.year - b.year || a.number - b.number);
  return open.find((w) => w.myPickCount < w.gameCount) ?? open.at(-1);
}

function PicksTab({ league, userId }: { league: LeagueDetail; userId: string }) {
  const isAdmin = league.role === "admin";
  const open = league.weeks.filter((w) => w.status === "open");
  const drafts = league.weeks.filter((w) => w.status === "draft");
  const current = currentWeek(league.weeks);
  const lastFinal = league.weeks.find((w) => w.status === "final");

  return (
    <div className="grid gap-4">
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
              {weekLabel(week.number)}
            </Link>
          ))}
        </nav>
      )}

      {current ? (
        <WeekLoader weekId={current.id} userId={userId} />
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

/** Results and standings are both per season, and share the season picker. */
function SeasonTab({
  league,
  userId,
  show,
}: {
  league: LeagueDetail;
  userId: string;
  show: "results" | "standings";
}) {
  const [year, setYear] = useState<number>();
  const standings = useLoad(
    () =>
      unwrap<Standings>(
        api.leagues[":leagueId"].standings.$get({
          param: { leagueId: league.id },
          query: { year: year?.toString() },
        }),
      ),
    `${league.id}:${year}`,
  );

  if (standings.error) return <Notice kind="alert">{standings.error}</Notice>;
  if (!standings.data) return <p className="text-muted-foreground">Loading…</p>;
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
          {shownYear !== null && <span className="text-2xl text-muted-foreground">· {shownYear}</span>}
        </h3>
        {standings.data.years.length > 1 && (
          <Field label="Season" className="w-28">
            <NativeSelect value={shownYear ?? ""} onChange={(e) => setYear(Number(e.target.value))}>
              {standings.data.years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
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
            <p className="m-0 text-sm text-muted-foreground">
              Standings count closed weeks only. Ties are broken by POWs won, then wins, then Monday night and
              Sunday night wins.
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

/** Who is in the league, and for the admin: weeks, the invite link, and settings. */
function LeagueTabPanel({
  league,
  userId,
  onChanged,
}: {
  league: LeagueDetail;
  userId: string;
  onChanged: () => void;
}) {
  const isAdmin = league.role === "admin";
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const param = { leagueId: league.id };
  const inviteUrl = `${window.location.origin}/join/${league.inviteCode}`;
  const year = league.weeks[0]?.year ?? seasonYear(new Date());
  const lastWeek = Math.max(0, ...league.weeks.filter((w) => w.year === year).map((w) => w.number));

  /** Runs a change to the league, then reloads it. */
  async function change(request: () => Promise<{ ok: boolean; json(): Promise<unknown> }>, done: string) {
    setBusy(true);
    try {
      await unwrap(request());
      notifyDone(done);
      onChanged();
    } catch (err) {
      notifyError(messageOf(err));
    }
    setBusy(false);
  }

  async function createWeek(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    // Importing the schedule can take a few seconds, so the button says what is happening.
    setBusy(true);
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
      notifyError(messageOf(err));
      setBusy(false);
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

  async function rotate() {
    const ok = await confirm({
      title: "Make a new invite link?",
      detail: "The current link will stop working.",
      action: "Make new link",
    });
    if (!ok) return;
    setCopied(false);
    change(() => api.leagues[":leagueId"].invite.$post({ param }), "New invite link created.");
  }

  async function remove(member: LeagueDetail["members"][number]) {
    const ok = await confirm({
      title: `Remove ${member.displayName}?`,
      detail: "They lose access to the league. Weeks already played keep their results.",
      action: "Remove",
    });
    if (!ok) return;
    change(
      () =>
        api.leagues[":leagueId"].members[":userId"].$delete({ param: { ...param, userId: member.userId } }),
      `${member.displayName} removed.`,
    );
  }

  return (
    <div className="grid gap-4">
      {confirmDialog}
      {isAdmin && (
        <Card aria-label="Weeks">
          <Eyebrow>Weeks</Eyebrow>
          <form onSubmit={createWeek} className="grid gap-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[8rem_8rem_auto] sm:items-end sm:justify-start">
              <Field label="Season">
                <Input name="year" type="number" required min={2020} max={2100} defaultValue={year} />
              </Field>
              <Field label="Week">
                <Input
                  // Remount when a week is added, so the default moves on to the next one.
                  key={lastWeek}
                  name="number"
                  type="number"
                  required
                  min={1}
                  max={MAX_WEEK}
                  defaultValue={Math.min(lastWeek + 1, MAX_WEEK)}
                />
              </Field>
              <Button type="submit" disabled={busy} className="col-span-2 sm:col-span-1">
                {busy ? "Creating…" : "Create week"}
              </Button>
            </div>
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input name="importGames" type="checkbox" defaultChecked className="size-5 accent-primary" />
              Import games and spreads from ESPN
            </label>
          </form>
          {league.weeks.length > 0 && (
            <ul className="m-0 grid list-none p-0">
              {league.weeks.map((week) => (
                <li key={week.id} className="border-t">
                  <Link
                    to={`/weeks/${week.id}/manage`}
                    aria-label={`Manage ${weekLabel(week.number)}`}
                    className="flex min-h-12 items-center gap-3 text-foreground no-underline hover:text-primary"
                  >
                    <span className="font-display text-xl font-bold tracking-wide uppercase">
                      {weekLabel(week.number)}
                    </span>
                    <span className="text-sm text-muted-foreground">{week.year}</span>
                    <Badge variant={week.status === "open" ? "default" : "outline"} className="ml-auto">
                      {STATUS_LABEL[week.status]}
                    </Badge>
                    <CaretRightIcon aria-hidden className="size-5 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {isAdmin && (
        <Card aria-label="Invite">
          <Eyebrow>Invite players</Eyebrow>
          <Field label="Invite link: send this to anyone who should join">
            <Input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteUrl);
                  setCopied(true);
                } catch {
                  notifyError("Couldn't copy the link. Select it above and copy it yourself.");
                }
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button type="button" variant="link" onClick={rotate}>
              Make a new link
            </Button>
          </div>
        </Card>
      )}

      <Card aria-label="Members">
        <Eyebrow>Members ({league.members.length})</Eyebrow>
        <ul className="m-0 grid list-none p-0">
          {league.members.map((member) => (
            <li key={member.userId} className="flex min-h-12 items-center gap-2 border-t first:border-t-0">
              <span className="font-medium">{member.displayName}</span>
              {member.role === "admin" && <Badge variant="outline">Admin</Badge>}
              {isAdmin && member.userId !== userId && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="ml-auto"
                  aria-label={`Remove ${member.displayName}`}
                  onClick={() => remove(member)}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!isAdmin && (
          <p className="m-0 text-sm text-muted-foreground">
            The 6am game-day lock uses {zoneName(league.timeZone)} time.
          </p>
        )}
      </Card>

      {isAdmin && (
        <Card aria-label="League settings">
          <Eyebrow>League settings</Eyebrow>
          <form onSubmit={saveSettings} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
            <Field label="League name">
              <Input name="name" required maxLength={80} defaultValue={league.name} />
            </Field>
            <Field label="Time zone for the 6am lock">
              <NativeSelect name="timeZone" defaultValue={league.timeZone}>
                {!(league.timeZone in TIME_ZONES) && (
                  <option value={league.timeZone}>{league.timeZone}</option>
                )}
                {Object.entries(TIME_ZONES).map(([zone, name]) => (
                  <option key={zone} value={zone}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Button type="submit" variant="secondary" disabled={busy}>
              Save settings
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
