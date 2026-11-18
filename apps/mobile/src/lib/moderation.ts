import {
  DELETED_MESSAGE_TEXT,
  type MessagePost,
  type PostState,
  REPORT_REASON_LABELS,
  type ReportItem,
  type ReportReason,
} from "@picks/shared";

/** What a reader can do from a message's ⋯ menu. */
export type PostAction = "report" | "block" | "unblock" | "remove" | "restore" | "appeal";

/**
 * The ⋯ menu for one message, in order. Anyone can report or block someone else's message; a league admin can
 * remove one or put a removed one back; the author of a removed message can ask once for a review.
 */
export function postActions(
  post: Pick<MessagePost, "state" | "mine" | "canAppeal">,
  viewer: { canModerate: boolean; blockedAuthor: boolean },
): PostAction[] {
  const actions: PostAction[] = [];
  // Its author deleted their account: there is nobody left to report, block or mute.
  if (post.state === "deleted") return actions;
  if (!post.mine && post.state !== "removed") actions.push("report");
  if (!post.mine) actions.push(viewer.blockedAuthor ? "unblock" : "block");
  if (viewer.canModerate) actions.push(post.state === "removed" ? "restore" : "remove");
  if (post.mine && post.state === "removed" && post.canAppeal) actions.push("appeal");
  return actions;
}

/**
 * What stands in for a message's text, if anything: removed and hidden ones say so; a blocked player's is
 * collapsed until the reader chooses Show, and so is a hidden one for an admin (who gets its text, to review it).
 * The reader's own message under review shows its text with a note.
 */
export function postPlaceholder(
  state: PostState,
  revealed: boolean,
  canModerate = false,
): { text: string; canShow: boolean } | null {
  if (state === "removed") return { text: "Message removed", canShow: false };
  if (state === "deleted") return { text: DELETED_MESSAGE_TEXT, canShow: false };
  if (state === "blocked" && !revealed) return { text: "Message from a blocked player", canShow: true };
  if (state === "hidden" && !revealed) return { text: "Hidden while it's reviewed", canShow: canModerate };
  return null;
}

/** What a queue item is about: "Message from Pat", "Pat's name", "League name “Sunday Crew”". */
function reportAbout(item: ReportItem, lead = true): string {
  if (item.kind === "post")
    return `${lead ? "Message" : "message"} from ${item.subject?.displayName ?? "a player"}`;
  if (item.kind === "display_name")
    return `${item.subject?.displayName ?? (lead ? "A player" : "a player")}'s name`;
  return `${lead ? "League" : "league"} name “${item.league?.name ?? ""}”`;
}

/** What a queue item is about, in a few words. Names keep their capitals wherever they fall. */
export function reportHeadline(item: ReportItem): string {
  if (item.source === "appeal") return `Appeal: ${reportAbout(item, false)}`;
  if (item.source !== "player") return `${reportAbout(item)}, flagged automatically`;
  return `${reportAbout(item)}: ${REPORT_REASON_LABELS[item.reason as ReportReason] ?? "Reported"}`;
}

/** Every open report about one message or name, to review and resolve together. */
export type ReportGroup = {
  /** The oldest report: its id resolves the whole group (the API closes every report on the same target). */
  first: ReportItem;
  items: ReportItem[];
  headline: string;
  /** Open reports on the same target that aren't in this list. */
  otherReports: number;
};

/**
 * Groups a queue's items by what they are about, keeping the queue's order (by each group's first report), so
 * a message three players reported is one card with three reasons rather than three cards. An appeal is
 * decided on its own, so it never joins the reports about the same message.
 */
export function groupReports(items: readonly ReportItem[]): ReportGroup[] {
  const groups = new Map<string, ReportItem[]>();
  for (const item of items) {
    const target =
      item.kind === "post"
        ? `post:${item.post?.id ?? item.id}`
        : item.kind === "display_name"
          ? `name:${item.subject?.userId ?? item.id}`
          : `league:${item.league?.id ?? item.id}`;
    const key = item.source === "appeal" ? `appeal:${item.id}` : target;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map((group) => {
    const first = group[0] as ReportItem;
    return {
      first,
      items: group,
      headline: group.length === 1 ? reportHeadline(first) : `${reportAbout(first)}: ${group.length} reports`,
      otherReports: Math.max(0, Math.max(...group.map((item) => item.otherReports)) - (group.length - 1)),
    };
  });
}
