/** Same day-sensitive timestamp wording as the browser's format.relativeTime. */
export function messageTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const time = then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(then)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${then.toLocaleDateString("en-US", { weekday: "short" })}, ${time}`;
  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: then.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** "1 reply", "2 replies": a count with its noun, singular for exactly one. */
export const counted = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** A run of a message's text: plain, or a web address to show as a link. */
export type TextPart = { type: "text"; text: string } | { type: "link"; text: string; url: string };

/** Characters that end a sentence or a bracket rather than an address. */
const TRAILING = /[.,;:!?'"’”)\]}>]$/;
const OPENERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/**
 * Splits a message into text and links. Only `http://` and `https://` addresses with a host become links
 * (never `javascript:` or other schemes, which stay plain text). Punctuation after an address stays outside
 * it ("see https://example.com/a." links without the full stop), except a closing bracket the address itself
 * opened ("https://example.com/a_(b)").
 */
export function linkParts(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const push = (value: string) => {
    if (!value) return;
    const last = parts.at(-1);
    if (last?.type === "text") last.text += value;
    else parts.push({ type: "text", text: value });
  };
  let from = 0;
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"]+/gi)) {
    let url = match[0];
    while (TRAILING.test(url)) {
      const last = url.at(-1) as string;
      const opener = OPENERS[last];
      // Keep a bracket that closes one inside the address.
      if (opener && url.split(opener).length > url.split(last).length - 1) break;
      url = url.slice(0, -1);
    }
    // An address needs a host: "https://" alone, or "https://?x", is just text.
    if (!/^https?:\/\/[^/?#\s]+/i.test(url)) continue;
    push(text.slice(from, match.index));
    parts.push({ type: "link", text: url, url });
    from = match.index + url.length;
  }
  push(text.slice(from));
  return parts;
}

/**
 * The in-app path of a link to this app (one of `origins`: the page's own, or the website's from the iPhone
 * app), so it opens here rather than in a new tab or the browser. Null for every other address, and for one
 * carrying credentials.
 */
export function inAppPath(url: string, origins: readonly (string | undefined)[]): string | null {
  const match = /^(https?:\/\/[^/?#\s@]+)([/?#][^\s]*)?$/i.exec(url);
  if (!match) return null;
  const origin = (match[1] as string).toLowerCase();
  if (!origins.some((value) => value?.toLowerCase() === origin)) return null;
  const rest = match[2] ?? "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

/** Where a thread opens: at its top, at its last message, or on one message. */
export type ThreadArrival =
  | { at: "top" }
  | { at: "end" }
  | { at: "post"; postId: string; reason: "unread" | "linked" };

/**
 * Where to put a reader who opens a thread:
 * - a link to one message (`linkedPostId`, from a report) lands on that message;
 * - a thread with replies they haven't read lands on the first one;
 * - a thread they never opened, or one from a server that doesn't say what they read, starts at the top;
 * - a thread they have read to the end opens on its latest message, where the conversation and the reply box
 *   are (a short thread fits on the screen either way).
 */
export function threadArrival(
  thread: { version: number; readVersion?: number; posts: readonly { id: string; position: number }[] },
  linkedPostId?: string,
): ThreadArrival {
  if (linkedPostId && thread.posts.some((post) => post.id === linkedPostId))
    return { at: "post", postId: linkedPostId, reason: "linked" };
  const read = thread.readVersion;
  if (read === undefined || read < 1) return { at: "top" };
  const firstUnread = thread.posts.find((post) => post.position > read);
  if (firstUnread) return { at: "post", postId: firstUnread.id, reason: "unread" };
  return thread.posts.length > 1 ? { at: "end" } : { at: "top" };
}

/** How long after a message the same author's next one still reads as part of it. */
export const GROUP_WINDOW_MS = 5 * 60_000;

/** What `groupsWithPrevious` needs to know about a message as it is drawn. */
export type GroupedPost = {
  authorId: string;
  createdAt: string;
  position: number;
  /** It stands in for the text (removed, hidden, blocked, a deleted player's): drawn as its own row. */
  placeholder?: boolean;
};

/**
 * Whether a reply follows straight on from the message above it, so it drops its avatar and name and sits
 * close under it: the same author, under five minutes later, both drawn with their text, and no "New" line
 * between them (`separated`). The first message is the thread's topic, in its own card, so nothing joins it.
 */
export function groupsWithPrevious(
  previous: GroupedPost | undefined,
  post: GroupedPost,
  separated = false,
): boolean {
  if (!previous || separated || previous.position === 1) return false;
  if (previous.placeholder || post.placeholder || previous.authorId !== post.authorId) return false;
  const gap = new Date(post.createdAt).getTime() - new Date(previous.createdAt).getTime();
  return gap >= 0 && gap < GROUP_WINDOW_MS;
}

/**
 * A message's reactions after the reader turns one on or off (`active`), before the server answers: their own
 * mark flips and the count moves by one; a reaction nobody has left goes, a new one joins at the end. Turning
 * on one already theirs (or off one that isn't) changes nothing.
 */
export function toggledReactions<R extends { emoji: string; count: number; reacted: boolean }>(
  reactions: readonly R[],
  emoji: R["emoji"],
  active: boolean,
): R[] {
  const current = reactions.find((reaction) => reaction.emoji === emoji);
  if (!!current?.reacted === active) return [...reactions];
  if (!current) return active ? [...reactions, { emoji, count: 1, reacted: true } as R] : [...reactions];
  const count = current.count + (active ? 1 : -1);
  return count > 0
    ? reactions.map((reaction) => (reaction === current ? { ...reaction, count, reacted: active } : reaction))
    : reactions.filter((reaction) => reaction !== current);
}

/** The keyboard shortcut that posts a reply (⌘↩ on a Mac, Ctrl+↩ elsewhere), from the browser's platform. */
export function postShortcut(platform: string | undefined): string {
  return /mac|iphone|ipad/i.test(platform ?? "") ? "⌘↩ to post" : "Ctrl+↩ to post";
}
