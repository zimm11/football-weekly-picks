// biome-ignore-all lint/correctness/noReactNativeRawText: Label, Pill, Action and Eyebrow render native Text.
import {
  LEAGUE_NAME_MAX,
  type LeagueDetail,
  type LeagueManagement,
  type Member,
  MUTE_DURATION_LABELS,
  type MuteDuration,
  managementChoices,
  updateLeagueSchema,
} from "@picks/shared";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { type ComponentRef, type ReactNode, useRef, useState } from "react";
import { Platform, Share, Text, TextInput, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { ReportSheet, type ReportTarget, setBlocked } from "../components/Moderation";
import { type Anchor, Menu, MenuItem } from "../components/Popover";
import { fonts } from "../components/ui";
import { request } from "../lib/api";
import { pageOrigin } from "../lib/config";
import { showConfirm } from "../lib/dialogs";
import { notifyDone, notifyError } from "../lib/notify";
import { confirmDiscard } from "../lib/unsaved";
import {
  Action,
  Card,
  colors,
  confirm,
  Eyebrow,
  Failure,
  IconButton,
  Input,
  Label,
  Pill,
  Select,
  s,
  useEditsGuard,
} from "./leagueUi";
import { ReportsQueue } from "./ReportsQueue";

/** How a weekly league can be run, as the League tab's settings name it. */
const MANAGEMENT_LABEL: Record<LeagueManagement, string> = {
  auto: "Automatic: weeks set up, open and close themselves",
  manual: "Hands-on: you run each week",
};

export const timeZones = [
  { value: "America/New_York", label: "Eastern" },
  { value: "America/Chicago", label: "Central" },
  { value: "America/Denver", label: "Mountain" },
  { value: "America/Phoenix", label: "Arizona" },
  { value: "America/Los_Angeles", label: "Pacific" },
  { value: "America/Anchorage", label: "Alaska" },
  { value: "Pacific/Honolulu", label: "Hawaii" },
  { value: "UTC", label: "UTC" },
];
export function LeagueTools({
  league,
  userId,
  isOperator = false,
  reload,
  adminTools,
}: {
  league: LeagueDetail;
  userId: string;
  /** Operators may use what isn't released yet (Automatic weekly). */
  isOperator?: boolean;
  reload: () => void;
  /** The league type's own admin tools (Set up a week, Start season, New board), shown to admins first. */
  adminTools?: ReactNode;
}) {
  const [name, setName] = useState(league.name),
    [timeZone, setTimeZone] = useState(league.timeZone),
    [management, setManagement] = useState(league.management);
  const [busy, setBusy] = useState<string>(),
    [error, setError] = useState<string>(),
    [copied, setCopied] = useState(false),
    [memberId, setMemberId] = useState<string>();
  // Read from the latest load, so a menu opened while a role change reloads shows the new role.
  const member = league.members.find((m) => m.userId === memberId);
  const setMember = (target: Member | undefined) => setMemberId(target?.userId);
  const [memberAnchor, setMemberAnchor] = useState<Anchor>();
  const [reporting, setReporting] = useState<{ target: ReportTarget; subject: string; member?: Member }>();
  const memberButtons = useRef(new Map<string, ComponentRef<typeof View>>());
  const admin = league.role === "admin",
    adminCount = league.members.filter((m) => m.role === "admin").length,
    // Only weekly pick'em has a choice, and Automatic only once it's open to this player (or already in use).
    managementOptions = [
      ...new Set([...managementChoices(league.type, isOperator), league.management]),
    ].filter((m) => league.type === "weekly" || m === league.management),
    dirty =
      admin && (name !== league.name || timeZone !== league.timeZone || management !== league.management);
  useEditsGuard(dirty && busy !== "settings", () => {
    setName(league.name);
    setTimeZone(league.timeZone);
    setManagement(league.management);
  });
  const base = `/leagues/${league.id}`,
    // The web build links to the site serving it (a local server too); the phone app to production.
    inviteUrl = `${pageOrigin() ?? "https://www.pow-pickem.com"}/join/${league.inviteCode}`;
  async function run(action: string, task: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(action);
    try {
      const result = await task();
      if (result === false) return;
      notifyDone(success);
      reload();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(undefined);
    }
  }
  async function role(target: Member) {
    setMember(undefined);
    const granting = target.role !== "admin";
    if (
      !(await showConfirm({
        title: granting
          ? `Make ${target.displayName} an admin?`
          : `Revoke admin access for ${target.displayName}?`,
        message: granting
          ? "They get the same admin access as you, including managing weeks, settings, invites, admin assignments, and removing members."
          : target.userId === userId
            ? "You stay in the league as a player and keep your picks and results. Another admin can restore your admin access."
            : "They stay in the league as a player and keep their picks and results.",
        confirmLabel: granting ? "Make admin" : "Revoke admin",
      }))
    )
      return;
    void run(
      "role",
      () =>
        request(`${base}/members/${target.userId}`, {
          method: "PATCH",
          body: { role: granting ? "admin" : "member" },
        }),
      granting ? `${target.displayName} is now an admin.` : `Admin access revoked for ${target.displayName}.`,
    );
  }
  async function remove(target: Member) {
    setMember(undefined);
    if (
      !(await showConfirm({
        title: `Remove ${target.displayName}?`,
        message: "They lose access to the league. Weeks already played keep their results.",
        confirmLabel: "Remove",
        destructive: true,
      }))
    )
      return;
    void run(
      "remove",
      () => request(`${base}/members/${target.userId}`, { method: "DELETE" }),
      `${target.displayName} removed.`,
    );
  }
  async function block(target: Member, blocked: boolean) {
    setMember(undefined);
    if (
      blocked &&
      !(await showConfirm({
        title: `Block ${target.displayName}?`,
        message:
          "Their threads, replies and reactions are hidden from you in every league, and you won't be notified about their threads. Picks and standings don't change, and they aren't told.",
        confirmLabel: `Block ${target.displayName}`,
        destructive: true,
      }))
    )
      return;
    void run(
      "block",
      () => setBlocked(target.userId, blocked),
      blocked ? `${target.displayName} is blocked.` : `${target.displayName} is unblocked.`,
    );
  }
  function mute(target: Member, duration: MuteDuration | null) {
    setMember(undefined);
    void run(
      "mute",
      () => request(`${base}/members/${target.userId}/mute`, { method: "PUT", body: { duration } }),
      duration
        ? `${target.displayName} is muted here for ${MUTE_DURATION_LABELS[duration]}.`
        : `${target.displayName} can post again.`,
    );
  }
  async function copy() {
    try {
      await Clipboard.setStringAsync(inviteUrl);
      setCopied(true);
    } catch {
      notifyError("Couldn't copy the link. Select it above and copy it yourself.");
    }
  }
  async function share() {
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && !navigator.share) {
        await copy();
        return;
      }
      await Share.share({ title: league.name, message: `Join ${league.name} on POW Pick'em: ${inviteUrl}` });
    } catch {
      notifyError("Couldn't share the invite. Use Copy link instead.");
    }
  }
  return (
    <>
      {/* The admin's tools for this league type (`LEAGUE_TYPE_SCREENS[type].AdminTools`): Set up a week, … */}
      {admin && adminTools}
      {admin && league.inviteCode && (
        <Card label="Invite">
          <View style={{ gap: 4 }}>
            <Eyebrow>Invite players</Eyebrow>
            <Label>Anyone with this link can join the league.</Label>
          </View>
          {/* Read-only, so it can be selected and copied by hand, as on the web. */}
          <TextInput
            value={inviteUrl}
            editable={false}
            selectTextOnFocus
            accessibilityLabel="Invite link"
            style={[
              s.input,
              { fontFamily: "monospace", fontSize: 14, borderRadius: 100, color: colors.mutedForeground },
            ]}
          />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <Action icon="share" onPress={() => void share()} style={{ paddingHorizontal: 16 }}>
              Share
            </Action>
            <Action
              secondary
              icon={copied ? "check" : "copy"}
              onPress={() => void copy()}
              style={{ paddingHorizontal: 16 }}
            >
              {copied ? "Copied" : "Copy link"}
            </Action>
          </View>
          <Action
            ghost
            muted
            compact
            icon="refresh"
            disabled={!!busy}
            onPress={() =>
              confirm(
                "Make a new invite link?",
                "The current link will stop working.",
                "Make new link",
                () => {
                  setCopied(false);
                  void run(
                    "invite",
                    () => request(`${base}/invite`, { method: "POST" }),
                    "New invite link created.",
                  );
                },
              )
            }
          >
            {busy === "invite" ? "Creating…" : "Make a new link"}
          </Action>
        </Card>
      )}
      {admin && (
        <Card label="Reports">
          <Eyebrow>Reports{league.openReports ? ` (${league.openReports})` : ""}</Eyebrow>
          <ReportsQueue path={`${base}/reports`} onChanged={reload} />
        </Card>
      )}
      <Card label="Members">
        <Eyebrow>Members ({league.members.length})</Eyebrow>
        <View>
          {league.members.map((target) => (
            <View
              key={target.userId}
              style={{
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
                minHeight: 64,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                paddingVertical: 8,
              }}
            >
              <Avatar name={target.displayName} size={32} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.text, { fontFamily: fonts.medium }]}>
                  {target.displayName}
                  {target.userId === userId && <Text style={{ color: colors.mutedForeground }}> (you)</Text>}
                </Text>
                {busy === "role" && member?.userId === target.userId && <Label>Saving…</Label>}
              </View>
              {target.role === "admin" && <Pill inline>Admin</Pill>}
              {admin && target.mutedUntil && <Pill inline>Muted</Pill>}
              {(admin || target.userId !== userId) && (
                <IconButton
                  ref={(node) => {
                    if (node) memberButtons.current.set(target.userId, node);
                    else memberButtons.current.delete(target.userId);
                  }}
                  name="more"
                  label={`Options for ${target.displayName}`}
                  disabled={!!busy}
                  onPress={() =>
                    memberButtons.current.get(target.userId)?.measureInWindow((x, y, width, height) => {
                      setMemberAnchor({ x, y, width, height });
                      setMember(target);
                    })
                  }
                />
              )}
            </View>
          ))}
        </View>
        {!admin && (
          <Action
            ghost
            muted
            compact
            icon="flag"
            disabled={!!busy}
            onPress={() =>
              setReporting({
                target: { kind: "league_name", leagueId: league.id },
                subject: `the league name “${league.name}”`,
              })
            }
          >
            Report this league's name
          </Action>
        )}
        {!admin && (
          <Label>
            Game times are shown in{" "}
            {timeZones.find((z) => z.value === league.timeZone)?.label ?? league.timeZone} time.
          </Label>
        )}
      </Card>
      {admin && (
        <Card label="League settings">
          <Eyebrow>League settings</Eyebrow>
          <Input
            label="League name"
            value={name}
            onChangeText={setName}
            maxLength={LEAGUE_NAME_MAX}
            editable={!busy}
          />
          <Select
            label="Time zone for game times"
            value={timeZone}
            onChange={setTimeZone}
            disabled={!!busy}
            choices={
              timeZones.some((zone) => zone.value === timeZone)
                ? timeZones
                : [{ value: timeZone, label: timeZone }, ...timeZones]
            }
          />
          {managementOptions.length > 1 && (
            <Select
              label="How it's run"
              value={management}
              onChange={setManagement}
              disabled={!!busy}
              choices={managementOptions.map((value) => ({ value, label: MANAGEMENT_LABEL[value] }))}
            />
          )}
          <Failure message={error} />
          <Action
            secondary
            disabled={!!busy || !dirty}
            onPress={() => {
              const parsed = updateLeagueSchema.safeParse({
                name,
                timeZone,
                ...(management !== league.management && { management }),
              });
              if (!parsed.success) return setError(parsed.error.issues[0]?.message);
              setError(undefined);
              void run(
                "settings",
                () => request(base, { method: "PATCH", body: parsed.data }),
                "League settings saved.",
              );
            }}
          >
            {busy === "settings" ? "Saving…" : "Save settings"}
          </Action>
        </Card>
      )}
      <Card label="Leave league">
        <Eyebrow>Leave league</Eyebrow>
        <Label>
          {admin && adminCount === 1
            ? "You're the only admin. Make another member an admin before you leave."
            : "You'll lose access to this league. Your results from weeks already played stay in the standings."}
        </Label>
        <Action
          compact
          secondary
          danger
          disabled={!!busy || (admin && adminCount === 1)}
          onPress={() =>
            confirm(
              `Leave ${league.name}?`,
              "You lose access to the league and its picks. Weeks already played keep your results, and you can rejoin with an invite link.",
              "Leave league",
              () =>
                void run(
                  "leave",
                  async () => {
                    if (!(await confirmDiscard())) return false;
                    await request(`${base}/members/${userId}`, { method: "DELETE" });
                    router.replace("/" as never);
                  },
                  `You left ${league.name}.`,
                ),
              true,
            )
          }
        >
          {busy === "leave" ? "Leaving…" : "Leave league"}
        </Action>
      </Card>
      {/* The row's ⋯ menu, a dropdown at the button as on the web. */}
      <Menu
        anchor={member ? memberAnchor : undefined}
        onClose={() => setMember(undefined)}
        label={member ? `Options for ${member.displayName}` : "Options"}
        align="end"
      >
        {member && (
          <>
            {member.userId !== userId && (
              <>
                <MenuItem
                  icon="flag"
                  label="Report name"
                  accessibilityLabel={`Report ${member.displayName}'s name`}
                  onPress={() => {
                    setMember(undefined);
                    setReporting({
                      target: { kind: "display_name", leagueId: league.id, userId: member.userId },
                      subject: `${member.displayName}'s name`,
                      member,
                    });
                  }}
                />
                <MenuItem
                  icon="block"
                  label={member.blocked ? `Unblock ${member.displayName}` : `Block ${member.displayName}`}
                  onPress={() => void block(member, !member.blocked)}
                />
              </>
            )}
            {admin && member.userId !== userId && member.role !== "admin" && (
              <>
                {(["24h", "7d"] as const).map((duration) => (
                  <MenuItem
                    key={duration}
                    icon="mute"
                    label={`Mute for ${MUTE_DURATION_LABELS[duration]}`}
                    accessibilityLabel={`Mute ${member.displayName} for ${MUTE_DURATION_LABELS[duration]}`}
                    onPress={() => mute(member, duration)}
                  />
                ))}
                {member.mutedUntil && (
                  <MenuItem
                    icon="mute"
                    label="Lift mute"
                    accessibilityLabel={`Lift ${member.displayName}'s mute`}
                    onPress={() => mute(member, null)}
                  />
                )}
              </>
            )}
            {admin && (
              <MenuItem
                icon="shield"
                disabled={member.role === "admin" && adminCount === 1}
                label={member.role === "admin" ? "Revoke admin" : "Make admin"}
                accessibilityLabel={
                  member.role === "admin"
                    ? `Revoke admin access for ${member.displayName}`
                    : `Make ${member.displayName} an admin`
                }
                onPress={() => void role(member)}
              />
            )}
            {admin && member.userId !== userId && (
              <MenuItem
                icon="user-minus"
                destructive
                disabled={member.role === "admin" && adminCount === 1}
                label="Remove from league"
                accessibilityLabel={`Remove ${member.displayName}`}
                onPress={() => void remove(member)}
              />
            )}
          </>
        )}
      </Menu>
      <ReportSheet
        target={reporting?.target ?? null}
        subject={reporting?.subject ?? ""}
        onClose={() => setReporting(undefined)}
        onBlock={
          reporting?.member && !reporting.member.blocked
            ? {
                name: reporting.member.displayName,
                run: async () => {
                  const target = reporting.member;
                  if (target) await setBlocked(target.userId, true);
                  reload();
                },
              }
            : undefined
        }
      />
    </>
  );
}
