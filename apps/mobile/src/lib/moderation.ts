import { DELETED_MESSAGE_TEXT, type MessagePost, type PostState } from "@picks/shared";

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
