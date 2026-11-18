import {
  createThreadSchema,
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
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { type ComponentRef, Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AutoGrowInput } from "../components/AutoGrowInput";
import { Avatar } from "../components/Avatar";
import { FadeIn } from "../components/FadeIn";
import { Icon, type IconName } from "../components/Icon";
import {
  BoardRows,
  MessageBackLink,
  MessageBody,
  MessageTimestamp,
  PinnedBadge,
  QuotedMessage,
} from "../components/MessageParts";
import { ReportSheet, type ReportTarget, setBlocked, useTermsGate } from "../components/Moderation";
import { type Anchor, Menu, MenuItem, Popover, useAnchor } from "../components/Popover";
import { hoverFill, pressFade, pressState } from "../components/pressState";
import { SkeletonBlock } from "../components/SkeletonBlock";
import { corner, elevation, layout, radius, space, tabular, type, widths } from "../components/theme";
import { Badge, colors, fonts, Notice, Title } from "../components/ui";
import { request, statusOf } from "../lib/api";
import { now as clockNow } from "../lib/clock";
import { showConfirm } from "../lib/dialogs";
import { fieldDefaults } from "../lib/fieldProps";
import { haptics } from "../lib/haptics";
import { readLoadCache, writeLoadCache } from "../lib/loadCache";
import {
  counted,
  groupsWithPrevious,
  postShortcut,
  type ThreadArrival,
  threadArrival,
  toggledReactions,
} from "../lib/messagePresentation";
import {
  announceMessagesChanged,
  postingBlockedIn,
  setPostingBlocked,
  setUnreadThreads,
  subscribeMessagesChanged,
} from "../lib/messageUnread";
import { postActions, postPlaceholder } from "../lib/moderation";
import { webTransition } from "../lib/motion";
import { notifyDone, notifyError } from "../lib/notify";
import { usePageTitle } from "../lib/pageTitle";
import { usePullRefresh } from "../lib/pullRefresh";
import { useScrollRestore } from "../lib/scrollRestore";
import { useRemovalGuard, useUnsavedWork } from "../lib/unsaved";
import { LeagueFrame } from "./LeagueChrome";
import { useLeagueShell } from "./leagueContext";
import { Action, EmptyState, Failure } from "./leagueUi";

const errorOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong. Try again.";
const boardPath = (leagueId: string) => `/leagues/${encodeURIComponent(leagueId)}/messages`;
const threadPath = (leagueId: string, threadId: string) =>
  `${boardPath(leagueId)}/${encodeURIComponent(threadId)}`;
/**
 * Leaves a thread (or the New thread form) for its board: back down to the board when it is under this screen,
 * in this screen's place otherwise, so the board is never in the history twice. An unsaved draft asks first
 * (the screen's removal guard).
 */
const backToBoard = (leagueId: string) =>
  router.dismissTo({ pathname: "/leagues/[id]/messages", params: { id: leagueId } });
/** The app's header above every screen: the status bar's inset, its 56px row and a hairline (`AppHeader`). */
const APP_HEADER_HEIGHT = 57;
/** Tabs move from the bottom bar to a row under the league's name from this width (`LeagueTabBar`). */
const WIDE = 768;

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

/** The offset that keeps a screen's bottom edge above the iPhone keyboard: everything above the screen. */
function useKeyboardOffset() {
  return useSafeAreaInsets().top + APP_HEADER_HEIGHT;
}

/** The shape of the board (rows in a card) or a thread (a topic card, then replies) while it loads. */
function LoadingMessages({ thread = false }: { thread?: boolean }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={thread ? "Loading thread" : "Loading messages"}
      accessibilityState={{ busy: true }}
      style={thread ? s.posts : s.loadingBoard}
    >
      {thread && (
        <View style={[s.topic, s.loadingPost]}>
          <SkeletonBlock width={32} height={32} radius={radius.full} />
          <View style={s.loadingLines}>
            <SkeletonBlock width="35%" height={14} />
            <SkeletonBlock width="90%" height={16} />
            <SkeletonBlock width="70%" height={16} />
          </View>
        </View>
      )}
      {[0, 1, 2].map((key) => (
        <View key={key} style={[thread ? s.reply : s.loadingRow, s.loadingPost]}>
          <SkeletonBlock width={32} height={32} radius={radius.full} />
          <View style={s.loadingLines}>
            <SkeletonBlock width={thread ? "30%" : "60%"} height={14} />
            <SkeletonBlock width={thread ? "75%" : "35%"} height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** The icon beside what stands in for a message's text. */
function placeholderIcon(state: MessagePost["state"]): IconName {
  if (state === "blocked") return "block";
  if (state === "hidden") return "eye";
  return "trash";
}

/** The browser's platform ("MacIntel", "Win32"), to name the right shortcut key. */
function browserPlatform(): string | undefined {
  const nav = (globalThis as { navigator?: { platform?: string; userAgent?: string } }).navigator;
  return nav?.platform || nav?.userAgent;
}

/** Why the player can't post right now, where the form or reply box would be. */
function PostingBlocked({ reason }: { reason: string }) {
  return (
    <View role="status" style={s.blockedNotice}>
      <Icon name="mute" size={18} color={colors.mutedForeground} />
      <Text style={[s.meta, s.flex]}>{reason} You can still read, pick and see standings.</Text>
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

/**
 * A thread (or the New thread form) in the Messages tab's stack (`app/leagues/[id]/messages/`), with the league
 * the tabs already loaded (`LeagueShell`); the league's tab bar is the tab navigator's, below.
 */
function StandaloneMessages({ leagueId, threadId }: { leagueId: string; threadId: string }) {
  const shell = useLeagueShell();
  const league = shell.detail;
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
      if (active.current && generation === latest.current) {
        setUnreadThreads(leagueId, page.unreadCount);
        setPostingBlocked(leagueId, page.postingBlocked);
      }
    } catch {
      /* The board's retry state handles errors; an unread badge must never block a thread. */
    }
  }, [leagueId]);
  useMessageRefresh(() => {
    void refreshUnread();
  }, true);
  useEffect(
    () =>
      subscribeMessagesChanged(() => {
        void refreshUnread();
      }),
    [refreshUnread],
  );
  // Like every league screen: tabs in a row under the league name on wide screens, a bottom bar on phones.
  const wide = useWindowDimensions().width >= WIDE;
  const isNew = threadId === "new";
  // On a phone a thread keeps one slim bar of its own (back, title, options) in place of the league's header,
  // which would take a third of the screen before the first message.
  const compact = !wide && !isNew;
  const header = compact ? null : (
    // The same frame as the league's own tabs, so nothing moves between board and thread.
    <LeagueFrame
      leagueId={leagueId}
      leagueName={league.name}
      type={league.type}
      active="messages"
      unreadCount={shell.unreadCount}
      reportsWaiting={league.openReports ?? 0}
    />
  );
  return (
    <View style={s.flex}>
      {isNew ? (
        <NewThread leagueId={leagueId} leagueName={league.name} header={header} />
      ) : (
        <Thread
          leagueId={leagueId}
          leagueName={league.name}
          threadId={threadId}
          header={header}
          compact={compact}
          settled
        />
      )}
    </View>
  );
}

/** The board as it was last shown, so coming back from a thread shows it at once, older pages included. */
type BoardMemory = { page: ThreadPage; older?: { threads: MessageThread[]; nextCursor: string | null } };
const boardMemoryKey = (leagueId: string) => `message-board:${leagueId}`;
/** Keeps the remembered board true to what just happened in a thread (read, deleted), until it reloads. */
function updateBoardMemory(leagueId: string, change: (threads: MessageThread[]) => MessageThread[]) {
  const key = boardMemoryKey(leagueId);
  const memory = readLoadCache<BoardMemory>(key);
  if (!memory) return;
  writeLoadCache(key, {
    page: { ...memory.page, threads: change(memory.page.threads) },
    older: memory.older && { ...memory.older, threads: change(memory.older.threads) },
  } satisfies BoardMemory);
}

function Board({ leagueId, header }: { leagueId: string; header?: ReactNode }) {
  const remembered = useRef(readLoadCache<BoardMemory>(boardMemoryKey(leagueId))).current;
  const [page, setPage] = useState<ThreadPage | undefined>(remembered?.page);
  const [older, setOlder] = useState(remembered?.older);
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
  useEffect(() => {
    if (page) writeLoadCache(boardMemoryKey(leagueId), { page, older } satisfies BoardMemory);
  }, [leagueId, page, older]);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      const value = await request<ThreadPage>(`${boardPath(leagueId)}?limit=${THREAD_PAGE_SIZE}`);
      setUnreadThreads(leagueId, value.unreadCount);
      setPostingBlocked(leagueId, value.postingBlocked);
      if (alive.current) {
        setPage(value);
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
  const pull = usePullRefresh(refresh);
  const scrollRef = useScrollRestore();
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
    <ScrollView
      ref={scrollRef}
      contentContainerStyle={s.screen}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl {...pull} tintColor={colors.foreground} />}
    >
      {header}
      <View style={s.boardHeading}>
        <Title>Message board</Title>
        {/* While the board is empty, its empty state offers the one New thread. */}
        {!!page && threads.length > 0 && !page.postingBlocked && (
          <Action href={threadPath(leagueId, "new")} icon="plus" compact>
            New thread
          </Action>
        )}
      </View>
      {!!page?.postingBlocked && <PostingBlocked reason={page.postingBlocked} />}
      <Failure
        message={error}
        retry={() => {
          void refresh();
        }}
      />
      {!page && !error && <LoadingMessages />}
      {page && threads.length === 0 && (
        <EmptyState
          icon="chat"
          title="No threads yet"
          detail="Start one and everyone in the league hears about it."
          action={
            !page.postingBlocked && (
              <Action href={threadPath(leagueId, "new")} icon="plus" compact style={{ alignSelf: "center" }}>
                New thread
              </Action>
            )
          }
        />
      )}
      <BoardRows threads={threads} now={clockNow()} hrefOf={(id) => threadPath(leagueId, id)} />
      {cursor && (
        <Action
          secondary
          busy={loadingOlder}
          onPress={() => {
            void loadOlder();
          }}
        >
          {loadingOlder ? "Loading…" : "Load older threads"}
        </Action>
      )}
    </ScrollView>
  );
}

function NewThread({
  leagueId,
  leagueName,
  header,
}: {
  leagueId: string;
  leagueName?: string;
  header?: ReactNode;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string>();
  // What the board last said about a mute or suspension, checked again here for a page opened by its address.
  const [blocked, setBlockedReason] = useState(() => postingBlockedIn(leagueId));
  const submitting = useRef(false);
  const bodyInput = useRef<ComponentRef<typeof TextInput>>(null);
  const terms = useTermsGate();
  const keyboardOffset = useKeyboardOffset();
  // A keyboard is at hand on a wide screen, so start in the title; on a phone that would pop the keyboard
  // over the page before the player has seen it.
  const { width } = useWindowDimensions();
  const startInTitle = useRef(width >= WIDE).current;
  usePageTitle(leagueName ? `New thread · ${leagueName}` : undefined);
  useDraftGuard(!createdId && !!(title || body), busy, () => {
    setTitle("");
    setBody("");
    setError("");
  });
  useEffect(() => {
    let active = true;
    request<ThreadPage>(`${boardPath(leagueId)}?limit=1`).then(
      (page) => {
        setPostingBlocked(leagueId, page.postingBlocked);
        if (active && page.postingBlocked !== undefined) setBlockedReason(page.postingBlocked);
      },
      () => {
        /* Posting says why it was refused; this check only saves the typing. */
      },
    );
    return () => {
      active = false;
    };
  }, [leagueId]);
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
      notifyDone("Thread created.");
      announceMessagesChanged();
      setCreatedId(created.id);
    } catch (err) {
      // The form's own problem (too fast, refused by the rules) stays beside the form, with the draft.
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
      keyboardVerticalOffset={keyboardOffset}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={s.screen}
      >
        {header}
        <View style={s.column}>
          <MessageBackLink href={boardPath(leagueId)} onPress={() => backToBoard(leagueId)} />
          <Title>New thread</Title>
        </View>
        <View style={[s.card, s.column]}>
          {blocked ? (
            <PostingBlocked reason={blocked} />
          ) : (
            <>
              <Text style={s.label}>Thread title</Text>
              <TextInput
                accessibilityLabel="Thread title"
                style={s.input}
                placeholder="Thread title"
                placeholderTextColor={colors.mutedForeground}
                selectionColor={colors.primary}
                value={title}
                maxLength={THREAD_TITLE_MAX}
                onChangeText={setTitle}
                editable={!busy}
                autoFocus={startInTitle}
                enterKeyHint="next"
                onSubmitEditing={() => bodyInput.current?.focus()}
                {...fieldDefaults({ submits: true, enterKeyHint: "next" }, Platform.OS === "web")}
              />
              <Text style={s.label}>Message</Text>
              <AutoGrowInput
                ref={bodyInput}
                accessibilityLabel="Message"
                style={s.input}
                focusedStyle={s.inputFocused}
                minHeight={128}
                maxHeight={320}
                placeholder="Start the conversation…"
                placeholderTextColor={colors.mutedForeground}
                selectionColor={colors.primary}
                value={body}
                maxLength={MESSAGE_BODY_MAX}
                onChangeText={setBody}
                editable={!busy}
                textAlignVertical="top"
                onSubmit={() => void submit()}
              />
              <Notice message={error} kind="alert" />
              <Action
                busy={busy}
                disabled={!title.trim() || !body.trim()}
                onPress={() => {
                  void submit();
                }}
              >
                {busy ? "Posting…" : "Create thread"}
              </Action>
            </>
          )}
        </View>
      </ScrollView>
      {terms.sheet}
    </KeyboardAvoidingView>
  );
}

/** Says a result to screen readers without drawing it: for an outcome the screen already shows. */
function useAnnouncement() {
  const [text, setText] = useState("");
  const say = useCallback((message: string) => {
    if (Platform.OS !== "web") return AccessibilityInfo.announceForAccessibility(message);
    // Emptied first, so saying the same thing twice is announced twice.
    setText("");
    requestAnimationFrame(() => setText(message));
  }, []);
  const region =
    Platform.OS === "web" ? (
      <Text role="status" aria-live="polite" style={s.announcement}>
        {text}
      </Text>
    ) : null;
  return { say, region };
}

/** On the web, pressing what is inside doesn't take the keyboard focus (the reply box keeps it while sending). */
const keepsFocus =
  Platform.OS === "web"
    ? ({ onMouseDown: (event: { preventDefault: () => void }) => event.preventDefault() } as object)
    : null;

function Thread({
  leagueId,
  leagueName,
  threadId,
  header,
  compact = false,
  settled = true,
}: {
  leagueId: string;
  leagueName?: string;
  threadId: string;
  header?: ReactNode;
  /** A phone: one slim bar (back, title, options) stays above the messages. */
  compact?: boolean;
  /** Everything above the messages has its final height, so the thread can scroll to where it opens. */
  settled?: boolean;
}) {
  const path = threadPath(leagueId, threadId);
  const [thread, setThread] = useState<ThreadDetail>();
  const [loadError, setLoadError] = useState("");
  const [missing, setMissing] = useState(false);
  // The reply box's own problem: shown beside it, with the draft.
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [body, setBody] = useState("");
  const [quote, setQuote] = useState<MessageQuote>();
  const [busy, setBusy] = useState<string>();
  const [deleted, setDeleted] = useState(false);
  const options = useAnchor();
  const terms = useTermsGate();
  const announcement = useAnnouncement();
  const keyboardOffset = useKeyboardOffset();
  const wide = useWindowDimensions().width >= WIDE;
  // A keyboard is at hand on a wide screen in a browser: the reply box says how it posts.
  const shortcutHint = wide && Platform.OS === "web";
  // A link to one message (`?post=<id>`, from a report or a quote opened in a new tab) lands on it.
  const linkedPost = useLocalSearchParams<{ post?: string }>().post;
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
  // Where the thread opened (decided once, from the first load): its first unread reply keeps a "New" line.
  const [arrival, setArrival] = useState<ThreadArrival>();
  const landing = useRef<ThreadArrival | undefined>(undefined);
  // Replies that arrived below while the reader was further up.
  const [newBelow, setNewBelow] = useState<string>();
  const postCount = useRef(0);
  const nearEnd = useRef(true);
  const followEnd = useRef(false);
  // Each message's top within the messages' column, and the column's top in the scroll view (iPhone).
  const positions = useRef(new Map<string, number>());
  const postsTop = useRef<number | undefined>(undefined);
  /** Where a message starts in the scroll view, once both it and the column are laid out. */
  const postTop = useCallback((postId: string) => {
    const top = positions.current.get(postId);
    return top === undefined || postsTop.current === undefined ? undefined : postsTop.current + top;
  }, []);
  const postBodies = useRef(new Map<string, ComponentRef<typeof Text>>());
  const postCards = useRef(new Map<string, ComponentRef<typeof View>>());
  const unreadLine = useRef<ComponentRef<typeof View>>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const mutating = useRef(false);
  // Messages whose reaction change is on its way: one at a time per message, so two quick taps can't cross.
  const reacting = useRef(new Set<string>());
  const latestThread = useRef(thread);
  latestThread.current = thread;
  // The messages the thread opened with: any later one (a reply posted or arrived) fades in.
  const firstPosts = useRef<ReadonlySet<string> | undefined>(undefined);
  // Set once the thread has drawn: a reaction chip that appears after that fades in.
  const drawn = useRef(false);
  useEffect(() => {
    if (thread) drawn.current = true;
  }, [thread]);
  const loading = useRef(false);
  const sequence = useRef(0);
  const alive = useRef(true);
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  usePageTitle(thread ? [thread.title, leagueName].filter(Boolean).join(" · ") : undefined);
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
    setError("");
  });
  useEffect(() => {
    if (!deleted) return;
    updateBoardMemory(leagueId, (threads) => threads.filter((value) => value.id !== threadId));
    backToBoard(leagueId);
  }, [deleted, leagueId, threadId]);
  /** Shows a freshly loaded thread, deciding where it opens the first time and noticing replies since. */
  const show = useCallback(
    (value: ThreadDetail, mine = false) => {
      const before = postCount.current;
      postCount.current = value.posts.length;
      if (!before) {
        firstPosts.current ??= new Set(value.posts.map((post) => post.id));
        const where = threadArrival(value, linkedPost);
        landing.current = where;
        setArrival(where);
        if (where.at === "post" && where.reason === "linked") setScrollToId(where.postId);
      } else if (value.posts.length > before) {
        // The reader's own reply, or one that arrived while they were at the end: stay with the latest.
        if (mine || nearEnd.current) followEnd.current = true;
        else setNewBelow((current) => current ?? value.posts[before]?.id);
      }
      setThread(value);
    },
    [linkedPost],
  );
  const refresh = useCallback(async () => {
    if (loading.current || mutating.current || reacting.current.size) return;
    loading.current = true;
    const attempt = ++sequence.current;
    try {
      const value = await request<ThreadDetail>(path);
      if (alive.current && attempt === sequence.current) {
        show(value);
        setLoadError("");
        setMissing(false);
      }
    } catch (err) {
      if (alive.current && attempt === sequence.current) {
        setLoadError(errorOf(err));
        // Gone (deleted, removed, or never there): say so rather than offer to try again.
        if (statusOf(err) === 404) {
          setMissing(true);
          setThread(undefined);
        }
      }
    } finally {
      loading.current = false;
    }
  }, [path, show]);
  useMessageRefresh(() => {
    void refresh();
  }, !!thread);
  const pull = usePullRefresh(refresh);
  const version = thread?.version;
  const markRead = useCallback(async () => {
    if (!version || !focusedRef.current || AppState.currentState !== "active") return;
    try {
      await request(`${path}/read`, { method: "POST", body: { version } });
      updateBoardMemory(leagueId, (threads) =>
        threads.map((value) =>
          value.id === threadId && value.version <= version ? { ...value, unread: false } : value,
        ),
      );
      if (alive.current) {
        setReadError("");
        announceMessagesChanged();
      }
    } catch (err) {
      if (alive.current) setReadError(errorOf(err));
    }
  }, [path, version, leagueId, threadId]);
  useEffect(() => {
    if (!focused) return;
    void markRead();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void markRead();
    });
    return () => subscription.remove();
  }, [focused, markRead]);
  const scrollToPost = useCallback(
    (postId: string, animated: boolean, lead = 12) => {
      if (Platform.OS === "web") {
        const card = postCards.current.get(postId) as unknown as HTMLElement | undefined;
        if (!card?.scrollIntoView) return false;
        card.scrollIntoView({ block: "start", behavior: animated ? "smooth" : "auto" });
        return true;
      }
      const top = postTop(postId);
      if (top === undefined) return false;
      scroll.current?.scrollTo({ y: Math.max(0, top - lead), animated });
      return true;
    },
    [postTop],
  );
  /** Puts the thread where it opens. Runs until it has (the messages may not be laid out yet). */
  const land = useCallback(() => {
    const where = landing.current;
    if (!where || !settled) return;
    if (where.at === "end") scroll.current?.scrollToEnd({ animated: false });
    else if (where.at === "post") {
      const line = where.reason === "unread" ? unreadLine.current : null;
      if (Platform.OS === "web" && line) {
        (line as unknown as HTMLElement).scrollIntoView?.({ block: "start" });
      } else if (!scrollToPost(where.postId, false, where.reason === "unread" ? 48 : 12)) return;
    }
    landing.current = undefined;
  }, [scrollToPost, settled]);
  // In a browser the messages are laid out as soon as they are drawn. On iPhone the layout comes a moment
  // later, so there the scroll view's size change and each message's own layout call `land` instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lands once the first load has drawn.
  useEffect(() => {
    if (Platform.OS === "web") land();
  }, [land, arrival]);
  useEffect(() => {
    if (!scrollToId) return;
    // The highlight is a pointer, not a state: it fades once the reader has found the message.
    const timer = setTimeout(() => setScrollToId(undefined), 2500);
    if (Platform.OS === "web") {
      // Bring the original message to the middle of the screen and move focus to it.
      const card = postCards.current.get(scrollToId) as unknown as HTMLElement | undefined;
      card?.scrollIntoView?.({ block: "center" });
      card?.focus?.({ preventScroll: true });
      return () => clearTimeout(timer);
    }
    const top = postTop(scrollToId);
    if (top !== undefined) {
      scroll.current?.scrollTo({ y: Math.max(0, top - 12), animated: true });
      const target = postBodies.current.get(scrollToId);
      if (target) AccessibilityInfo.sendAccessibilityEvent(target, "focus");
    }
    return () => clearTimeout(timer);
  }, [scrollToId, postTop]);
  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    nearEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
    if (nearEnd.current && newBelow) setNewBelow(undefined);
  }

  /**
   * Runs one change at a time. What it did is said in the banner (`done`); what went wrong too, except for the
   * reply box (`inline`), whose error stays beside it.
   */
  async function mutate(name: string, action: () => Promise<void>, done?: string, inline = false) {
    if (mutating.current) return;
    mutating.current = true;
    sequence.current++;
    setBusy(name);
    setError("");
    try {
      await action();
      if (done) notifyDone(done);
    } catch (err) {
      if (inline) {
        if (alive.current) setError(errorOf(err));
      } else notifyError(errorOf(err));
    } finally {
      mutating.current = false;
      if (alive.current) setBusy(undefined);
    }
  }
  async function submitReply() {
    if (mutating.current || !body.trim()) return;
    const parsed = replySchema.safeParse({ body, quotedPostId: quote?.id });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your reply.");
      return;
    }
    if (!(await terms.ensure())) return;
    const sent = body;
    await mutate(
      "reply",
      async () => {
        await request(`${path}/replies`, { method: "POST", body: parsed.data });
        // The box stays editable while sending: keep whatever was typed after the reply went out.
        setBody((current) => (current.startsWith(sent) ? current.slice(sent.length).trimStart() : current));
        setQuote(undefined);
        announceMessagesChanged();
        // Refresh failure must not make a successful post look unsent and invite a duplicate reply.
        try {
          show(await request<ThreadDetail>(path), true);
          // The reply itself, scrolled into view, is what the player sees; say it for those who can't.
          announcement.say("Reply posted.");
        } catch {
          notifyDone("Reply posted. Refresh to see the latest messages.");
        }
      },
      undefined,
      true,
    );
    // Sending from the button or the keyboard leaves the player in the box, ready for the next reply.
    if (alive.current) input.current?.focus();
  }
  /** Puts one message's reactions in place, leaving the rest of the thread as it is. */
  const setReactions = (postId: string, reactions: MessageReaction[]) =>
    setThread(
      (previous) =>
        previous && {
          ...previous,
          posts: previous.posts.map((value) => (value.id === postId ? { ...value, reactions } : value)),
        },
    );
  /**
   * Turns the reader's reaction on or off at once, then sends it: the server's answer replaces the guess, and
   * a refusal puts the reactions back as they were and says why. One change per message is on its way at a time.
   */
  async function toggleReaction(post: MessagePost, emoji: MessageEmoji) {
    setReactionPost(undefined);
    if (reacting.current.has(post.id)) return;
    if (!(await terms.ensure())) return;
    const before =
      latestThread.current?.posts.find((value) => value.id === post.id)?.reactions ?? post.reactions;
    if (reacting.current.has(post.id)) return;
    const active = !before.find((reaction) => reaction.emoji === emoji)?.reacted;
    haptics.select();
    reacting.current.add(post.id);
    // A thread refresh already on its way read the thread before this change: drop its answer.
    sequence.current++;
    setReactions(post.id, toggledReactions(before, emoji, active));
    try {
      const reactions = await request<MessageReaction[]>(`${path}/posts/${post.id}/reactions`, {
        method: "PUT",
        body: { emoji, active },
      });
      if (alive.current) setReactions(post.id, reactions);
    } catch (err) {
      if (alive.current) {
        setReactions(post.id, before);
        notifyError(errorOf(err));
      }
    } finally {
      reacting.current.delete(post.id);
    }
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
    void mutate(
      "delete",
      async () => {
        await request(path, { method: "DELETE" });
        announceMessagesChanged();
        setDeleted(true);
      },
      "Thread deleted.",
    );
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
    const wholeThread = action === "remove" && post.position === 1;
    void mutate(
      action,
      async () => {
        await request(`${path}/posts/${post.id}/moderation`, { method: "PUT", body: { action } });
        announceMessagesChanged();
        if (wholeThread) setDeleted(true);
        else setThread(await request<ThreadDetail>(path));
      },
      wholeThread ? "Thread removed." : action === "remove" ? "Message removed." : "Message restored.",
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
  const backLink = (
    <MessageBackLink
      // The arrow alone beside the thread's title; with its words while there is no title to show.
      compact={compact && !!thread}
      href={boardPath(leagueId)}
      onPress={() => backToBoard(leagueId)}
    />
  );
  const optionsButton = thread && (thread.canPin || thread.canDelete) && (
    <Pressable
      ref={options.ref}
      accessibilityRole="button"
      accessibilityLabel={busy === "delete" ? "Deleting…" : `Options for ${thread.title}`}
      disabled={!!busy}
      style={(state) => [s.iconButton, { backgroundColor: hoverFill(state) }]}
      onPress={options.open}
    >
      {busy === "delete" ? (
        <Text style={s.meta}>Deleting…</Text>
      ) : (
        <Icon name="more" size={24} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
  const unreadPostId = arrival?.at === "post" && arrival.reason === "unread" ? arrival.postId : undefined;
  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={keyboardOffset}
    >
      {compact && (
        <View style={s.threadBar}>
          {backLink}
          <Text accessibilityRole="header" numberOfLines={3} style={[s.threadTitle, s.flex]}>
            {thread?.title ?? ""}
          </Text>
          {optionsButton || <View style={s.threadBarEnd} />}
        </View>
      )}
      <View style={s.flex}>
        <ScrollView
          ref={scroll}
          contentContainerStyle={s.screen}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          scrollEventThrottle={100}
          onScroll={onScroll}
          onContentSizeChange={() => {
            land();
            if (followEnd.current) {
              followEnd.current = false;
              scroll.current?.scrollToEnd({ animated: true });
            }
          }}
          refreshControl={<RefreshControl {...pull} tintColor={colors.foreground} />}
        >
          {header}
          {!compact && backLink}
          {!thread && !loadError && <LoadingMessages thread />}
          {missing ? (
            <View style={[s.card, s.column]}>
              <Text accessibilityRole="alert" style={s.text}>
                Thread not found. It may have been deleted.
              </Text>
              <Action
                secondary
                compact
                href={boardPath(leagueId)}
                label="See all threads"
                onPress={() => backToBoard(leagueId)}
              >
                See all threads
              </Action>
            </View>
          ) : (
            !!loadError &&
            !thread && (
              <View style={s.column}>
                <Failure
                  message={loadError}
                  retry={() => {
                    void refresh();
                  }}
                />
              </View>
            )
          )}
          {thread && (
            <>
              {compact ? (
                thread.pinned && <PinnedBadge />
              ) : (
                <View style={[s.row, s.column, { alignItems: "flex-start" }]}>
                  <View style={[s.flex, s.stack]}>
                    {thread.pinned && <PinnedBadge />}
                    <Title size="heading">{thread.title}</Title>
                  </View>
                  {optionsButton}
                </View>
              )}
              {!!readError && (
                <View style={[s.card, s.column]}>
                  <Text accessibilityRole="alert" style={s.error}>
                    Could not mark this thread read: {readError}
                  </Text>
                  <Action
                    secondary
                    compact
                    onPress={() => {
                      void markRead();
                    }}
                  >
                    Try marking read again
                  </Action>
                </View>
              )}
              <View
                style={s.posts}
                onLayout={(event) => {
                  postsTop.current = event.nativeEvent.layout.y;
                  if (landing.current) land();
                }}
              >
                {thread.posts.map((post, index) => {
                  const placeholder = postPlaceholder(post.state, revealed.has(post.id), thread.canModerate);
                  // Removed and hidden messages take no reactions or quotes; a blocked player's do once shown.
                  const interactive = !placeholder && post.state !== "removed" && post.state !== "hidden";
                  const actions = postActions(post, {
                    canModerate: thread.canModerate,
                    blockedAuthor: post.state === "blocked",
                  });
                  const previous = index > 0 ? thread.posts[index - 1] : undefined;
                  const topic = post.position === 1;
                  const grouped =
                    !!previous &&
                    groupsWithPrevious(
                      {
                        ...previous,
                        placeholder: !!postPlaceholder(
                          previous.state,
                          revealed.has(previous.id),
                          thread.canModerate,
                        ),
                      },
                      { ...post, placeholder: !!placeholder },
                      post.id === unreadPostId,
                    );
                  const bodyRef = (node: ComponentRef<typeof Text> | null) => {
                    if (node) postBodies.current.set(post.id, node);
                    else postBodies.current.delete(post.id);
                  };
                  // The ⋯ at the row's end: on a placeholder's line, else at the end of the message's controls.
                  const menuButton = actions.length > 0 && (
                    <Pressable
                      ref={(node) => {
                        if (node) postMenuButtons.current.set(post.id, node);
                        else postMenuButtons.current.delete(post.id);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Options for message ${post.position} by ${post.authorName}`}
                      disabled={!!busy}
                      style={[s.tool, s.toolEnd]}
                      onPress={() =>
                        postMenuButtons.current
                          .get(post.id)
                          ?.measureInWindow((x, y, width, height) =>
                            setPostMenu({ postId: post.id, anchor: { x, y, width, height } }),
                          )
                      }
                    >
                      {(state) => (
                        <View style={[s.toolFace, { backgroundColor: hoverFill(state) }, toolFade]}>
                          <Icon name="more" size={20} color={colors.mutedForeground} />
                        </View>
                      )}
                    </Pressable>
                  );
                  return (
                    <Fragment key={post.id}>
                      {post.id === unreadPostId && (
                        <View ref={unreadLine} role="separator" aria-label="New replies" style={s.newLine}>
                          <View style={s.newRule} />
                          <Text style={s.newLabel}>New</Text>
                          <View style={s.newRule} />
                        </View>
                      )}
                      <View
                        style={[
                          topic ? s.topic : grouped ? s.grouped : s.reply,
                          scrollToId === post.id && s.highlight,
                        ]}
                        ref={(node) => {
                          if (node) postCards.current.set(post.id, node);
                          else postCards.current.delete(post.id);
                        }}
                        onLayout={(event) => {
                          positions.current.set(post.id, event.nativeEvent.layout.y);
                          // On iPhone the place to land is known only once the message is laid out.
                          if (landing.current) land();
                        }}
                        role="region"
                        aria-label={`Message ${post.position} by ${post.authorName}`}
                        // Focusable on the web, so "View original" can move focus to it.
                        tabIndex={Platform.OS === "web" ? -1 : undefined}
                      >
                        <FadeIn
                          from={4}
                          enabled={!!firstPosts.current && !firstPosts.current.has(post.id)}
                          style={placeholder ? s.placeholderRow : s.postRow}
                        >
                          {placeholder ? (
                            <>
                              <View style={s.gutter}>
                                <Icon
                                  name={placeholderIcon(post.state)}
                                  size={16}
                                  color={colors.mutedForeground}
                                />
                              </View>
                              <Text ref={bodyRef} style={[s.placeholderText, s.flex]}>
                                {post.state === "removed" || post.state === "hidden"
                                  ? `${post.authorName} · ${placeholder.text}`
                                  : placeholder.text}
                              </Text>
                              {placeholder.canShow && (
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Show message ${post.position} by ${post.authorName}`}
                                  style={(state) => [s.showButton, { backgroundColor: hoverFill(state) }]}
                                  onPress={() => setRevealed((previous) => new Set(previous).add(post.id))}
                                >
                                  <Text style={s.showText}>Show</Text>
                                </Pressable>
                              )}
                              {menuButton}
                            </>
                          ) : (
                            <>
                              <View style={s.gutter}>
                                {!grouped && <Avatar avatarId={post.avatarId} name={post.authorName} />}
                              </View>
                              <View style={s.postMain}>
                                {!grouped && (
                                  // The name gives way first (it shortens), then the time drops under it.
                                  <View style={s.byline}>
                                    {/* A long name shortens; "(you)" stays whole beside it. */}
                                    <View style={s.name}>
                                      <Text numberOfLines={1} style={s.author}>
                                        {post.authorName}
                                      </Text>
                                      {post.mine && <Text style={s.you}>(you)</Text>}
                                    </View>
                                    <MessageTimestamp value={post.createdAt} now={clockNow()} />
                                  </View>
                                )}
                                {post.state === "review" && <Badge>Under review</Badge>}
                                {post.quote && (
                                  <QuotedMessage
                                    quote={post.quote}
                                    href={`${path}?post=${encodeURIComponent(post.quote.id)}`}
                                    onOriginal={() => {
                                      setScrollToId(undefined);
                                      requestAnimationFrame(() => setScrollToId(post.quote?.id));
                                    }}
                                  />
                                )}
                                <MessageBody
                                  ref={bodyRef}
                                  accessibilityLabel={`Message ${post.position} by ${post.authorName}: ${post.body}`}
                                  style={s.text}
                                  body={post.body}
                                />
                                {(interactive || !!menuButton) && (
                                  // One cluster of controls at the text's edge, the ⋯ at the row's end.
                                  <View style={s.postActions}>
                                    {interactive && (
                                      <View role="group" aria-label="Message reactions" style={s.reactions}>
                                        {MESSAGE_REACTIONS.flatMap(({ emoji }) => {
                                          const reaction = post.reactions.find(
                                            (value) => value.emoji === emoji,
                                          );
                                          return reaction && reaction.count > 0 ? [reaction] : [];
                                        }).map((reaction) => (
                                          <FadeIn key={reaction.emoji} enabled={drawn.current}>
                                            <Pressable
                                              disabled={!!thread.postingBlocked}
                                              accessibilityRole="button"
                                              accessibilityLabel={`${MESSAGE_REACTIONS.find((value) => value.emoji === reaction.emoji)?.label ?? reaction.emoji}, ${counted(reaction.count, "reaction")}`}
                                              // A toggle: pressed while it is your reaction.
                                              aria-pressed={reaction.reacted}
                                              accessibilityState={{ disabled: !!thread.postingBlocked }}
                                              onPress={() => void toggleReaction(post, reaction.emoji)}
                                              style={s.reactionTarget}
                                            >
                                              {(state) => (
                                                <View
                                                  style={[
                                                    s.reactionPill,
                                                    reaction.reacted && s.selected,
                                                    !reaction.reacted &&
                                                      pressState(state).hovered && {
                                                        backgroundColor: colors.raisedHover,
                                                      },
                                                    webTransition(["background-color"]),
                                                  ]}
                                                >
                                                  <Text style={s.reactionEmoji}>{reaction.emoji}</Text>
                                                  <Text
                                                    style={[
                                                      s.reactionCount,
                                                      reaction.reacted && s.reactedCount,
                                                    ]}
                                                  >
                                                    {reaction.count}
                                                  </Text>
                                                </View>
                                              )}
                                            </Pressable>
                                          </FadeIn>
                                        ))}
                                        {!thread.postingBlocked && (
                                          <Pressable
                                            ref={(node) => {
                                              if (node) addReactionButtons.current.set(post.id, node);
                                              else addReactionButtons.current.delete(post.id);
                                            }}
                                            accessibilityRole="button"
                                            accessibilityLabel="Add reaction"
                                            style={[
                                              s.tool,
                                              // Alone, its icon lines up with the text above.
                                              !post.reactions.some((value) => value.count > 0) && s.toolStart,
                                            ]}
                                            onPress={() =>
                                              addReactionButtons.current
                                                .get(post.id)
                                                ?.measureInWindow((x, y, width, height) => {
                                                  setReactionAnchor({ x, y, width, height });
                                                  setReactionPost(post.id);
                                                })
                                            }
                                          >
                                            {(state) => (
                                              <View
                                                style={[
                                                  s.toolFace,
                                                  { backgroundColor: hoverFill(state) },
                                                  toolFade,
                                                ]}
                                              >
                                                <Icon name="smile" size={20} color={colors.mutedForeground} />
                                              </View>
                                            )}
                                          </Pressable>
                                        )}
                                      </View>
                                    )}
                                    {/* Quote and ⋯ sit together at the row's end, the dots at the column's edge. */}
                                    <View style={s.tools}>
                                      {interactive && !thread.postingBlocked && (
                                        <Pressable
                                          accessibilityRole="button"
                                          accessibilityLabel={`Quote message ${post.position} by ${post.authorName}`}
                                          disabled={!!busy}
                                          style={[s.tool, !menuButton && s.toolEnd]}
                                          onPress={() => {
                                            setQuote({
                                              id: post.id,
                                              authorName: post.authorName,
                                              body: post.body,
                                            });
                                            input.current?.focus();
                                          }}
                                        >
                                          {(state) => (
                                            <View
                                              style={[
                                                s.toolFace,
                                                { backgroundColor: hoverFill(state) },
                                                toolFade,
                                              ]}
                                            >
                                              <Icon name="reply" size={20} color={colors.mutedForeground} />
                                            </View>
                                          )}
                                        </Pressable>
                                      )}
                                      {menuButton}
                                    </View>
                                  </View>
                                )}
                              </View>
                            </>
                          )}
                        </FadeIn>
                      </View>
                    </Fragment>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
        {newBelow && (
          <View pointerEvents="box-none" style={s.newBelow}>
            <FadeIn from={8}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New replies"
                style={(state) => [s.newBelowPill, pressFade(state)]}
                onPress={() => {
                  scrollToPost(newBelow, true);
                  setNewBelow(undefined);
                }}
              >
                <Text style={s.newBelowText}>New replies</Text>
                <Icon name="chevron-down" size={16} color={colors.primaryForeground} />
              </Pressable>
            </FadeIn>
          </View>
        )}
      </View>
      {thread && !deleted && (
        // The bar runs the window's width; what is in it lines up with the thread's column.
        <View style={s.composerBar}>
          <View style={s.composer}>
            {thread.postingBlocked ? (
              <PostingBlocked reason={thread.postingBlocked} />
            ) : (
              <>
                {quote && (
                  <View role="region" aria-label="Reply quote preview" style={s.quotePreview}>
                    <Icon name="quote" size={16} color={colors.primaryText} />
                    <Text style={[s.meta, s.flex]} numberOfLines={1}>
                      <Text style={s.author}>{quote.authorName} wrote: </Text>
                      {quote.body}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove quote"
                      disabled={!!busy}
                      style={(state) => [s.iconButton, { backgroundColor: hoverFill(state) }]}
                      onPress={() => {
                        setQuote(undefined);
                        // The button is gone with the quote: put the player back in their reply.
                        input.current?.focus();
                      }}
                    >
                      <Icon name="close" size={18} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                )}
                <View style={s.replyRow}>
                  <View style={s.replyField}>
                    <AutoGrowInput
                      ref={input}
                      accessibilityLabel="Reply"
                      placeholder="Write a reply…"
                      placeholderTextColor={colors.mutedForeground}
                      selectionColor={colors.primary}
                      style={[s.input, s.replyInput, shortcutHint && s.replyInputHinted]}
                      focusedStyle={s.inputFocused}
                      minHeight={44}
                      maxHeight={160}
                      maxLength={MESSAGE_BODY_MAX}
                      value={body}
                      onChangeText={setBody}
                      onSubmit={() => void submitReply()}
                    />
                    {/* Inside the box, in space it always keeps, so nothing moves when it appears. */}
                    {shortcutHint && !!body.trim() && (
                      <Text pointerEvents="none" aria-hidden style={s.hint}>
                        {postShortcut(browserPlatform())}
                      </Text>
                    )}
                  </View>
                  <View {...keepsFocus}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={busy === "reply" ? "Posting…" : "Post reply"}
                      accessibilityState={{ disabled: !!busy || !body.trim() }}
                      disabled={!!busy || !body.trim()}
                      style={(state) => [
                        s.sendButton,
                        pressFade(state),
                        (!!busy || !body.trim()) && s.disabled,
                      ]}
                      onPress={() => void submitReply()}
                    >
                      <Icon name="send" size={20} color={colors.primaryForeground} filled />
                    </Pressable>
                  </View>
                </View>
                <Notice message={error} kind="alert" />
                {announcement.region}
              </>
            )}
          </View>
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
        // Its choices are menu items: announced as a menu, the first one focused, arrow keys between them.
        menu
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
                  // Both: `aria-checked` is what a browser reads, `accessibilityState` what VoiceOver does.
                  aria-checked={selected}
                  accessibilityState={{ checked: selected }}
                  style={(state) => [
                    s.reactionChoice,
                    selected && s.choiceSelected,
                    (state.pressed || pressState(state).hovered) && { backgroundColor: colors.raised },
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

/** A message's small controls: 44px to touch, a 32px circle to see. */
const TOOL = 44;
const TOOL_FACE = 32;
const toolFade = webTransition(["background-color"]);
/** The avatar's gutter beside every message (32px avatar, 10px to the text). */
const GUTTER = 32;
/** What the reply box keeps free at its right for "Ctrl+↩ to post". */
const HINT_SPACE = 104;

const s = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    paddingHorizontal: layout.pageX,
    paddingTop: layout.pageTop,
    paddingBottom: layout.pageBottom,
    gap: space.lg,
    backgroundColor: colors.background,
    flexGrow: 1,
    width: "100%",
    maxWidth: widths.page,
    alignSelf: "center",
  },
  // The thread and the New thread form read in a column, left-aligned with the page's title.
  column: { width: "100%", maxWidth: widths.reading, gap: space.lg },
  stack: { gap: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  card: {
    padding: layout.cardPad,
    ...corner(radius.xl),
    backgroundColor: colors.card,
    gap: layout.cardGap,
    boxShadow: elevation.cardEdge,
  },
  boardHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.lg,
  },
  threadTitle: { ...type.body, fontFamily: fonts.semibold, lineHeight: 22, color: colors.foreground },
  // A phone's thread bar: back, the title (three lines at most) and the thread's options, always in reach.
  threadBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    minHeight: 52,
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
    backgroundColor: colors.chrome,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  threadBarEnd: { width: space.md },
  text: { ...type.body, color: colors.foreground },
  author: {
    ...type.small,
    fontFamily: fonts.semibold,
    color: colors.foreground,
    flexShrink: 1,
    maxWidth: "100%",
  },
  you: { ...type.small, color: colors.mutedForeground, flexShrink: 0 },
  meta: { ...type.small, color: colors.mutedForeground },
  label: { ...type.small, fontFamily: fonts.medium, color: colors.mutedForeground },
  error: { ...type.small, color: colors.destructive },
  // At the reply box's bottom right, centered on its first line while it is one line tall.
  hint: { ...type.caption, color: colors.mutedForeground, position: "absolute", right: 14, bottom: 14 },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    ...type.body,
    backgroundColor: colors.field,
    borderColor: colors.input,
    borderWidth: 1,
    color: colors.foreground,
  },
  inputFocused: { borderColor: colors.primary },
  replyField: { flex: 1, minWidth: 0 },
  replyInput: { borderRadius: radius.sheet, paddingHorizontal: 14 },
  // Room kept for the shortcut hint, whether or not it shows, so the text never wraps under it.
  replyInputHinted: { paddingRight: HINT_SPACE },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: space.md,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: radius.full,
  },
  // The thread: a topic card, then replies as rows on the page.
  posts: { width: "100%", maxWidth: widths.reading },
  topic: {
    ...corner(radius.xl),
    backgroundColor: colors.card,
    boxShadow: elevation.cardEdge,
    padding: layout.cardPad,
    marginBottom: space.xs,
  },
  // Inset as far as the topic card's padding, so every avatar, name and ⋯ lines up down the thread (and the
  // landing highlight has room around the row).
  reply: {
    marginTop: space.md,
    paddingHorizontal: layout.cardPad,
    paddingVertical: space.xs,
    ...corner(radius.lg),
  },
  // A follow-up from the same author, a few minutes on: 4px under the one above.
  grouped: {
    marginTop: -space.xs,
    paddingHorizontal: layout.cardPad,
    paddingVertical: space.xs,
    ...corner(radius.lg),
  },
  highlight: { backgroundColor: colors.raised },
  postRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  gutter: { width: GUTTER, alignItems: "center" },
  postMain: { flex: 1, minWidth: 0, gap: space.xs },
  // One row whatever the width: the name shortens, the time drops under it.
  byline: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: space.md,
    marginBottom: -space.xxs,
  },
  // Reactions (and Add reaction after them) wrap inside their own space; Quote and ⋯ keep their place at the
  // end of the first row. The buttons are 44px to touch and 32px to see, so the row takes 32px.
  postActions: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    marginVertical: -(TOOL - TOOL_FACE) / 2,
  },
  tools: { flexDirection: "row", flexShrink: 0, marginLeft: "auto" },
  tool: { width: TOOL, height: TOOL, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  toolFace: {
    width: TOOL_FACE,
    height: TOOL_FACE,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  // The first and last circles meet the column's edges.
  toolStart: { marginLeft: -(TOOL - TOOL_FACE) / 2 },
  toolEnd: { marginRight: -(TOOL - TOOL_FACE) / 2 },
  name: { flexDirection: "row", alignItems: "baseline", gap: space.xs, flexShrink: 1, minWidth: 0 },
  reactions: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.xs,
  },
  reactionTarget: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  reactionPill: {
    height: 28,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
    backgroundColor: colors.secondary,
  },
  selected: { backgroundColor: colors.primaryTintStrong },
  reactionEmoji: { fontSize: 15, lineHeight: 18 },
  reactionCount: { ...type.caption, ...tabular, fontFamily: fonts.semibold, color: colors.mutedForeground },
  reactedCount: { color: colors.foreground },
  // What stands in for a message's text: one quiet 44px line, no avatar or name.
  placeholderRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 },
  placeholderText: { ...type.small, color: colors.mutedForeground },
  showText: { ...type.small, fontFamily: fonts.medium, color: colors.mutedForeground },
  showButton: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    justifyContent: "center",
    borderRadius: radius.md,
  },
  newLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: space.xs,
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  newRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.primary },
  newLabel: { ...type.caption, fontFamily: fonts.semibold, color: colors.primaryText },
  newBelow: { position: "absolute", left: 0, right: 0, bottom: space.lg, alignItems: "center" },
  newBelowPill: {
    minHeight: 44,
    paddingHorizontal: space.xl,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    boxShadow: elevation.float,
  },
  newBelowText: { ...type.small, fontFamily: fonts.semibold, color: colors.primaryForeground },
  // In the page for screen readers, out of sight for everyone else.
  announcement: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
  blockedNotice: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 44 },
  composerBar: {
    backgroundColor: colors.chrome,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    boxShadow: elevation.bar,
  },
  // Lined up with the thread's column above it.
  composer: {
    width: "100%",
    maxWidth: widths.page,
    alignSelf: "center",
    paddingHorizontal: layout.pageX,
    paddingVertical: space.lg,
    gap: space.md,
  },
  quotePreview: {
    maxWidth: widths.reading,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    ...corner(radius.lg),
    backgroundColor: colors.raised,
    paddingLeft: space.lg,
    paddingRight: space.xxs,
  },
  replyRow: { flexDirection: "row", alignItems: "flex-end", gap: space.md, maxWidth: widths.reading },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
  loadingBoard: { ...corner(radius.xl), backgroundColor: colors.card, overflow: "hidden" },
  loadingRow: { paddingHorizontal: layout.cardPad, paddingVertical: 14, minHeight: 64 },
  loadingPost: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  loadingLines: { flex: 1, gap: space.md, paddingTop: space.xxs },
  reactionPicker: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.xxs,
  },
  reactionChoice: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    justifyContent: "center",
    alignItems: "center",
  },
  choiceSelected: { backgroundColor: colors.primaryTintStrong },
  emoji: { fontSize: 24, lineHeight: 30 },
});
