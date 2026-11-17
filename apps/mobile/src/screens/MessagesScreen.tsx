import {
  createThreadSchema,
  type LeagueDetail,
  MESSAGE_BODY_MAX,
  MESSAGE_REACTIONS,
  type MessageEmoji,
  type MessagePost,
  type MessageQuote,
  type MessageReaction,
  type MessageThread,
  replySchema,
  THREAD_PAGE_SIZE,
  THREAD_TITLE_MAX,
  type ThreadDetail,
  type ThreadPage,
} from "@picks/shared";
import { router, useIsFocused } from "expo-router";
import { type ComponentRef, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
import {
  BoardRows,
  MessageBackLink,
  MessageTimestamp,
  PinnedBadge,
  QuotedMessage,
} from "../components/MessageParts";
import { ReportSheet, type ReportTarget, setBlocked, useTermsGate } from "../components/Moderation";
import { type Anchor, Menu, MenuItem, Popover, useAnchor } from "../components/Popover";
import { Badge, colors, fonts, Notice } from "../components/ui";
import { request } from "../lib/api";
import { now as clockNow } from "../lib/clock";
import { showConfirm } from "../lib/dialogs";
import { useResource } from "../lib/hooks";
import {
  announceMessagesChanged,
  setMessageNotice,
  setUnreadThreads,
  subscribeMessagesChanged,
  takeMessageNotice,
  useUnreadThreads,
} from "../lib/messageUnread";
import { postActions, postPlaceholder } from "../lib/moderation";
import { useRemovalGuard, useUnsavedWork } from "../lib/unsaved";
import { LeagueHeader, LeagueTabBar } from "./LeagueChrome";

const errorOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
const boardPath = (leagueId: string) => `/leagues/${encodeURIComponent(leagueId)}/messages`;
const threadPath = (leagueId: string, threadId: string) =>
  `${boardPath(leagueId)}/${encodeURIComponent(threadId)}`;

function Action({
  label,
  onPress,
  disabled = false,
  secondary = false,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        disabled && s.disabled,
        pressed && s.pressed,
      ]}
    >
      <Text style={[s.buttonText, secondary && s.text, destructive && s.error]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Poll only the screen the player is looking at, and only once it shows something: a board or thread that
 * failed to load (it doesn't exist, or no connection) waits for **Try again** or the next focus. Refresh
 * immediately when returning to the app.
 */
function useMessageRefresh(refresh: () => void, showing: boolean) {
  const focused = useIsFocused();
  const latest = useRef(refresh);
  latest.current = refresh;
  const poll = useRef(showing);
  poll.current = showing;
  useEffect(() => {
    if (!focused) return;
    latest.current();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") latest.current();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === "active" && poll.current) latest.current();
    }, 30_000);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [focused]);
}

function useDraftGuard(dirty: boolean, busy: boolean, onDiscard: () => void) {
  useUnsavedWork(dirty, onDiscard);
  useRemovalGuard(dirty, busy);
}

function LoadingMessages({ thread = false }: { thread?: boolean }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={thread ? "Loading thread" : "Loading messages"}
      style={s.stack}
    >
      {[0, 1, 2].map((key) => (
        <View key={key} style={s.card}>
          <View style={[s.skeleton, { width: "65%" }]} />
          <View style={[s.skeleton, { width: "90%" }]} />
          {thread && <View style={[s.skeleton, { width: "80%" }]} />}
        </View>
      ))}
    </View>
  );
}

function Failure({ error, retry }: { error: string; retry: () => void }) {
  return (
    <View style={s.card}>
      <Text accessibilityRole="alert" style={s.error}>
        {error}
      </Text>
      <Action label="Try again" secondary onPress={retry} />
    </View>
  );
}

export function MessagesScreen({
  leagueId,
  threadId,
  header,
  standalone = !!threadId,
}: {
  leagueId: string;
  threadId?: string;
  header?: ReactNode;
  standalone?: boolean;
}) {
  if (standalone && threadId)
    return <StandaloneMessages key={`${leagueId}:${threadId}`} leagueId={leagueId} threadId={threadId} />;
  if (threadId === "new") return <NewThread key={leagueId} leagueId={leagueId} header={header} />;
  if (threadId)
    return <Thread key={`${leagueId}:${threadId}`} leagueId={leagueId} threadId={threadId} header={header} />;
  return <Board key={leagueId} leagueId={leagueId} header={header} />;
}

function StandaloneMessages({ leagueId, threadId }: { leagueId: string; threadId: string }) {
  const league = useResource<LeagueDetail>(`/leagues/${leagueId}`);
  const unreadCount = useUnreadThreads(leagueId);
  const latest = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      latest.current++;
    };
  }, []);
  const refreshUnread = useCallback(async () => {
    const generation = ++latest.current;
    try {
      const page = await request<ThreadPage>(`${boardPath(leagueId)}?limit=1`);
      if (active.current && generation === latest.current) setUnreadThreads(leagueId, page.unreadCount);
    } catch {
      /* The board's retry state handles errors; an unread badge must never block a thread. */
    }
  }, [leagueId]);
  useMessageRefresh(() => {
    void refreshUnread();
  }, !!league.data);
  useEffect(
    () =>
      subscribeMessagesChanged(() => {
        void refreshUnread();
      }),
    [refreshUnread],
  );
  // Like every league screen: tabs in a row under the league name on wide screens, a bottom bar on phones.
  const wide = useWindowDimensions().width >= 768;
  const header = league.data ? (
    <>
      <LeagueHeader leagueId={leagueId} leagueName={league.data.name} />
      {wide && (
        <LeagueTabBar
          wide
          leagueId={leagueId}
          type={league.data?.type}
          active="messages"
          unreadCount={unreadCount}
        />
      )}
    </>
  ) : league.error ? (
    <Failure error={league.error} retry={league.reload} />
  ) : (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading league" style={s.stack}>
      <View style={[s.skeleton, { width: 80 }]} />
      <View style={[s.skeleton, { width: "60%", height: 30 }]} />
    </View>
  );
  // A league that didn't load (it doesn't exist, or no connection) says so once, as the league tabs do, rather
  // than again in the thread below.
  if (league.error && !league.data) return <ScrollView contentContainerStyle={s.screen}>{header}</ScrollView>;
  return (
    <View style={s.flex}>
      {threadId === "new" ? (
        <NewThread leagueId={leagueId} header={header} />
      ) : (
        <Thread leagueId={leagueId} threadId={threadId} header={header} />
      )}
      {!wide && (
        <LeagueTabBar
          leagueId={leagueId}
          type={league.data?.type}
          active="messages"
          unreadCount={unreadCount}
        />
      )}
    </View>
  );
}

function Board({ leagueId, header }: { leagueId: string; header?: ReactNode }) {
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState<ThreadPage>();
  const [older, setOlder] = useState<{ threads: MessageThread[]; nextCursor: string | null }>();
  const [error, setError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const reading = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const value = await request<ThreadPage>(`${boardPath(leagueId)}?limit=${THREAD_PAGE_SIZE}`);
      if (alive.current) {
        setPage(value);
        setUnreadThreads(leagueId, value.unreadCount);
        const message = takeMessageNotice(leagueId);
        if (message) setNotice(message);
        setError("");
      }
    } catch (err) {
      if (alive.current) setError(errorOf(err));
    } finally {
      reading.current = false;
    }
  }, [leagueId]);
  useMessageRefresh(() => {
    void refresh();
  }, !!page);
  const first = page?.threads ?? [];
  const shown = new Set(first.map((thread) => thread.id));
  const threads = [...first, ...(older?.threads ?? []).filter((thread) => !shown.has(thread.id))];
  const cursor = older ? older.nextCursor : page?.nextCursor;
  async function loadOlder() {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const next = await request<ThreadPage>(
        `${boardPath(leagueId)}?limit=${THREAD_PAGE_SIZE}&before=${encodeURIComponent(cursor)}`,
      );
      if (!alive.current) return;
      setOlder((previous) => {
        const have = new Set(previous?.threads.map((thread) => thread.id));
        return {
          threads: [...(previous?.threads ?? []), ...next.threads.filter((thread) => !have.has(thread.id))],
          nextCursor: next.nextCursor,
        };
      });
      setError("");
    } catch (err) {
      if (alive.current) setError(errorOf(err));
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      {header}
      <View style={s.boardHeading}>
        <Text accessibilityRole="header" style={s.heading}>
          Message board
        </Text>
        <Pressable
          accessibilityRole="link"
          style={s.newThread}
          onPress={() =>
            router.push({
              pathname: "/leagues/[id]/messages/[threadId]",
              params: { id: leagueId, threadId: "new" },
            })
          }
        >
          <Icon name="plus" size={16} color={colors.primaryForeground} />
          <Text style={s.buttonText}>New thread</Text>
        </Pressable>
      </View>
      {!!error && (
        <Failure
          error={error}
          retry={() => {
            void refresh();
          }}
        />
      )}
      {!page && !error && <LoadingMessages />}
      {page && threads.length === 0 && (
        <View style={s.card}>
          <Text style={s.text}>No threads yet. Start the conversation.</Text>
        </View>
      )}
      <BoardRows
        threads={threads}
        now={clockNow()}
        onOpen={(id) =>
          router.push({
            pathname: "/leagues/[id]/messages/[threadId]",
            params: { id: leagueId, threadId: id },
          })
        }
      />
      <Notice message={notice} />
      {cursor && (
        <Action
          label={loadingOlder ? "Loading…" : "Load older threads"}
          secondary
          disabled={loadingOlder}
          onPress={() => {
            void loadOlder();
          }}
        />
      )}
    </ScrollView>
  );
}

function NewThread({ leagueId, header }: { leagueId: string; header?: ReactNode }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string>();
  const submitting = useRef(false);
  const terms = useTermsGate();
  useDraftGuard(!createdId && !!(title || body), busy, () => {
    setTitle("");
    setBody("");
    setError("");
  });
  useEffect(() => {
    if (createdId)
      router.replace({
        pathname: "/leagues/[id]/messages/[threadId]",
        params: { id: leagueId, threadId: createdId },
      });
  }, [createdId, leagueId]);
  async function submit() {
    if (submitting.current) return;
    const parsed = createThreadSchema.safeParse({ title, body });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your message.");
      return;
    }
    submitting.current = true;
    if (!(await terms.ensure())) {
      submitting.current = false;
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await request<{ id: string }>(boardPath(leagueId), {
        method: "POST",
        body: parsed.data,
      });
      setTitle("");
      setBody("");
      setMessageNotice(leagueId, "Thread created.");
      announceMessagesChanged();
      setCreatedId(created.id);
    } catch (err) {
      setError(errorOf(err));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={96}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.screen}>
        {header}
        <View style={s.card}>
          <MessageBackLink
            onPress={() => router.replace({ pathname: "/leagues/[id]/messages", params: { id: leagueId } })}
          />
          <Text accessibilityRole="header" style={s.heading}>
            New thread
          </Text>
          <Text style={s.label}>Thread title</Text>
          <TextInput
            accessibilityLabel="Thread title"
            style={s.input}
            placeholder="Thread title"
            placeholderTextColor={colors.mutedForeground}
            value={title}
            maxLength={THREAD_TITLE_MAX}
            onChangeText={setTitle}
            editable={!busy}
          />
          <Text style={s.label}>Message</Text>
          <TextInput
            accessibilityLabel="Message"
            style={[s.input, s.messageInput]}
            placeholder="Start the conversation…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            value={body}
            maxLength={MESSAGE_BODY_MAX}
            onChangeText={setBody}
            editable={!busy}
            textAlignVertical="top"
          />
          <Notice message={error} kind="alert" />
          <Action
            label={busy ? "Posting…" : "Create thread"}
            disabled={busy || !title.trim() || !body.trim()}
            onPress={() => {
              void submit();
            }}
          />
        </View>
      </ScrollView>
      {terms.sheet}
    </KeyboardAvoidingView>
  );
}

function Thread({ leagueId, threadId, header }: { leagueId: string; threadId: string; header?: ReactNode }) {
  const path = threadPath(leagueId, threadId);
  const [thread, setThread] = useState<ThreadDetail>();
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [body, setBody] = useState("");
  const [quote, setQuote] = useState<MessageQuote>();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState(() => takeMessageNotice(leagueId));
  const [replyHeight, setReplyHeight] = useState(44);
  const [deleted, setDeleted] = useState(false);
  const options = useAnchor();
  const terms = useTermsGate();
  // Messages the reader chose to show: a blocked player's, or (for admins) one hidden for review.
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const [reporting, setReporting] = useState<{
    target: ReportTarget;
    subject: string;
    block?: { name: string; userId: string };
  }>();
  // The message whose ⋯ menu is open, and where its button is.
  const [postMenu, setPostMenu] = useState<{ postId: string; anchor: Anchor }>();
  const postMenuButtons = useRef(new Map<string, ComponentRef<typeof View>>());
  const [reactionPost, setReactionPost] = useState<string>();
  // The "Add reaction" button the picker opened from, so it appears beside it as on the web.
  const [reactionAnchor, setReactionAnchor] = useState<Anchor>();
  const addReactionButtons = useRef(new Map<string, ComponentRef<typeof View>>());
  const closeReactions = () => {
    setReactionPost(undefined);
    setReactionAnchor(undefined);
  };
  const [scrollToId, setScrollToId] = useState<string>();
  const positions = useRef(new Map<string, number>());
  const postBodies = useRef(new Map<string, ComponentRef<typeof Text>>());
  const postCards = useRef(new Map<string, ComponentRef<typeof View>>());
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const mutating = useRef(false);
  const loading = useRef(false);
  const sequence = useRef(0);
  const alive = useRef(true);
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sequence.current++;
    };
  }, []);
  useDraftGuard(!deleted && !!(body || quote), !!busy, () => {
    setBody("");
    setQuote(undefined);
    setReplyHeight(44);
    setError("");
  });
  useEffect(() => {
    if (deleted) router.replace({ pathname: "/leagues/[id]/messages", params: { id: leagueId } });
  }, [deleted, leagueId]);
  const refresh = useCallback(async () => {
    if (loading.current || mutating.current) return;
    loading.current = true;
    const attempt = ++sequence.current;
    try {
      const value = await request<ThreadDetail>(path);
      if (alive.current && attempt === sequence.current) {
        setThread(value);
        setError("");
      }
    } catch (err) {
      if (alive.current && attempt === sequence.current) setError(errorOf(err));
    } finally {
      loading.current = false;
    }
  }, [path]);
  useMessageRefresh(() => {
    void refresh();
  }, !!thread);
  const version = thread?.version;
  const markRead = useCallback(async () => {
    if (!version || !focusedRef.current || AppState.currentState !== "active") return;
    try {
      await request(`${path}/read`, { method: "POST", body: { version } });
      if (alive.current) {
        setReadError("");
        announceMessagesChanged();
      }
    } catch (err) {
      if (alive.current) setReadError(errorOf(err));
    }
  }, [path, version]);
  useEffect(() => {
    if (!focused) return;
    void markRead();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void markRead();
    });
    return () => subscription.remove();
  }, [focused, markRead]);
  useEffect(() => {
    if (!scrollToId) return;
    if (Platform.OS === "web") {
      // Bring the original message to the middle of the screen and move focus to it.
      const card = postCards.current.get(scrollToId) as unknown as HTMLElement | undefined;
      card?.scrollIntoView?.({ block: "center" });
      card?.focus?.({ preventScroll: true });
      return;
    }
    const top = positions.current.get(scrollToId);
    if (top !== undefined) {
      scroll.current?.scrollTo({ y: Math.max(0, top - 12), animated: true });
      const target = postBodies.current.get(scrollToId);
      if (target) AccessibilityInfo.sendAccessibilityEvent(target, "focus");
    }
  }, [scrollToId]);

  async function mutate(name: string, action: () => Promise<void>, message?: string) {
    if (mutating.current) return;
    mutating.current = true;
    sequence.current++;
    setBusy(name);
    setNotice("");
    setError("");
    try {
      await action();
      if (alive.current && message) setNotice(message);
    } catch (err) {
      if (alive.current) setError(errorOf(err));
    } finally {
      mutating.current = false;
      if (alive.current) setBusy(undefined);
    }
  }
  async function submitReply() {
    const parsed = replySchema.safeParse({ body, quotedPostId: quote?.id });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your reply.");
      return;
    }
    if (!(await terms.ensure())) return;
    void mutate("reply", async () => {
      await request(`${path}/replies`, { method: "POST", body: parsed.data });
      setBody("");
      setQuote(undefined);
      setReplyHeight(44);
      announceMessagesChanged();
      setNotice("Reply posted.");
      // Refresh failure must not make a successful post look unsent and invite a duplicate reply.
      try {
        setThread(await request<ThreadDetail>(path));
      } catch {
        setNotice("Reply posted. Refresh to see the latest messages.");
      }
    });
  }
  async function toggleReaction(post: MessagePost, emoji: MessageEmoji) {
    setReactionPost(undefined);
    const active = !post.reactions.find((reaction) => reaction.emoji === emoji)?.reacted;
    if (!(await terms.ensure())) return;
    void mutate(`reaction:${post.id}:${emoji}`, async () => {
      const reactions = await request<MessageReaction[]>(`${path}/posts/${post.id}/reactions`, {
        method: "PUT",
        body: { emoji, active },
      });
      setThread(
        (previous) =>
          previous && {
            ...previous,
            posts: previous.posts.map((value) => (value.id === post.id ? { ...value, reactions } : value)),
          },
      );
    });
  }
  function pin() {
    options.close();
    if (!thread) return;
    const pinned = !thread.pinned;
    void mutate(
      "pin",
      async () => {
        const value = await request<{ pinned: boolean }>(`${path}/pin`, { method: "PUT", body: { pinned } });
        setThread((previous) => previous && { ...previous, pinned: value.pinned });
      },
      pinned ? "Announcement pinned." : "Announcement unpinned.",
    );
  }
  async function deleteThread() {
    if (!thread || busy) return;
    options.close();
    if (
      !(await showConfirm({
        title: `Delete “${thread.title}”?`,
        message:
          "This permanently deletes the thread, all replies and reactions, and any unsent reply. This can't be undone.",
        confirmLabel: "Delete thread",
        destructive: true,
      }))
    )
      return;
    void mutate("delete", async () => {
      await request(path, { method: "DELETE" });
      setMessageNotice(leagueId, "Thread deleted.");
      announceMessagesChanged();
      setDeleted(true);
    });
  }
  /** Blocks or unblocks a message's author, then reloads the thread so their messages fold or unfold. */
  async function block(post: MessagePost, blocked: boolean) {
    if (
      blocked &&
      !(await showConfirm({
        title: `Block ${post.authorName}?`,
        message:
          "Their threads, replies and reactions are hidden from you everywhere, and you won't be notified about their threads. Picks and standings don't change, and they aren't told.",
        confirmLabel: `Block ${post.authorName}`,
        destructive: true,
      }))
    )
      return;
    void mutate(
      "block",
      async () => {
        await setBlocked(post.authorId, blocked);
        setThread(await request<ThreadDetail>(path));
      },
      blocked ? `${post.authorName} is blocked.` : `${post.authorName} is unblocked.`,
    );
  }
  async function moderate(post: MessagePost, action: "remove" | "restore") {
    if (
      action === "remove" &&
      !(await showConfirm({
        title: `Remove ${post.authorName}'s message?`,
        message:
          post.position === 1
            ? "This is the thread's first message, so the whole thread leaves the board. It counts against the author, who can ask for a review."
            : "Everyone sees “Message removed” in its place. It counts against the author, who can ask for a review.",
        confirmLabel: "Remove message",
        destructive: true,
      }))
    )
      return;
    void mutate(
      action,
      async () => {
        await request(`${path}/posts/${post.id}/moderation`, { method: "PUT", body: { action } });
        announceMessagesChanged();
        if (action === "remove" && post.position === 1) {
          setMessageNotice(leagueId, "Thread removed.");
          setDeleted(true);
          return;
        }
        setThread(await request<ThreadDetail>(path));
      },
      action === "remove" ? "Message removed." : "Message restored.",
    );
  }
  async function appeal(post: MessagePost) {
    if (
      !(await showConfirm({
        title: "Ask for a review?",
        message:
          "The people who run POW Pick'em will look at this message again and put it back if it shouldn't have been removed. You can ask once.",
        confirmLabel: "Ask for a review",
      }))
    )
      return;
    void mutate(
      "appeal",
      async () => {
        await request(`${path}/posts/${post.id}/appeal`, { method: "POST", body: {} });
        setThread(await request<ThreadDetail>(path));
      },
      "Thanks. We'll take another look.",
    );
  }
  const menuPost = thread?.posts.find((post) => post.id === postMenu?.postId);
  const selectedPost = thread?.posts.find((post) => post.id === reactionPost);
  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={96}
    >
      <ScrollView ref={scroll} contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
        {header}
        <MessageBackLink
          onPress={() => router.replace({ pathname: "/leagues/[id]/messages", params: { id: leagueId } })}
        />
        {!thread && !error && <LoadingMessages thread />}
        {!!error && !thread && (
          <Failure
            error={error}
            retry={() => {
              void refresh();
            }}
          />
        )}
        {thread && (
          <>
            <View style={[s.row, { alignItems: "flex-start" }]}>
              <View style={[s.flex, s.stack]}>
                {thread.pinned && <PinnedBadge />}
                <Text accessibilityRole="header" style={s.heading}>
                  {thread.title}
                </Text>
              </View>
              {(thread.canPin || thread.canDelete) && (
                <Pressable
                  ref={options.ref}
                  accessibilityRole="button"
                  accessibilityLabel={busy === "delete" ? "Deleting…" : `Options for ${thread.title}`}
                  disabled={!!busy}
                  style={s.iconButton}
                  onPress={options.open}
                >
                  {busy === "delete" ? (
                    <Text style={s.meta}>Deleting…</Text>
                  ) : (
                    <Icon name="more" size={24} color={colors.mutedForeground} />
                  )}
                </Pressable>
              )}
            </View>
            {!!readError && (
              <View style={s.card}>
                <Text accessibilityRole="alert" style={s.error}>
                  Could not mark this thread read: {readError}
                </Text>
                <Action
                  secondary
                  label="Try marking read again"
                  onPress={() => {
                    void markRead();
                  }}
                />
              </View>
            )}
            {thread.posts.map((post) => {
              const placeholder = postPlaceholder(post.state, revealed.has(post.id), thread.canModerate);
              // Removed and hidden messages take no reactions or quotes; a blocked player's do once shown.
              const interactive = !placeholder && post.state !== "removed" && post.state !== "hidden";
              const actions = postActions(post, {
                canModerate: thread.canModerate,
                blockedAuthor: post.state === "blocked",
              });
              return (
                <View
                  key={post.id}
                  style={[s.card, scrollToId === post.id && s.highlight]}
                  ref={(node) => {
                    if (node) postCards.current.set(post.id, node);
                    else postCards.current.delete(post.id);
                  }}
                  onLayout={(event) => {
                    positions.current.set(post.id, event.nativeEvent.layout.y);
                  }}
                  role="region"
                  aria-label={`Message ${post.position} by ${post.authorName}`}
                  // Focusable on the web, so "View original" can move focus to it.
                  tabIndex={Platform.OS === "web" ? -1 : undefined}
                >
                  <View style={s.postHeader}>
                    <Avatar name={post.authorName} />
                    <Text style={s.author}>{post.authorName}</Text>
                    <MessageTimestamp value={post.createdAt} now={clockNow()} />
                    {actions.length > 0 && (
                      <Pressable
                        ref={(node) => {
                          if (node) postMenuButtons.current.set(post.id, node);
                          else postMenuButtons.current.delete(post.id);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Options for message ${post.position} by ${post.authorName}`}
                        disabled={!!busy}
                        style={[s.iconButton, { marginLeft: "auto", marginVertical: -8 }]}
                        onPress={() =>
                          postMenuButtons.current
                            .get(post.id)
                            ?.measureInWindow((x, y, width, height) =>
                              setPostMenu({ postId: post.id, anchor: { x, y, width, height } }),
                            )
                        }
                      >
                        <Icon name="more" size={20} color={colors.mutedForeground} />
                      </Pressable>
                    )}
                  </View>
                  {post.state === "review" && <Badge>Under review</Badge>}
                  {placeholder ? (
                    <View style={s.placeholder}>
                      <Text
                        ref={(node) => {
                          if (node) postBodies.current.set(post.id, node);
                          else postBodies.current.delete(post.id);
                        }}
                        style={s.placeholderText}
                      >
                        {placeholder.text}
                      </Text>
                      {placeholder.canShow && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Show message ${post.position} by ${post.authorName}`}
                          style={s.quoteReply}
                          onPress={() => setRevealed((previous) => new Set(previous).add(post.id))}
                        >
                          <Icon name="eye" size={16} color={colors.mutedForeground} />
                          <Text style={s.quoteReplyText}>Show</Text>
                        </Pressable>
                      )}
                    </View>
                  ) : (
                    <>
                      {post.quote && (
                        <QuotedMessage
                          quote={post.quote}
                          onOriginal={() => {
                            setScrollToId(undefined);
                            requestAnimationFrame(() => setScrollToId(post.quote?.id));
                          }}
                        />
                      )}
                      <Text
                        selectable
                        ref={(node) => {
                          if (node) postBodies.current.set(post.id, node);
                          else postBodies.current.delete(post.id);
                        }}
                        accessibilityLabel={`Message ${post.position} by ${post.authorName}: ${post.body}`}
                        style={s.text}
                      >
                        {post.body}
                      </Text>
                    </>
                  )}
                  {interactive && (
                    <View style={s.postActions}>
                      <View role="group" aria-label="Message reactions" style={s.reactions}>
                        {MESSAGE_REACTIONS.flatMap(({ emoji }) => {
                          const reaction = post.reactions.find((value) => value.emoji === emoji);
                          return reaction && reaction.count > 0 ? [reaction] : [];
                        }).map((reaction) => (
                          <Pressable
                            key={reaction.emoji}
                            disabled={!!busy || !!thread.postingBlocked}
                            accessibilityRole="button"
                            accessibilityLabel={`${MESSAGE_REACTIONS.find((value) => value.emoji === reaction.emoji)?.label ?? reaction.emoji}, ${reaction.count} reactions`}
                            // A toggle: pressed while it is your reaction.
                            aria-pressed={reaction.reacted}
                            accessibilityState={{ disabled: !!busy || !!thread.postingBlocked }}
                            onPress={() => void toggleReaction(post, reaction.emoji)}
                            style={s.reactionTarget}
                          >
                            <View style={[s.reactionPill, reaction.reacted && s.selected]}>
                              <Text style={s.reactionEmoji}>{reaction.emoji}</Text>
                              <Text style={[s.reactionCount, reaction.reacted && s.text]}>
                                {busy === `reaction:${post.id}:${reaction.emoji}`
                                  ? "Saving…"
                                  : reaction.count}
                              </Text>
                            </View>
                          </Pressable>
                        ))}
                        {!thread.postingBlocked && (
                          <Pressable
                            ref={(node) => {
                              if (node) addReactionButtons.current.set(post.id, node);
                              else addReactionButtons.current.delete(post.id);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Add reaction"
                            disabled={!!busy}
                            style={s.reactionTarget}
                            onPress={() =>
                              addReactionButtons.current
                                .get(post.id)
                                ?.measureInWindow((x, y, width, height) => {
                                  setReactionAnchor({ x, y, width, height });
                                  setReactionPost(post.id);
                                })
                            }
                          >
                            <View style={s.reactionPill}>
                              <Icon name="smile" size={20} color={colors.mutedForeground} />
                              <Icon name="plus" size={12} color={colors.mutedForeground} />
                            </View>
                          </Pressable>
                        )}
                      </View>
                      {!thread.postingBlocked && (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Quote message ${post.position} by ${post.authorName}`}
                          disabled={!!busy}
                          style={s.quoteReply}
                          onPress={() => {
                            setQuote({ id: post.id, authorName: post.authorName, body: post.body });
                            input.current?.focus();
                          }}
                        >
                          <Icon name="quote" size={16} color={colors.mutedForeground} />
                          <Text style={s.quoteReplyText}>Quote reply</Text>
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
      {thread && !deleted && thread.postingBlocked && (
        <View style={s.composer}>
          <View role="status" style={s.blockedNotice}>
            <Icon name="mute" size={18} color={colors.mutedForeground} />
            <Text style={[s.meta, s.flex]}>
              {thread.postingBlocked} You can still read, pick and see standings.
            </Text>
          </View>
          <Notice message={error} kind="alert" />
          <Notice message={notice} />
        </View>
      )}
      {thread && !deleted && !thread.postingBlocked && (
        <View style={s.composer}>
          {quote && (
            <View role="region" aria-label="Reply quote preview" style={s.quotePreview}>
              <Icon name="quote" size={16} color={colors.primary} />
              <Text style={[s.meta, s.flex]} numberOfLines={1}>
                <Text style={s.author}>{quote.authorName} wrote: </Text>
                {quote.body}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove quote"
                disabled={!!busy}
                style={s.iconButton}
                onPress={() => setQuote(undefined)}
              >
                <Icon name="close" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
          )}
          <View style={s.replyRow}>
            <TextInput
              ref={input}
              accessibilityLabel="Reply"
              placeholder="Write a reply…"
              placeholderTextColor={colors.mutedForeground}
              selectionColor={colors.primary}
              style={[s.input, s.replyInput, { height: replyHeight }]}
              multiline
              maxLength={MESSAGE_BODY_MAX}
              value={body}
              onChangeText={setBody}
              editable={!busy}
              onContentSizeChange={(event) =>
                setReplyHeight(Math.max(44, Math.min(160, event.nativeEvent.contentSize.height)))
              }
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={busy === "reply" ? "Posting…" : "Post reply"}
              accessibilityState={{ disabled: !!busy || !body.trim() }}
              disabled={!!busy || !body.trim()}
              style={[s.sendButton, (!!busy || !body.trim()) && s.disabled]}
              onPress={() => void submitReply()}
            >
              <Icon name="send" size={20} color={colors.primaryForeground} filled />
            </Pressable>
          </View>
          <Notice message={error} kind="alert" />
          <Notice message={notice} />
        </View>
      )}
      <Menu anchor={options.anchor} onClose={options.close} label="Thread options" align="end">
        {thread?.canPin && (
          <MenuItem
            icon="pin"
            label={thread.pinned ? "Unpin announcement" : "Pin announcement"}
            onPress={pin}
          />
        )}
        {thread?.canDelete && (
          <MenuItem
            icon="trash"
            destructive
            label="Delete thread"
            onPress={() => {
              void deleteThread();
            }}
          />
        )}
      </Menu>
      <Menu
        anchor={menuPost ? postMenu?.anchor : undefined}
        onClose={() => setPostMenu(undefined)}
        label={
          menuPost ? `Options for message ${menuPost.position} by ${menuPost.authorName}` : "Message options"
        }
        align="end"
      >
        {menuPost &&
          postActions(menuPost, {
            canModerate: !!thread?.canModerate,
            blockedAuthor: menuPost.state === "blocked",
          }).map((action) => {
            const close = () => setPostMenu(undefined);
            const name = menuPost.authorName;
            if (action === "report")
              return (
                <MenuItem
                  key={action}
                  icon="flag"
                  label="Report"
                  accessibilityLabel={`Report message from ${name}`}
                  onPress={() => {
                    close();
                    setReporting({
                      target: { kind: "post", leagueId, threadId, postId: menuPost.id },
                      subject: `a message from ${name}`,
                      ...(menuPost.state !== "blocked" && { block: { name, userId: menuPost.authorId } }),
                    });
                  }}
                />
              );
            if (action === "block" || action === "unblock")
              return (
                <MenuItem
                  key={action}
                  icon="block"
                  destructive={action === "block"}
                  label={action === "block" ? `Block ${name}` : `Unblock ${name}`}
                  onPress={() => {
                    close();
                    void block(menuPost, action === "block");
                  }}
                />
              );
            if (action === "remove" || action === "restore")
              return (
                <MenuItem
                  key={action}
                  icon={action === "remove" ? "trash" : "restore"}
                  destructive={action === "remove"}
                  label={action === "remove" ? "Remove message" : "Restore message"}
                  accessibilityLabel={`${action === "remove" ? "Remove" : "Restore"} message from ${name}`}
                  onPress={() => {
                    close();
                    void moderate(menuPost, action);
                  }}
                />
              );
            return (
              <MenuItem
                key={action}
                icon="restore"
                label="Ask for a review"
                onPress={() => {
                  close();
                  void appeal(menuPost);
                }}
              />
            );
          })}
      </Menu>
      <ReportSheet
        target={reporting?.target ?? null}
        subject={reporting?.subject ?? ""}
        onClose={() => setReporting(undefined)}
        onReported={() => void refresh()}
        onBlock={
          reporting?.block && {
            name: reporting.block.name,
            run: async () => {
              const blocked = reporting.block;
              if (!blocked) return;
              await setBlocked(blocked.userId, true);
              setThread(await request<ThreadDetail>(path));
            },
          }
        }
      />
      {terms.sheet}
      <Popover
        anchor={selectedPost ? reactionAnchor : undefined}
        onClose={closeReactions}
        label="Add reaction"
      >
        {selectedPost && (
          <View style={s.reactionPicker}>
            {MESSAGE_REACTIONS.map((reaction) => {
              const selected = !!selectedPost.reactions.find((value) => value.emoji === reaction.emoji)
                ?.reacted;
              return (
                <Pressable
                  key={reaction.emoji}
                  // The menu role on the web; React Native's types lack it, but react-native-web passes it through.
                  role={(Platform.OS === "web" ? "menuitemcheckbox" : "checkbox") as "checkbox"}
                  accessibilityLabel={reaction.label}
                  accessibilityState={{ checked: selected }}
                  style={({ pressed }) => [
                    s.reactionChoice,
                    selected && s.choiceSelected,
                    pressed && { backgroundColor: colors.raised },
                  ]}
                  onPress={() => {
                    // Choosing closes the menu, as on the web.
                    closeReactions();
                    void toggleReaction(selectedPost, reaction.emoji);
                  }}
                >
                  <Text style={s.emoji}>{reaction.emoji}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </Popover>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    padding: 16,
    paddingTop: 20,
    paddingBottom: 28,
    gap: 12,
    backgroundColor: colors.background,
    flexGrow: 1,
    width: "100%",
    maxWidth: 896,
    alignSelf: "center",
  },
  stack: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  card: { padding: 16, borderRadius: 16, backgroundColor: colors.card, gap: 12 },
  boardHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  newThread: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  heading: {
    textTransform: "uppercase",
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 29,
    color: colors.foreground,
  },
  threadTitle: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.foreground },
  text: { fontFamily: fonts.body, color: colors.foreground, fontSize: 16, lineHeight: 23 },
  author: {
    fontFamily: fonts.semibold,
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },
  meta: { fontFamily: fonts.body, color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.medium, color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  error: { fontFamily: fonts.body, color: colors.destructive, fontSize: 14, lineHeight: 20 },
  notice: { fontFamily: fonts.body, color: colors.foreground, fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    padding: 12,
    paddingVertical: 10,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
    backgroundColor: `${colors.background}99`,
    borderColor: colors.input,
    borderWidth: 1,
    color: colors.foreground,
  },
  messageInput: { minHeight: 128 },
  replyInput: { minHeight: 44, maxHeight: 160, borderRadius: 22, flex: 1, paddingHorizontal: 14 },
  button: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 11,
    justifyContent: "center",
    alignItems: "center",
  },
  secondary: { backgroundColor: colors.raised },
  buttonText: { fontFamily: fonts.semibold, color: colors.primaryForeground, fontSize: 14, lineHeight: 20 },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 8,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 22,
  },
  postHeader: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  postActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginVertical: -6 },
  reactions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  reactionTarget: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  reactionPill: {
    minHeight: 30,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.secondary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  reactionEmoji: { fontSize: 16, lineHeight: 20 },
  reactionCount: { fontFamily: fonts.medium, fontSize: 12, color: colors.mutedForeground },
  selected: { borderColor: `${colors.primary}b3`, backgroundColor: `${colors.primary}33` },
  quoteReply: {
    marginLeft: "auto",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  quoteReplyText: { fontFamily: fonts.medium, fontSize: 14, color: colors.mutedForeground },
  highlight: { backgroundColor: colors.raised },
  placeholder: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  placeholderText: {
    fontFamily: fonts.body,
    fontStyle: "italic",
    color: colors.mutedForeground,
    fontSize: 16,
    lineHeight: 23,
  },
  blockedNotice: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  composer: {
    width: "100%",
    maxWidth: 896,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: colors.chrome,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  quotePreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    backgroundColor: colors.raised,
    paddingLeft: 12,
    paddingRight: 2,
  },
  replyRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  skeleton: { height: 18, borderRadius: 6, backgroundColor: colors.raised },
  reactionPicker: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 2,
  },
  reactionChoice: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  choiceSelected: { backgroundColor: `${colors.primary}40` },
  emoji: { fontSize: 24, lineHeight: 30 },
});
