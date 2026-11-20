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
import { type ComponentRef, type ReactNode, useEffect, useRef, useState } from "react";
import { Platform, Share, Text, View } from "react-native";
import { AutoGrowInput } from "../components/AutoGrowInput";
import { Avatar } from "../components/Avatar";
import { ReportSheet, type ReportTarget, setBlocked } from "../components/Moderation";
import { type Anchor, Menu, MenuItem } from "../components/Popover";
import { PreferenceToggle } from "../components/PreferenceToggle";
import { fonts } from "../components/ui";
import { request } from "../lib/api";
import { pageOrigin } from "../lib/config";
import { showConfirm } from "../lib/dialogs";
import { notifyDone, notifyError } from "../lib/notify";
import { confirmDiscard } from "../lib/unsaved";
import {
  Action,
  Card,
  CardTitle,
  colors,
  confirm,
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

/** How a weekly league can be run, as the League tab's settings name it: short, so it fits a phone's select. */
const MANAGEMENT_LABEL: Record<LeagueManagement, string> = {
  auto: "Automatic",
  manual: "Hands-on",
};
/** What the chosen way of running it means, under the select. */
const MANAGEMENT_DETAIL: Record<LeagueManagement, string> = {
  auto: "Weeks set up, open and close themselves. Everyone sees each pick once its game kicks off.",
  manual: "You set up, open and finalize each week.",
};
/** Whether this browser (or the phone) has a share sheet. A computer's browser usually has none. */
const canShare = () =>
  Platform.OS !== "web" || (typeof navigator !== "undefined" && typeof navigator.share === "function");

/** The invite link in its box: the app's own type, quieter than typed text, wrapping rather than cut off. */
const inviteText = {
  fontFamily: fonts.body,
  fontSize: 14,
  lineHeight: 20,
  color: colors.mutedForeground,
} as const;

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
  reload,
  adminTools,
}: {
  league: LeagueDetail;
  userId: string;
  reload: () => void;
  /** The league type's own admin tools (Set up a week, Start season, New board), shown to admins first. */
  adminTools?: ReactNode;
}) {
  const [name, setName] = useState(league.name),
    [timeZone, setTimeZone] = useState(league.timeZone),
    [management, setManagement] = useState(league.management),
    // A Hands-on league's choice, held only once it is touched: until then the box shows what the league says,
    // so a remembered copy of the league from before the setting existed can't leave it reading "off".
    [shareEdit, setShareEdit] = useState<boolean>();
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
    // Only weekly pick'em has a choice.
    managementOptions = managementChoices(league.type),
    // Only a Hands-on league chooses who sees the results so far: while Automatic is selected the stored
    // choice is left as it is (the server ignores it), and an older server has no such setting.
    sharingChoice = league.shareResultsSoFar !== undefined && management === "manual",
    shareSoFar = shareEdit ?? league.shareResultsSoFar ?? false,
    sharingChanged = sharingChoice && shareSoFar !== league.shareResultsSoFar,
    dirty =
      admin &&
      (name !== league.name ||
        timeZone !== league.timeZone ||
        management !== league.management ||
        sharingChanged);
  useEditsGuard(dirty && busy !== "settings", () => {
    setName(league.name);
    setTimeZone(league.timeZone);
    setManagement(league.management);
    setShareEdit(undefined);
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
          ? `Make ${target.displayName} a commissioner?`
          : `Revoke commissioner access for ${target.displayName}?`,
        message: granting
          ? "They get the same commissioner access as you, including managing weeks, settings, invites, commissioner assignments, and removing members."
          : target.userId === userId
            ? "You stay in the league as a player and keep your picks and results. Another commissioner can restore your commissioner access."
            : "They stay in the league as a player and keep their picks and results.",
        confirmLabel: granting ? "Make commissioner" : "Revoke commissioner",
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
      granting
        ? `${target.displayName} is now a commissioner.`
        : `Commissioner access revoked for ${target.displayName}.`,
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
  // "Copied" goes back to "Copy link" after a moment, so copying again says so again.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
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
      await Share.share({ title: league.name, message: `Join ${league.name} on POW Pick'em: ${inviteUrl}` });
    } catch {
      notifyError("Couldn't share the invite. Use Copy link instead.");
    }
  }
  const reportsWaiting = admin && !!league.openReports;
  const reports = admin && (
    <Card label="Reports">
      <CardTitle>Reports{league.openReports ? ` (${league.openReports})` : ""}</CardTitle>
      <ReportsQueue path={`${base}/reports`} onChanged={reload} />
    </Card>
  );
  function saveSettings() {
    if (busy || !dirty) return;
    const parsed = updateLeagueSchema.safeParse({
      name,
      timeZone,
      ...(management !== league.management && { management }),
      ...(sharingChanged && { shareResultsSoFar: shareSoFar }),
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setError(undefined);
    void run(
      "settings",
      () => request(base, { method: "PATCH", body: parsed.data }),
      "League settings saved.",
    );
  }
  // While the commissioner is still on their own, inviting players is the first job, ahead of the type's tools.
  const inviteFirst = league.members.length <= 1;
  const invite = admin && league.inviteCode && (
    <Card label="Invite">
      <View style={{ gap: 4 }}>
        <CardTitle>Invite players</CardTitle>
        <Label>Anyone with this link can join the league.</Label>
      </View>
      {Platform.OS === "web" ? (
        // A read-only box that wraps the whole link, so it can be selected and copied by hand.
        <AutoGrowInput
          value={inviteUrl}
          editable={false}
          selectTextOnFocus
          accessibilityLabel="Invite link"
          style={[s.input, inviteText]}
        />
      ) : (
        // A read-only text field can't be selected on iPhone; text can (press and hold).
        <Text selectable accessibilityLabel={`Invite link: ${inviteUrl}`} style={[s.input, inviteText]}>
          {inviteUrl}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {canShare() && (
          <Action icon="share" onPress={() => void share()} style={{ paddingHorizontal: 16 }}>
            Share
          </Action>
        )}
        <Action
          secondary={canShare()}
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
          confirm("Make a new invite link?", "The current link will stop working.", "Make new link", () => {
            setCopied(false);
            void run(
              "invite",
              () => request(`${base}/invite`, { method: "POST" }),
              "New invite link created.",
            );
          })
        }
      >
        {busy === "invite" ? "Creating…" : "Make a new link"}
      </Action>
    </Card>
  );
  return (
    <>
      {/* Reports waiting for a decision come first, so a commissioner sees them on opening the tab. */}
      {reportsWaiting && reports}
      {inviteFirst && invite}
      {/* The admin's tools for this league type (`LEAGUE_TYPE_SCREENS[type].AdminTools`): Set up a week, … */}
      {admin && adminTools}
      {!inviteFirst && invite}
      {!reportsWaiting && reports}
      <Card label="Members">
        <CardTitle>Members ({league.members.length})</CardTitle>
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
              <Avatar avatarId={target.avatarId} name={target.displayName} size={32} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.text, { fontFamily: fonts.medium }]}>
                  {target.displayName}
                  {target.userId === userId && <Text style={{ color: colors.mutedForeground }}> (you)</Text>}
                </Text>
                {busy === "role" && member?.userId === target.userId && <Label>Saving…</Label>}
              </View>
              {target.role === "admin" && <Pill inline>Commissioner</Pill>}
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
          <CardTitle>League settings</CardTitle>
          <Input
            label="League name"
            value={name}
            onChangeText={setName}
            maxLength={LEAGUE_NAME_MAX}
            editable={!busy}
            onSubmit={saveSettings}
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
            <View style={{ gap: 6 }}>
              <Select
                label="How it's run"
                value={management}
                onChange={setManagement}
                disabled={!!busy}
                choices={managementOptions.map((value) => ({ value, label: MANAGEMENT_LABEL[value] }))}
              />
              <Label>{MANAGEMENT_DETAIL[management]}</Label>
            </View>
          )}
          {sharingChoice && (
            <PreferenceToggle
              label="Show players the results so far"
              description="While a week is open, everyone sees each pick once its game kicks off, and the points as they stand. Off, only commissioners do."
              checked={shareSoFar}
              disabled={!!busy}
              onChange={setShareEdit}
            />
          )}
          <Failure message={error} />
          <Action
            secondary
            busy={busy === "settings"}
            disabled={(!!busy && busy !== "settings") || (!dirty && busy !== "settings")}
            onPress={saveSettings}
          >
            {busy === "settings" ? "Saving…" : "Save settings"}
          </Action>
        </Card>
      )}
      <Card label="Leave league">
        <CardTitle>Leave league</CardTitle>
        <Label>
          {admin && adminCount === 1
            ? "You're the only commissioner. Make another member a commissioner before you leave."
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
                label={member.role === "admin" ? "Revoke commissioner" : "Make commissioner"}
                accessibilityLabel={
                  member.role === "admin"
                    ? `Revoke commissioner access for ${member.displayName}`
                    : `Make ${member.displayName} a commissioner`
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
