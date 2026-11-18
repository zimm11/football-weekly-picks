// biome-ignore-all lint/correctness/noReactNativeRawText: Heading, Label and Action render native Text.
import {
  MUTE_DURATION_LABELS,
  type MuteDuration,
  type OperatorReportQueue,
  REPORT_REASON_LABELS,
  type ReportItem,
  type ReportQueue,
  type ReportReason,
} from "@picks/shared";
import { type ComponentRef, useRef, useState } from "react";
import { Text, View } from "react-native";
import { type Anchor, Menu, MenuItem } from "../components/Popover";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { corner, radius, space, type } from "../components/theme";
import { CardTitle, colors, fonts } from "../components/ui";
import { request } from "../lib/api";
import { now } from "../lib/clock";
import { showConfirm } from "../lib/dialogs";
import { counted, messageTime } from "../lib/messagePresentation";
import { groupReports, type ReportGroup } from "../lib/moderation";
import { notifyDone, notifyError } from "../lib/notify";
import { Action, Eyebrow, Failure, IconButton, Label, Pill, s, useLeagueLoad } from "./leagueUi";

type Resolve = { action: "remove" | "dismiss" | "restore"; mute?: MuteDuration };

/**
 * Open reports with their actions. League admins see their league's (`/leagues/:id/reports`); the operator sees
 * every one, plus players close to a suspension (`/operator/reports`).
 */
export function ReportsQueue({
  path,
  operator = false,
  onChanged,
}: {
  path: string;
  operator?: boolean;
  onChanged?: () => void;
}) {
  const queue = useLeagueLoad(() => request<ReportQueue | OperatorReportQueue>(path), path);
  const [busy, setBusy] = useState<string>();
  const [menu, setMenu] = useState<{ group: ReportGroup; anchor: Anchor }>();
  const buttons = useRef(new Map<string, ComponentRef<typeof View>>());

  async function run(key: string, task: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(key);
    try {
      await task();
      notifyDone(done);
      queue.reload();
      onChanged?.();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(undefined);
    }
  }
  /**
   * Resolves every report in a card (the API closes all the open reports about the same message or name).
   * Removing or resetting asks first: it counts against the author, and a reset can't be undone from here.
   */
  async function resolve(item: ReportItem, body: Resolve) {
    if (body.action === "remove") {
      const name = item.subject?.displayName ?? "the player";
      const muted = body.mute
        ? ` ${item.subject?.displayName ?? "The player"} also can't post ${operator ? "anywhere" : "in this league"} for ${MUTE_DURATION_LABELS[body.mute]}.`
        : "";
      const ask =
        item.kind === "post"
          ? {
              title: `Remove ${name}'s message?`,
              message: `${
                item.post?.position === 1
                  ? "This is the thread's first message, so the whole thread leaves the board."
                  : "Everyone sees “Message removed” in its place."
              } It counts against the author, who can ask for a review.${muted}`,
              confirmLabel: body.mute ? "Remove and mute" : "Remove message",
            }
          : item.kind === "display_name"
            ? {
                title: `Reset ${name}'s name?`,
                message: `Their display name becomes “Player” until they choose another.${muted}`,
                confirmLabel: body.mute ? "Reset and mute" : "Reset name",
              }
            : {
                title: `Reset the name “${item.league?.name ?? "this league"}”?`,
                message: "The league is renamed “League” until a commissioner gives it another name.",
                confirmLabel: "Reset name",
              };
      if (!(await showConfirm({ ...ask, destructive: true }))) return;
    }
    const done =
      body.action === "remove"
        ? item.kind === "post"
          ? "Message removed."
          : "Name reset."
        : body.action === "restore"
          ? "Message restored."
          : item.source === "appeal"
            ? "Kept removed."
            : "Report dismissed.";
    void run(
      item.id,
      () => request(`/reports/${item.id}/resolve`, { method: "POST", body }),
      body.mute ? `${done} ${item.subject?.displayName ?? "The player"} is muted.` : done,
    );
  }
  async function suspend(userId: string, name: string, suspended: boolean) {
    if (
      suspended &&
      !(await showConfirm({
        title: `Turn off posting for ${name}?`,
        message:
          "They can't post, reply, react or change names anywhere until you lift it. Picking, results and standings aren't affected.",
        confirmLabel: "Suspend posting",
        destructive: true,
      }))
    )
      return;
    void run(
      `suspend:${userId}`,
      () => request(`/operator/users/${userId}/suspension`, { method: "PUT", body: { suspended } }),
      suspended ? `Posting is off for ${name}.` : `Posting is back on for ${name}.`,
    );
  }

  if (queue.error && !queue.data) return <Failure message={queue.error} retry={queue.reload} />;
  if (!queue.data)
    return (
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Loading reports"
        accessibilityState={{ busy: true }}
        style={{ gap: space.md }}
      >
        <SkeletonBlock width="60%" height={18} />
        <SkeletonBlock width="85%" height={18} />
      </View>
    );
  const groups = groupReports(queue.data.items);
  const repeat = "repeatOffenders" in queue.data ? queue.data.repeatOffenders : [];
  return (
    <View style={{ gap: 12 }}>
      {groups.length === 0 && <Label>No reports waiting. Nice.</Label>}
      {groups.map((group) => {
        const { first: item, headline } = group;
        const several = group.items.length > 1;
        return (
          <View
            key={item.id}
            role="region"
            aria-label={headline}
            style={{ gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}
          >
            <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
              <View style={{ flex: 1, gap: 4 }}>
                {/* Each report's title, under the Reports card's own (16px: a part of that card, not a card). */}
                <CardTitle level={3} style={[type.body, { fontFamily: fonts.semibold }]}>
                  {headline}
                </CardTitle>
                <Label>
                  {[
                    operator && item.league?.name,
                    !several && messageTime(item.createdAt, now()),
                    !several && item.source === "player" ? `reported by ${item.reporterName}` : null,
                    group.otherReports > 0 ? `${counted(group.otherReports, "other report")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Label>
              </View>
              <IconButton
                ref={(node) => {
                  if (node) buttons.current.set(item.id, node);
                  else buttons.current.delete(item.id);
                }}
                name="more"
                label={`More actions for ${headline}`}
                disabled={!!busy}
                onPress={() =>
                  buttons.current
                    .get(item.id)
                    ?.measureInWindow((x, y, width, height) =>
                      setMenu({ group, anchor: { x, y, width, height } }),
                    )
                }
              />
            </View>
            {item.post && (
              <View
                style={{
                  gap: space.sm,
                  padding: space.lg,
                  ...corner(radius.lg),
                  backgroundColor: colors.raised,
                }}
              >
                <Label>In “{item.post.threadTitle}”</Label>
                <Text selectable style={s.text}>
                  {item.post.body || "(text cleared)"}
                </Text>
                {(item.post.hidden || item.post.removed) && (
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    {item.post.hidden && <Pill>Hidden</Pill>}
                    {item.post.removed && <Pill tone="warning">Removed</Pill>}
                  </View>
                )}
              </View>
            )}
            {several ? (
              // One line per report: why, who, when, and what they added.
              <View role="list" aria-label="Reports" style={{ gap: 6 }}>
                {group.items.map((report) => (
                  <View key={report.id} role="listitem" style={{ gap: 2 }}>
                    <Label>
                      {[
                        report.source === "player"
                          ? (REPORT_REASON_LABELS[report.reason as ReportReason] ?? "Reported")
                          : "Flagged automatically",
                        report.source === "player" ? `reported by ${report.reporterName}` : null,
                        messageTime(report.createdAt, now()),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Label>
                    {report.note && <Label>“{report.note}”</Label>}
                  </View>
                ))}
              </View>
            ) : (
              item.note && <Label>“{item.note}”</Label>
            )}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {item.source === "appeal" ? (
                <>
                  <Action compact disabled={!!busy} onPress={() => void resolve(item, { action: "restore" })}>
                    {busy === item.id ? "Saving…" : "Restore message"}
                  </Action>
                  <Action
                    compact
                    secondary
                    disabled={!!busy}
                    onPress={() => void resolve(item, { action: "dismiss" })}
                  >
                    Keep removed
                  </Action>
                </>
              ) : (
                <>
                  <Action
                    compact
                    secondary
                    danger
                    disabled={!!busy}
                    onPress={() => void resolve(item, { action: "remove" })}
                  >
                    {busy === item.id ? "Saving…" : item.kind === "post" ? "Remove" : "Reset name"}
                  </Action>
                  <Action
                    compact
                    secondary
                    disabled={!!busy}
                    onPress={() => void resolve(item, { action: "dismiss" })}
                  >
                    Dismiss
                  </Action>
                </>
              )}
              {/* Only where the thread would open: the operator isn't in every league, and a removed thread is gone. */}
              {item.post && item.league && item.canOpen !== false && (
                <Action
                  compact
                  ghost
                  disabled={!!busy}
                  href={`/leagues/${encodeURIComponent(item.league.id)}/messages/${encodeURIComponent(item.post.threadId)}?post=${encodeURIComponent(item.post.id)}`}
                >
                  Open thread
                </Action>
              )}
            </View>
          </View>
        );
      })}
      {operator && repeat.length > 0 && (
        <View style={{ gap: 8 }}>
          <Eyebrow>Players with 3 or more removals in 30 days</Eyebrow>
          {repeat.map((player) => (
            <View
              key={player.userId}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, flexWrap: "wrap" }}
            >
              <Text style={[s.text, { flex: 1 }]}>
                {player.displayName} · {counted(player.removals, "removal")}
                {player.suspended ? " · posting off" : player.mutedUntil ? " · muted" : ""}
              </Text>
              <Action
                compact
                secondary
                danger={!player.suspended}
                disabled={!!busy}
                onPress={() => void suspend(player.userId, player.displayName, !player.suspended)}
              >
                {player.suspended ? "Lift suspension" : "Suspend posting"}
              </Action>
            </View>
          ))}
        </View>
      )}
      <Menu
        anchor={menu?.anchor}
        onClose={() => setMenu(undefined)}
        label={menu ? `More actions for ${menu.group.headline}` : "More actions"}
        align="end"
      >
        {menu?.group.first.source !== "appeal" &&
          (["24h", "7d"] as const).map((duration) => (
            <MenuItem
              key={duration}
              icon="mute"
              label={`${menu?.group.first.kind === "post" ? "Remove" : "Reset"} and mute ${MUTE_DURATION_LABELS[duration]}`}
              disabled={!menu?.group.first.subject}
              onPress={() => {
                const item = menu?.group.first;
                setMenu(undefined);
                if (item) void resolve(item, { action: "remove", mute: duration });
              }}
            />
          ))}
        {operator && menu?.group.first.subject && (
          <MenuItem
            icon="block"
            destructive
            label={`Suspend posting for ${menu.group.first.subject.displayName}`}
            onPress={() => {
              const subject = menu?.group.first.subject;
              setMenu(undefined);
              if (subject) void suspend(subject.userId, subject.displayName, true);
            }}
          />
        )}
      </Menu>
    </View>
  );
}
