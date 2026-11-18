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
import { colors, fonts } from "./ui";

/** The app's own addresses: a link to one opens inside the app. */
const APP_ORIGINS = [pageOrigin(), "https://www.pow-pickem.com"];

export function MessageTimestamp({
  value,
  now,
  compact = false,
}: {
  value: string;
  now: Date;
  compact?: boolean;
}) {
  return (
    <Text accessibilityLabel={new Date(value).toLocaleString()} style={[p.meta, compact && p.time]}>
      {messageTime(value, now)}
    </Text>
  );
}
export function PinnedBadge() {
  return (
    <View style={p.badge}>
      <Icon name="pin" size={12} color={colors.primary} filled />
      <Text style={p.badgeText}>Pinned announcement</Text>
    </View>
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
          <Avatar avatarId={thread.avatarId} name={thread.authorName} />
          <View style={p.boardContent}>
            <View style={p.titleRow}>
              <Text style={[p.rowTitle, { fontFamily: thread.unread ? fonts.semibold : fonts.medium }]}>
                {thread.title}
              </Text>
              {thread.unread && (
                <View style={p.unread}>
                  <View style={p.dot} />
                  <Text style={p.unreadText}>Unread</Text>
                </View>
              )}
            </View>
            <Text style={p.meta}>
              {thread.authorName} · {counted(thread.version - 1, "reply", "replies")}
            </Text>
            {thread.pinned && <PinnedBadge />}
          </View>
          <MessageTimestamp value={thread.updatedAt} now={now} compact />
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
        <Icon name="quote" size={16} color={colors.primary} filled />
        <Text style={p.quoteAuthor}>{quote.authorName} wrote:</Text>
      </View>
      <Text style={p.quoteBody} numberOfLines={3}>
        {quote.body}
      </Text>
      <AppLink href={href} onPress={onOriginal} style={p.original}>
        <Text style={p.link}>View original</Text>
      </AppLink>
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
  board: { backgroundColor: colors.card, borderRadius: 16, overflow: "hidden" },
  boardRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, minHeight: 88 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  boardContent: { flex: 1, gap: 2, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  rowTitle: { fontSize: 16, lineHeight: 22, color: colors.foreground, flexShrink: 1 },
  unread: { flexDirection: "row", gap: 4, alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  unreadText: { color: colors.primary, fontFamily: fonts.semibold, fontSize: 12 },
  meta: { color: colors.mutedForeground, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  time: { fontSize: 12, flexShrink: 0, maxWidth: 90, lineHeight: 16 },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: `${colors.primary}26`,
    marginTop: 4,
  },
  badgeText: { fontFamily: fonts.medium, color: colors.foreground, fontSize: 12, lineHeight: 16 },
  back: { flexDirection: "row", gap: 4, alignItems: "center", alignSelf: "flex-start", minHeight: 44 },
  backCompact: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22 },
  backText: { fontFamily: fonts.medium, color: colors.mutedForeground, fontSize: 14 },
  bodyLink: { color: colors.primary, textDecorationLine: "underline" },
  quote: { borderRadius: 12, backgroundColor: `${colors.primary}1a`, padding: 12, gap: 8 },
  quoteLabel: { flexDirection: "row", gap: 6, alignItems: "center" },
  quoteAuthor: { fontFamily: fonts.semibold, color: colors.foreground, fontSize: 14, flexShrink: 1 },
  quoteBody: { fontFamily: fonts.body, color: colors.mutedForeground, fontSize: 16, lineHeight: 23 },
  original: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  link: { color: colors.primary, fontFamily: fonts.body, fontSize: 14 },
});
