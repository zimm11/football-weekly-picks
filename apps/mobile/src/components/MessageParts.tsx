import type { MessageQuote, MessageThread } from "@picks/shared";
import type { ComponentRef, Ref } from "react";
import {
  type GestureResponderEvent,
  Linking,
  Platform,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from "react-native";
import { pageOrigin } from "../lib/config";
import { counted, inAppPath, linkParts, messageTime } from "../lib/messagePresentation";
import { notifyError } from "../lib/notify";
import { AppLink, type LinkHow, openPath } from "./AppLink";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { hoverFill, pressState, ringInside } from "./pressState";
import { corner, layout, radius, space, type } from "./theme";
import { Badge, colors, fonts } from "./ui";

/** The app's own addresses: a link to one opens inside the app. */
const APP_ORIGINS = [pageOrigin(), "https://www.pow-pickem.com"];

/** When a message was posted. `compact` is a board row's; `unread` marks it in the primary color. */
export function MessageTimestamp({
  value,
  now,
  compact = false,
  unread = false,
}: {
  value: string;
  now: Date;
  compact?: boolean;
  unread?: boolean;
}) {
  return (
    <Text
      accessibilityLabel={new Date(value).toLocaleString()}
      style={[p.meta, compact && p.time, unread && p.unreadText]}
    >
      {messageTime(value, now)}
    </Text>
  );
}
export function PinnedBadge() {
  return (
    <Badge tone="primary" icon="pin">
      Pinned announcement
    </Badge>
  );
}
/** The board's threads, each a link to its thread (`hrefOf(id)`). */
export function BoardRows({
  threads,
  now,
  hrefOf,
}: {
  threads: MessageThread[];
  now: Date;
  hrefOf: (id: string) => string;
}) {
  if (!threads.length) return null;
  return (
    <View style={p.board}>
      {threads.map((thread, index) => (
        <AppLink
          key={thread.id}
          href={hrefOf(thread.id)}
          accessibilityLabel={`${thread.unread ? "Unread. " : ""}${thread.pinned ? "Pinned announcement. " : ""}${thread.title}, by ${thread.authorName}, ${counted(thread.version - 1, "reply", "replies")}`}
          style={(state) => [
            p.boardRow,
            index > 0 && p.divider,
            { backgroundColor: hoverFill(state) },
            ringInside,
          ]}
        >
          {/* Unread: a dot in the row's leading edge, level with the title's first line. */}
          {thread.unread && <View style={p.dot} />}
          <Avatar avatarId={thread.avatarId} name={thread.authorName} />
          <View style={p.boardContent}>
            <Text
              numberOfLines={2}
              style={[p.rowTitle, { fontFamily: thread.unread ? fonts.semibold : fonts.medium }]}
            >
              {thread.title}
            </Text>
            <Text style={p.meta}>
              {thread.unread && (
                <>
                  <Text style={p.unreadText}>Unread</Text>
                  {" · "}
                </>
              )}
              {thread.authorName} ·{" "}
              {thread.version > 1 ? counted(thread.version - 1, "reply", "replies") : "No replies yet"}
            </Text>
            {thread.pinned && (
              <View style={p.pinned}>
                <PinnedBadge />
              </View>
            )}
          </View>
          <MessageTimestamp value={thread.updatedAt} now={now} compact unread={thread.unread} />
        </AppLink>
      ))}
    </View>
  );
}
/**
 * The way back to the board: a link to `href`. The default goes back down to the board when it is under this
 * screen and takes this screen's place otherwise (`dismissTo`), so the board is never in the history twice;
 * `onPress` replaces that. `compact` is the phone's thread bar: the arrow alone, still named "Message board".
 */
export function MessageBackLink({
  href,
  how = "dismissTo",
  onPress,
  compact = false,
}: {
  href: string;
  how?: LinkHow;
  onPress?: () => void;
  compact?: boolean;
}) {
  return (
    <AppLink
      href={href}
      how={how}
      onPress={onPress}
      accessibilityLabel="Message board"
      style={(state) => [compact ? p.backCompact : p.back, { opacity: pressState(state).pressed ? 0.7 : 1 }]}
    >
      {(state) => {
        const ink = pressState(state).hovered ? colors.foreground : colors.mutedForeground;
        return (
          <>
            <Icon name="arrow-left" size={compact ? 20 : 14} color={ink} />
            {!compact && <Text style={[p.backText, { color: ink }]}>Message board</Text>}
          </>
        );
      }}
    </AppLink>
  );
}
/** `href` is the thread at the quoted message, for a new tab; `onOriginal` scrolls to it in this one. */
export function QuotedMessage({
  quote,
  href,
  onOriginal,
}: {
  quote: MessageQuote;
  href: string;
  onOriginal: () => void;
}) {
  return (
    <View accessibilityLabel={`Quoted message from ${quote.authorName}`} style={p.quote}>
      <View style={p.quoteLabel}>
        <Icon name="quote" size={14} color={colors.primaryText} filled />
        <Text numberOfLines={1} style={p.quoteAuthor}>
          {quote.authorName} wrote:
        </Text>
        {/* 44px to touch through its padding, without making the quote taller. */}
        <AppLink
          href={href}
          onPress={onOriginal}
          style={(state) => [p.original, { opacity: pressState(state).pressed ? 0.7 : 1 }]}
        >
          {(state) => (
            <Text style={[p.link, pressState(state).hovered && { textDecorationLine: "underline" }]}>
              View original
            </Text>
          )}
        </AppLink>
      </View>
      <Text style={p.quoteBody} numberOfLines={2}>
        {quote.body}
      </Text>
    </View>
  );
}

/** A click the browser should handle itself (⌘/Ctrl/Shift-click opens a new tab or window). */
const browserOwns = (event: GestureResponderEvent) => {
  const click = event as unknown as { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean };
  return !!(click.metaKey || click.ctrlKey || click.shiftKey);
};

/**
 * A message's text, with its web addresses as links. A link to this app opens inside it; any other opens in a
 * new tab on the web (never handing this page to the site it opens) and in the browser from the iPhone app.
 */
export function MessageBody({
  body,
  style,
  accessibilityLabel,
  ref,
}: {
  body: string;
  style?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
  ref?: Ref<ComponentRef<typeof Text>>;
}) {
  const parts = linkParts(body);
  const web = Platform.OS === "web";
  return (
    <Text selectable ref={ref} accessibilityLabel={accessibilityLabel} style={style}>
      {parts.length === 1 && parts[0]?.type === "text"
        ? body
        : parts.map((part, index) => {
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one message never reorder.
            if (part.type === "text") return <Text key={index}>{part.text}</Text>;
            const path = inAppPath(part.url, APP_ORIGINS);
            const open = (event: GestureResponderEvent) => {
              if (path) {
                if (web && browserOwns(event)) return;
                event.preventDefault?.();
                void openPath(path);
              } else if (!web) Linking.openURL(part.url).catch(() => notifyError("Couldn't open that link."));
              // On the web an outside link is the browser's to follow, in its new tab.
            };
            return (
              <Text
                // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one message never reorder.
                key={index}
                accessibilityRole="link"
                style={p.bodyLink}
                onPress={path || !web ? open : undefined}
                {...(web
                  ? ({
                      href: part.url,
                      ...(!path && { hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } }),
                    } as object)
                  : null)}
              >
                {part.text}
              </Text>
            );
          })}
    </Text>
  );
}
const p = StyleSheet.create({
  board: { backgroundColor: colors.card, ...corner(radius.xl), overflow: "hidden" },
  boardRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.lg,
    paddingHorizontal: layout.cardPad,
    paddingVertical: 14,
    minHeight: 64,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  boardContent: { flex: 1, gap: space.xxs, minWidth: 0 },
  rowTitle: { ...type.body, lineHeight: 22, color: colors.foreground },
  // In the row's 16px leading edge, centered on the title's first 22px line.
  dot: {
    position: "absolute",
    left: space.xs,
    top: 14 + 7,
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  unreadText: { color: colors.primaryText, fontFamily: fonts.semibold },
  meta: { ...type.small, color: colors.mutedForeground },
  time: { ...type.caption, flexShrink: 0, maxWidth: 90, marginTop: 3 },
  pinned: { marginTop: space.xs },
  back: { flexDirection: "row", gap: space.xs, alignItems: "center", alignSelf: "flex-start", minHeight: 44 },
  backCompact: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
  },
  backText: { ...type.small, fontFamily: fonts.medium, color: colors.mutedForeground },
  bodyLink: { color: colors.primary, textDecorationLine: "underline" },
  quote: {
    ...corner(radius.lg),
    backgroundColor: colors.primaryTint,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    gap: space.xxs,
    marginVertical: space.xxs,
  },
  quoteLabel: { flexDirection: "row", gap: space.sm, alignItems: "center" },
  quoteAuthor: { ...type.small, fontFamily: fonts.semibold, color: colors.foreground, flex: 1, minWidth: 0 },
  quoteBody: { ...type.small, color: colors.mutedForeground },
  original: { paddingVertical: space.lg, marginVertical: -space.lg, paddingLeft: space.md, flexShrink: 0 },
  link: { ...type.small, fontFamily: fonts.medium, color: colors.primaryText },
});
