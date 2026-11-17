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
import { router } from "expo-router";
import { type ComponentRef, useRef, useState } from "react";
import { Text, View } from "react-native";
import { type Anchor, Menu, MenuItem } from "../components/Popover";
import { colors, fonts } from "../components/ui";
import { request } from "../lib/api";
import { now } from "../lib/clock";
import { showConfirm } from "../lib/dialogs";
import { messageTime } from "../lib/messagePresentation";
import { notifyDone, notifyError } from "../lib/notify";
import { Action, Eyebrow, Failure, IconButton, Label, Pill, s, useLeagueLoad } from "./leagueUi";

/** What a queue item is about, in a few words. */
export function reportHeadline(item: ReportItem): string {
  const about =
    item.kind === "post"
      ? `Message from ${item.subject?.displayName ?? "a player"}`
      : item.kind === "display_name"
        ? `${item.subject?.displayName ?? "A player"}'s name`
        : `League name “${item.league?.name ?? ""}”`;
  if (item.source === "appeal") return `Appeal: ${about.toLowerCase()}`;
  if (item.source !== "player") return `${about}, flagged automatically`;
  return `${about}: ${REPORT_REASON_LABELS[item.reason as ReportReason] ?? "Reported"}`;
}

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
  const [menu, setMenu] = useState<{ item: ReportItem; anchor: Anchor }>();
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
  function resolve(item: ReportItem, body: Resolve) {
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
      <View accessibilityRole="progressbar" accessibilityLabel="Loading reports" style={{ gap: 8 }}>
        <View style={{ height: 18, width: "60%", borderRadius: 6, backgroundColor: colors.raised }} />
        <View style={{ height: 18, width: "85%", borderRadius: 6, backgroundColor: colors.raised }} />
      </View>
    );
  const items = queue.data.items;
  const repeat = "repeatOffenders" in queue.data ? queue.data.repeatOffenders : [];
  return (
    <View style={{ gap: 12 }}>
      {items.length === 0 && <Label>No reports waiting. Nice.</Label>}
      {items.map((item) => (
        <View
          key={item.id}
          role="region"
          aria-label={reportHeadline(item)}
          style={{ gap: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}
        >
          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[s.text, { fontFamily: fonts.semibold }]}>{reportHeadline(item)}</Text>
              <Label>
                {[
                  operator && item.league?.name,
                  messageTime(item.createdAt, now()),
                  item.source === "player" ? `reported by ${item.reporterName}` : null,
                  item.otherReports > 0
                    ? `${item.otherReports} other ${item.otherReports === 1 ? "report" : "reports"}`
                    : null,
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
              label={`More actions for ${reportHeadline(item)}`}
              disabled={!!busy}
              onPress={() =>
                buttons.current
                  .get(item.id)
                  ?.measureInWindow((x, y, width, height) =>
                    setMenu({ item, anchor: { x, y, width, height } }),
                  )
              }
            />
          </View>
          {item.post && (
            <View style={{ gap: 6, padding: 12, borderRadius: 10, backgroundColor: colors.raised }}>
              <Label>In “{item.post.threadTitle}”</Label>
              <Text selectable style={s.text}>
                {item.post.body || "(text cleared)"}
              </Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {item.post.hidden && <Pill>Hidden</Pill>}
                {item.post.removed && <Pill tone="warning">Removed</Pill>}
              </View>
            </View>
          )}
          {item.note && <Label>“{item.note}”</Label>}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {item.source === "appeal" ? (
              <>
                <Action compact disabled={!!busy} onPress={() => resolve(item, { action: "restore" })}>
                  {busy === item.id ? "Saving…" : "Restore message"}
                </Action>
                <Action
                  compact
                  secondary
                  disabled={!!busy}
                  onPress={() => resolve(item, { action: "dismiss" })}
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
                  onPress={() => resolve(item, { action: "remove" })}
                >
                  {busy === item.id ? "Saving…" : item.kind === "post" ? "Remove" : "Reset name"}
                </Action>
                <Action
                  compact
                  secondary
                  disabled={!!busy}
                  onPress={() => resolve(item, { action: "dismiss" })}
                >
                  Dismiss
                </Action>
              </>
            )}
            {item.post && (
              <Action
                compact
                ghost
                link
                disabled={!!busy || !item.league}
                onPress={() =>
                  item.league &&
                  item.post &&
                  router.push({
                    pathname: "/leagues/[id]/messages/[threadId]",
                    params: { id: item.league.id, threadId: item.post.threadId },
                  })
                }
              >
                Open thread
              </Action>
            )}
          </View>
        </View>
      ))}
      {operator && repeat.length > 0 && (
        <View style={{ gap: 8 }}>
          <Eyebrow>Players with 3 or more removals in 30 days</Eyebrow>
          {repeat.map((player) => (
            <View
              key={player.userId}
              style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, flexWrap: "wrap" }}
            >
              <Text style={[s.text, { flex: 1 }]}>
                {player.displayName} · {player.removals} removals
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
        label={menu ? `More actions for ${reportHeadline(menu.item)}` : "More actions"}
        align="end"
      >
        {menu?.item.source !== "appeal" &&
          (["24h", "7d"] as const).map((duration) => (
            <MenuItem
              key={duration}
              icon="mute"
              label={`${menu?.item.kind === "post" ? "Remove" : "Reset"} and mute ${MUTE_DURATION_LABELS[duration]}`}
              disabled={!menu?.item.subject}
              onPress={() => {
                const item = menu?.item;
                setMenu(undefined);
                if (item) resolve(item, { action: "remove", mute: duration });
              }}
            />
          ))}
        {operator && menu?.item.subject && (
          <MenuItem
            icon="block"
            destructive
            label={`Suspend posting for ${menu.item.subject.displayName}`}
            onPress={() => {
              const subject = menu?.item.subject;
              setMenu(undefined);
              if (subject) void suspend(subject.userId, subject.displayName, true);
            }}
          />
        )}
      </Menu>
    </View>
  );
}
