import { CaretRightIcon } from "@phosphor-icons/react";
import {
  currentWeek,
  type LeagueDetail,
  preferredSeasonYear,
  type Standings,
  seasonYear,
  WEEK_PHASE_LABEL,
  weekLabel,
} from "@picks/shared";
import { type FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, Notice } from "@/components/ui/card";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { api, messageOf, unwrap } from "../api";
import { useConfirm } from "../components/ConfirmDialog";
import { LeagueLayout, type LeagueTab } from "../components/LeagueNav";
import { PickSplitsTable, WeekByWeekTable, YourSeason } from "../components/SeasonDashboard";
import { SeasonWeeks } from "../components/SeasonWeeks";
import { StandingsTable } from "../components/StandingsTable";
import { ordinal } from "../format";
import { readSeason, rememberSeason } from "../lib/seasonSelection";
import { notifyDone, notifyError } from "../notify";
import { Link, navigate, requestLeave } from "../router";
import { rowLink } from "./LeaguesPage";
import { MessagesPage } from "./MessagesPage";
import { useLoad } from "./useLoad";
import { WeekLoader } from "./WeekPage";

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
export function LeaguePage({
  leagueId,
  userId,
  tab,
  threadId,
}: {
  leagueId: string;
  userId: string;
  tab: LeagueTab;
  threadId?: string;
}) {
  const league = useLoad(
    () => unwrap<LeagueDetail>(api.leagues[":leagueId"].$get({ param: { leagueId } })),
    leagueId,
  );
  const [selectedYear, setSelectedYear] = useState(() => readSeason(leagueId));
  const [startingSeason, setStartingSeason] = useState(false);

  useEffect(() => {
    if (league.data && selectedYear === undefined) {
      setSelectedYear(preferredSeasonYear(league.data.weeks, new Date()));
    }
  }, [league.data, selectedYear]);

  // Availability counts and display phases are computed by the API using its clock.
  useEffect(() => {
    const timer = setInterval(league.reload, 30_000);
    return () => clearInterval(timer);
  }, [league.reload]);

  if (league.error && !league.data) return <Notice kind="alert">{league.error}</Notice>;
  if (!league.data) return <p className="text-muted-foreground">Loading…</p>;
  const detail = league.data;
  const currentYear = seasonYear(new Date());
  const year = selectedYear ?? preferredSeasonYear(detail.weeks, new Date());
  const years = [...new Set([currentYear, year, ...detail.weeks.map((week) => week.year)])].sort(
    (a, b) => b - a,
  );
  const nextYear = Math.min(2100, Math.max(currentYear, ...detail.weeks.map((week) => week.year + 1)));
  const seasonLeague = { ...detail, weeks: detail.weeks.filter((week) => week.year === year) };

  function chooseYear(value: number) {
    requestLeave(() => {
      setSelectedYear(value);
      rememberSeason(leagueId, value);
      setStartingSeason(false);
    });
  }

  return (
    <LeagueLayout
      leagueId={leagueId}
      leagueName={detail.name}
      active={tab}
      seasonSelector={
        tab !== "messages" && (
          <div className="grid gap-3">
            <Field label="Season" className="w-full sm:w-72">
              <NativeSelect
                value={startingSeason ? "new" : year}
                onChange={(event) => {
                  if (event.target.value === "new") setStartingSeason(true);
                  else chooseYear(Number(event.target.value));
                }}
              >
                {years.map((value) => (
                  <option key={value} value={value}>
                    {value} NFL season
                    {detail.weeks.some((week) => week.year === value) ? "" : " · Not started"}
                  </option>
                ))}
                {detail.role === "admin" && <option value="new">Start a new season…</option>}
              </NativeSelect>
            </Field>
            {startingSeason && detail.role === "admin" && (
              <Card aria-label="Start a new season">
                <h3 className="text-2xl">Start a new season</h3>
                <p className="m-0 text-sm text-muted-foreground">
                  Use the year the NFL season starts. Your league and members carry over. The season is
                  created when you prepare its first week.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    chooseYear(Number(new FormData(event.currentTarget).get("year")));
                  }}
                  className="flex flex-wrap items-end gap-3"
                >
                  <Field label="New season year" className="w-40">
                    <Input name="year" type="number" required min={2020} max={2100} defaultValue={nextYear} />
                  </Field>
                  <Button type="submit">Use season</Button>
                  <Button type="button" variant="outline" onClick={() => setStartingSeason(false)}>
                    Cancel
                  </Button>
                </form>
              </Card>
            )}
          </div>
        )
      }
    >
      {league.error && <Notice kind="alert">{league.error}</Notice>}
      {tab === "messages" && (
        <MessagesPage key={threadId ?? "board"} leagueId={leagueId} threadId={threadId} />
      )}
      {tab === "picks" && <PicksTab key={year} league={seasonLeague} userId={userId} />}
      {(tab === "results" || tab === "standings") && (
        <SeasonTab key={`${year}:${tab}`} league={seasonLeague} year={year} userId={userId} show={tab} />
      )}
      {tab === "league" && (
        <LeagueTabPanel
          key={year}
          league={seasonLeague}
          year={year}
          userId={userId}
          onChanged={league.reload}
        />
      )}
    </LeagueLayout>
  );
}

function PicksTab({ league, userId }: { league: LeagueDetail; userId: string }) {
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

/** Results and standings are both per season, and share the season picker. */
function SeasonTab({
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
  year,
  userId,
  onChanged,
}: {
  league: LeagueDetail;
  year: number;
  userId: string;
  onChanged: () => void;
}) {
  const isAdmin = league.role === "admin";
  const adminCount = league.members.filter((member) => member.role === "admin").length;
  const [busy, setBusy] = useState(false);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const param = { leagueId: league.id };
  const inviteUrl = `${window.location.origin}/join/${league.inviteCode}`;

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

  async function createWeek(number: number, importGames: boolean) {
    // Importing the schedule can take a few seconds, so the button says what is happening.
    setBusy(true);
    try {
      const { id, importError } = await unwrap<{ id: string; importError: string | null }>(
        api.leagues[":leagueId"].weeks.$post({
          param,
          json: {
            year,
            number,
            importGames,
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

  async function changeRole(member: LeagueDetail["members"][number]) {
    const granting = member.role !== "admin";
    const ok = await confirm({
      title: granting
        ? `Make ${member.displayName} an admin?`
        : `Revoke admin access for ${member.displayName}?`,
      detail: granting
        ? "They get the same admin access as you, including managing weeks, settings, invites, and admin assignments, and removing members."
        : member.userId === userId
          ? "You stay in the league as a player and keep your picks and results. Another admin can restore your admin access."
          : "They stay in the league as a player and keep their picks and results.",
      action: granting ? "Make admin" : "Revoke admin",
    });
    if (!ok) return;
    setChangingRole(member.userId);
    await change(
      () =>
        api.leagues[":leagueId"].members[":userId"].$patch({
          param: { ...param, userId: member.userId },
          json: { role: granting ? "admin" : "member" },
        }),
      granting ? `${member.displayName} is now an admin.` : `Admin access revoked for ${member.displayName}.`,
    );
    setChangingRole(null);
  }

  return (
    <div className="grid gap-4">
      {confirmDialog}
      {isAdmin && <SeasonWeeks year={year} weeks={league.weeks} busy={busy} onCreate={createWeek} />}

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
        {isAdmin && (
          <p className="m-0 text-sm text-muted-foreground">
            All admins can grant or revoke admin access and remove members. At least one admin must remain.
          </p>
        )}
        <ul className="m-0 grid list-none p-0">
          {league.members.map((member) => (
            <li
              key={member.userId}
              className="flex min-h-12 flex-wrap items-center gap-2 border-t py-2 first:border-t-0"
            >
              <span className="min-w-0 break-words font-medium">{member.displayName}</span>
              {member.role === "admin" && <Badge variant="outline">Admin</Badge>}
              <div className="ml-auto flex flex-wrap gap-2">
                {isAdmin && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || (member.role === "admin" && adminCount === 1)}
                    aria-label={
                      member.role === "admin"
                        ? `Revoke admin access for ${member.displayName}`
                        : `Make ${member.displayName} an admin`
                    }
                    onClick={() => changeRole(member)}
                  >
                    {changingRole === member.userId
                      ? "Saving…"
                      : member.role === "admin"
                        ? "Revoke admin"
                        : "Make admin"}
                  </Button>
                )}
                {isAdmin && member.userId !== userId && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy || (member.role === "admin" && adminCount === 1)}
                    aria-label={`Remove ${member.displayName}`}
                    onClick={() => remove(member)}
                  >
                    Remove
                  </Button>
                )}
              </div>
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
