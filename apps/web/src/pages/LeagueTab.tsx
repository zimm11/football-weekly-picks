import {
  ArrowsClockwiseIcon,
  CheckIcon,
  CopyIcon,
  DotsThreeIcon,
  ShareNetworkIcon,
  ShieldIcon,
  UserMinusIcon,
} from "@phosphor-icons/react";
import type { LeagueDetail } from "@picks/shared";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Eyebrow } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import { api, unwrap } from "../api";
import { Avatar } from "../components/Avatar";
import { useConfirm } from "../components/ConfirmDialog";
import { SeasonWeeks } from "../components/SeasonWeeks";
import { TIME_ZONES, zoneName } from "../format";
import { useAction } from "../lib/useAction";
import { notifyError } from "../notify";
import { navigate } from "../router";

/** Who is in the league, and for the admin: weeks, the invite link, and settings. */
export function LeagueTabPanel({
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
  // The last admin has to hand the league to someone else before leaving it.
  const soleAdmin = isAdmin && adminCount === 1;
  const { busy, run } = useAction<"create" | "settings" | "invite" | "remove" | "leave" | "role">();
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const param = { leagueId: league.id };
  const inviteUrl = `${window.location.origin}/join/${league.inviteCode}`;
  // The phone's share sheet, where there is one; everywhere else the link is copied.
  const canShare = typeof navigator.share === "function";

  /** Runs a change to the league, then reloads it. */
  function change(
    action: "settings" | "invite" | "remove" | "role",
    request: () => Promise<{ ok: boolean; json(): Promise<unknown> }>,
    done: string,
  ) {
    return run(
      action,
      async () => {
        await unwrap(request());
        onChanged();
      },
      done,
    );
  }

  async function createWeek(number: number, importGames: boolean) {
    // Importing the schedule can take a few seconds, so the button says what is happening.
    await run("create", async () => {
      const { id, importError } = await unwrap<{ id: string; importError: string | null }>(
        api.leagues[":leagueId"].weeks.$post({ param, json: { year, number, importGames } }),
      );
      navigate(`/weeks/${id}/manage`, importError ? { kind: "alert", text: importError } : undefined);
    });
  }

  function saveSettings(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    change(
      "settings",
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
    change("invite", () => api.leagues[":leagueId"].invite.$post({ param }), "New invite link created.");
  }

  async function remove(member: LeagueDetail["members"][number]) {
    const ok = await confirm({
      title: `Remove ${member.displayName}?`,
      detail: "They lose access to the league. Weeks already played keep their results.",
      action: "Remove",
    });
    if (!ok) return;
    change(
      "remove",
      () =>
        api.leagues[":leagueId"].members[":userId"].$delete({ param: { ...param, userId: member.userId } }),
      `${member.displayName} removed.`,
    );
  }

  async function leave() {
    const ok = await confirm({
      title: `Leave ${league.name}?`,
      detail:
        "You lose access to the league and its picks. Weeks already played keep your results, and you can rejoin with an invite link.",
      action: "Leave league",
    });
    if (!ok) return;
    await run(
      "leave",
      async () => {
        await unwrap(api.leagues[":leagueId"].members[":userId"].$delete({ param: { ...param, userId } }));
        navigate("/");
      },
      `You left ${league.name}.`,
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
      "role",
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
      {isAdmin && (
        <SeasonWeeks
          year={year}
          weeks={league.weeks}
          busy={!!busy}
          creating={busy === "create"}
          onCreate={createWeek}
        />
      )}

      {isAdmin && (
        <Card aria-label="Invite">
          <div className="grid gap-1">
            <Eyebrow>Invite players</Eyebrow>
            <p className="m-0 text-sm text-muted-foreground">Anyone with this link can join the league.</p>
          </div>
          <Input
            readOnly
            aria-label="Invite link"
            value={inviteUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="truncate rounded-full border-transparent bg-raised font-mono text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            {canShare && (
              <Button
                type="button"
                onClick={() =>
                  navigator
                    .share({ title: league.name, text: `Join ${league.name} on POW Pick'em`, url: inviteUrl })
                    .catch(() => {})
                }
              >
                <ShareNetworkIcon aria-hidden />
                Share
              </Button>
            )}
            <Button
              type="button"
              variant={canShare ? "secondary" : "default"}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteUrl);
                  setCopied(true);
                } catch {
                  notifyError("Couldn't copy the link. Select it above and copy it yourself.");
                }
              }}
            >
              {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button type="button" variant="ghost" className="ml-auto text-muted-foreground" onClick={rotate}>
              <ArrowsClockwiseIcon aria-hidden />
              Make a new link
            </Button>
          </div>
        </Card>
      )}

      <Card aria-label="Members">
        <Eyebrow>Members ({league.members.length})</Eyebrow>
        <ul className="m-0 grid list-none divide-y divide-border p-0">
          {league.members.map((member) => {
            const lastAdmin = member.role === "admin" && adminCount === 1;
            return (
              <li key={member.userId} className="flex min-h-14 items-center gap-3 py-2">
                <Avatar name={member.displayName} />
                <span className="grid min-w-0 flex-1">
                  <span className="break-words font-medium">
                    {member.displayName}
                    {member.userId === userId && <span className="text-muted-foreground"> (you)</span>}
                  </span>
                  {changingRole === member.userId && (
                    <span className="text-xs text-muted-foreground">Saving…</span>
                  )}
                </span>
                {member.role === "admin" && <Badge variant="outline">Admin</Badge>}
                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Options for ${member.displayName}`}
                        className="rounded-full text-muted-foreground hover:text-foreground"
                        disabled={!!busy}
                      >
                        <DotsThreeIcon aria-hidden weight="bold" className="size-6" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={lastAdmin}
                        aria-label={
                          member.role === "admin"
                            ? `Revoke admin access for ${member.displayName}`
                            : `Make ${member.displayName} an admin`
                        }
                        onSelect={() => changeRole(member)}
                      >
                        <ShieldIcon aria-hidden />
                        {member.role === "admin" ? "Revoke admin" : "Make admin"}
                      </DropdownMenuItem>
                      {member.userId !== userId && (
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={lastAdmin}
                          aria-label={`Remove ${member.displayName}`}
                          onSelect={() => remove(member)}
                        >
                          <UserMinusIcon aria-hidden />
                          Remove from league
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
        </ul>
        {!isAdmin && (
          <p className="m-0 text-sm text-muted-foreground">
            Game times are shown in {zoneName(league.timeZone)} time.
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
            <Field label="Time zone for game times">
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
            <Button type="submit" variant="secondary" disabled={!!busy}>
              {busy === "settings" ? "Saving…" : "Save settings"}
            </Button>
          </form>
        </Card>
      )}

      <Card aria-label="Leave league">
        <Eyebrow>Leave league</Eyebrow>
        <p className="m-0 text-sm text-muted-foreground">
          {soleAdmin
            ? "You're the only admin. Make another member an admin before you leave."
            : "You'll lose access to this league. Your results from weeks already played stay in the standings."}
        </p>
        <Button
          type="button"
          variant="destructive"
          className="justify-self-start"
          disabled={!!busy || soleAdmin}
          onClick={leave}
        >
          {busy === "leave" ? "Leaving…" : "Leave league"}
        </Button>
      </Card>
    </div>
  );
}
