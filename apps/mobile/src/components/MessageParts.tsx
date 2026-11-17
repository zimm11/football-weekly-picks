import type { MessageQuote, MessageThread } from "@picks/shared";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { messageTime } from "../lib/messagePresentation";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { colors, fonts } from "./ui";

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
export function BoardRows({
  threads,
  now,
  onOpen,
}: {
  threads: MessageThread[];
  now: Date;
  onOpen: (id: string) => void;
}) {
  if (!threads.length) return null;
  return (
    <View style={p.board}>
      {threads.map((thread, index) => (
        <Pressable
          key={thread.id}
          accessibilityRole="link"
          accessibilityLabel={`${thread.unread ? "Unread. " : ""}${thread.pinned ? "Pinned announcement. " : ""}${thread.title}, by ${thread.authorName}, ${thread.version - 1} ${thread.version === 2 ? "reply" : "replies"}`}
          style={({ pressed }) => [
            p.boardRow,
            index > 0 && p.divider,
            pressed && { backgroundColor: colors.raised },
          ]}
          onPress={() => onOpen(thread.id)}
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
              {thread.authorName} · {thread.version - 1} {thread.version === 2 ? "reply" : "replies"}
            </Text>
            {thread.pinned && <PinnedBadge />}
          </View>
          <MessageTimestamp value={thread.updatedAt} now={now} compact />
        </Pressable>
      ))}
    </View>
  );
}
export function MessageBackLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" style={p.back} onPress={onPress}>
      <Icon name="arrow-left" size={14} color={colors.mutedForeground} />
      <Text style={p.backText}>Message board</Text>
    </Pressable>
  );
}
export function QuotedMessage({ quote, onOriginal }: { quote: MessageQuote; onOriginal: () => void }) {
  return (
    <View accessibilityLabel={`Quoted message from ${quote.authorName}`} style={p.quote}>
      <View style={p.quoteLabel}>
        <Icon name="quote" size={16} color={colors.primary} filled />
        <Text style={p.quoteAuthor}>{quote.authorName} wrote:</Text>
      </View>
      <Text style={p.quoteBody} numberOfLines={3}>
        {quote.body}
      </Text>
      <Pressable accessibilityRole="link" onPress={onOriginal} style={p.original}>
        <Text style={p.link}>View original</Text>
      </Pressable>
    </View>
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
  backText: { fontFamily: fonts.medium, color: colors.mutedForeground, fontSize: 14 },
  quote: { borderRadius: 12, backgroundColor: `${colors.primary}1a`, padding: 12, gap: 8 },
  quoteLabel: { flexDirection: "row", gap: 6, alignItems: "center" },
  quoteAuthor: { fontFamily: fonts.semibold, color: colors.foreground, fontSize: 14, flexShrink: 1 },
  quoteBody: { fontFamily: fonts.body, color: colors.mutedForeground, fontSize: 16, lineHeight: 23 },
  original: { minHeight: 44, alignSelf: "flex-start", justifyContent: "center" },
  link: { color: colors.primary, fontFamily: fonts.body, fontSize: 14 },
});
