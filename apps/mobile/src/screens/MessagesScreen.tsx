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
import { AppLink } from "../components/AppLink";
import { AutoGrowInput } from "../components/AutoGrowInput";
import { Avatar } from "../components/Avatar";
import { Icon } from "../components/Icon";
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
import { Badge, colors, fonts, Notice } from "../components/ui";
import { request, statusOf } from "../lib/api";
import { now as clockNow } from "../lib/clock";
import { showConfirm } from "../lib/dialogs";
import { fieldDefaults } from "../lib/fieldProps";
import { haptics } from "../lib/haptics";
import { readLoadCache, writeLoadCache } from "../lib/loadCache";
import { counted, type ThreadArrival, threadArrival } from "../lib/messagePresentation";
import {
  announceMessagesChanged,
  postingBlockedIn,
  setPostingBlocked,
  setUnreadThreads,
  subscribeMessagesChanged,
} from "../lib/messageUnread";
import { postActions, postPlaceholder } from "../lib/moderation";
import { notifyDone, notifyError } from "../lib/notify";
import { usePageTitle } from "../lib/pageTitle";
import { usePullRefresh } from "../lib/pullRefresh";
import { useScrollRestore } from "../lib/scrollRestore";
import { useRemovalGuard, useUnsavedWork } from "../lib/unsaved";
import { LeagueHeader, LeagueTabBar } from "./LeagueChrome";
import { useLeagueShell } from "./leagueContext";

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
      style={(state) => [
        s.button,
        secondary && s.secondary,
        secondary && pressState(state).hovered && { backgroundColor: colors.raisedHover },
        !secondary && pressFade(state),
        disabled && s.disabled,
        state.pressed && s.pressed,
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

/** The offset that keeps a screen's bottom edge above the iPhone keyboard: everything above the screen. */
function useKeyboardOffset() {
  return useSafeAreaInsets().top + APP_HEADER_HEIGHT;
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
    // The same spacing as the league's own tabs (`LeagueTabHeader`), so nothing moves between board and thread.
    <View style={s.leagueHeader}>
      <LeagueHeader leagueId={leagueId} leagueName={league.name} />
      {wide && (
        <LeagueTabBar
          wide
          leagueId={leagueId}
          type={league.type}
          active="messages"
          unreadCount={shell.unreadCount}
          reportsWaiting={league.openReports ?? 0}
        />
      )}
    </View>
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
        <Text accessibilityRole="header" style={s.heading}>
          Message board
        </Text>
        {!page?.postingBlocked && (
          <AppLink href={threadPath(leagueId, "new")} style={(state) => [s.newThread, pressFade(state)]}>
            <Icon name="plus" size={16} color={colors.primaryForeground} />
            <Text style={s.buttonText}>New thread</Text>
          </AppLink>
        )}
      </View>
      {!!page?.postingBlocked && <PostingBlocked reason={page.postingBlocked} />}
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
      <BoardRows threads={threads} now={clockNow()} hrefOf={(id) => threadPath(leagueId, id)} />
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
        <View style={s.card}>
          <MessageBackLink href={boardPath(leagueId)} onPress={() => backToBoard(leagueId)} />
          <Text accessibilityRole="header" style={s.heading}>
            New thread
          </Text>
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
                label={busy ? "Posting…" : "Create thread"}
                disabled={busy || !title.trim() || !body.trim()}
                onPress={() => {
                  void submit();
                }}
              />
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
  // Under 480px the quote button is its icon alone, so it stays on the reactions' row.
  const narrow = useWindowDimensions().width < 480;
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
  const positions = useRef(new Map<string, number>());
  const postBodies = useRef(new Map<string, ComponentRef<typeof Text>>());
  const postCards = useRef(new Map<string, ComponentRef<typeof View>>());
  const unreadLine = useRef<ComponentRef<typeof View>>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const mutating = useRef(false);
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
    if (loading.current || mutating.current) return;
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
  const scrollToPost = useCallback((postId: string, animated: boolean, lead = 12) => {
    if (Platform.OS === "web") {
      const card = postCards.current.get(postId) as unknown as HTMLElement | undefined;
      if (!card?.scrollIntoView) return false;
      card.scrollIntoView({ block: "start", behavior: animated ? "smooth" : "auto" });
      return true;
    }
    const top = positions.current.get(postId);
    if (top === undefined) return false;
    scroll.current?.scrollTo({ y: Math.max(0, top - lead), animated });
    return true;
  }, []);
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
    const top = positions.current.get(scrollToId);
    if (top !== undefined) {
      scroll.current?.scrollTo({ y: Math.max(0, top - 12), animated: true });
      const target = postBodies.current.get(scrollToId);
      if (target) AccessibilityInfo.sendAccessibilityEvent(target, "focus");
    }
    return () => clearTimeout(timer);
  }, [scrollToId]);
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
  async function toggleReaction(post: MessagePost, emoji: MessageEmoji) {
    setReactionPost(undefined);
    const active = !post.reactions.find((reaction) => reaction.emoji === emoji)?.reacted;
    if (!(await terms.ensure())) return;
    haptics.select();
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
            <View style={s.card}>
              <Text accessibilityRole="alert" style={s.text}>
                Thread not found. It may have been deleted.
              </Text>
              <AppLink
                href={boardPath(leagueId)}
                accessibilityLabel="See all threads"
                onPress={() => backToBoard(leagueId)}
                style={(state) => [
                  s.button,
                  s.secondary,
                  pressState(state).hovered && { backgroundColor: colors.raisedHover },
                  state.pressed && s.pressed,
                ]}
              >
                <Text style={[s.buttonText, s.text]}>See all threads</Text>
              </AppLink>
            </View>
          ) : (
            !!loadError &&
            !thread && (
              <Failure
                error={loadError}
                retry={() => {
                  void refresh();
                }}
              />
            )
          )}
          {thread && (
            <>
              {compact ? (
                thread.pinned && <PinnedBadge />
              ) : (
                <View style={[s.row, { alignItems: "flex-start" }]}>
                  <View style={[s.flex, s.stack]}>
                    {thread.pinned && <PinnedBadge />}
                    <Text accessibilityRole="header" style={s.heading}>
                      {thread.title}
                    </Text>
                  </View>
                  {optionsButton}
                </View>
              )}
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
                  <Fragment key={post.id}>
                    {post.id === unreadPostId && (
                      <View ref={unreadLine} role="separator" aria-label="New replies" style={s.newLine}>
                        <View style={s.newRule} />
                        <Text style={s.newLabel}>New</Text>
                        <View style={s.newRule} />
                      </View>
                    )}
                    <View
                      style={[s.card, scrollToId === post.id && s.highlight]}
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
                      <View style={s.postHeader}>
                        <Avatar avatarId={post.avatarId} name={post.authorName} />
                        {/* The name gives way first (it shortens), then the time drops under it. */}
                        <View style={s.byline}>
                          <Text numberOfLines={1} style={s.author}>
                            {post.authorName}
                          </Text>
                          <MessageTimestamp value={post.createdAt} now={clockNow()} />
                        </View>
                        {actions.length > 0 && (
                          <Pressable
                            ref={(node) => {
                              if (node) postMenuButtons.current.set(post.id, node);
                              else postMenuButtons.current.delete(post.id);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`Options for message ${post.position} by ${post.authorName}`}
                            disabled={!!busy}
                            style={(state) => [
                              s.iconButton,
                              s.postMenuButton,
                              { backgroundColor: hoverFill(state) },
                            ]}
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
                              style={(state) => [s.quoteReply, { backgroundColor: hoverFill(state) }]}
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
                              href={`${path}?post=${encodeURIComponent(post.quote.id)}`}
                              onOriginal={() => {
                                setScrollToId(undefined);
                                requestAnimationFrame(() => setScrollToId(post.quote?.id));
                              }}
                            />
                          )}
                          <MessageBody
                            ref={(node) => {
                              if (node) postBodies.current.set(post.id, node);
                              else postBodies.current.delete(post.id);
                            }}
                            accessibilityLabel={`Message ${post.position} by ${post.authorName}: ${post.body}`}
                            style={s.text}
                            body={post.body}
                          />
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
                                accessibilityLabel={`${MESSAGE_REACTIONS.find((value) => value.emoji === reaction.emoji)?.label ?? reaction.emoji}, ${counted(reaction.count, "reaction")}`}
                                // A toggle: pressed while it is your reaction.
                                aria-pressed={reaction.reacted}
                                accessibilityState={{ disabled: !!busy || !!thread.postingBlocked }}
                                onPress={() => void toggleReaction(post, reaction.emoji)}
                                style={s.reactionTarget}
                              >
                                {(state) => (
                                  <View
                                    style={[
                                      s.reactionPill,
                                      reaction.reacted && s.selected,
                                      !reaction.reacted &&
                                        pressState(state).hovered && { backgroundColor: colors.raisedHover },
                                    ]}
                                  >
                                    <Text style={s.reactionEmoji}>{reaction.emoji}</Text>
                                    <Text style={[s.reactionCount, reaction.reacted && s.text]}>
                                      {busy === `reaction:${post.id}:${reaction.emoji}`
                                        ? "Saving…"
                                        : reaction.count}
                                    </Text>
                                  </View>
                                )}
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
                                {(state) => (
                                  <View
                                    style={[
                                      s.reactionPill,
                                      pressState(state).hovered && { backgroundColor: colors.raisedHover },
                                    ]}
                                  >
                                    <Icon name="smile" size={20} color={colors.mutedForeground} />
                                    <Icon name="plus" size={12} color={colors.mutedForeground} />
                                  </View>
                                )}
                              </Pressable>
                            )}
                          </View>
                          {!thread.postingBlocked && (
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Quote message ${post.position} by ${post.authorName}`}
                              disabled={!!busy}
                              style={(state) => [
                                s.quoteReply,
                                narrow && s.quoteReplyIcon,
                                { backgroundColor: hoverFill(state) },
                              ]}
                              onPress={() => {
                                setQuote({ id: post.id, authorName: post.authorName, body: post.body });
                                input.current?.focus();
                              }}
                            >
                              <Icon name="quote" size={narrow ? 20 : 16} color={colors.mutedForeground} />
                              {!narrow && <Text style={s.quoteReplyText}>Quote reply</Text>}
                            </Pressable>
                          )}
                        </View>
                      )}
                    </View>
                  </Fragment>
                );
              })}
            </>
          )}
        </ScrollView>
        {newBelow && (
          <View pointerEvents="box-none" style={s.newBelow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New replies"
              style={(state) => [s.newBelowPill, pressFade(state)]}
              onPress={() => {
                scrollToPost(newBelow, true);
                setNewBelow(undefined);
              }}
            >
              <Text style={s.buttonText}>New replies</Text>
              <Icon name="chevron-down" size={16} color={colors.primaryForeground} />
            </Pressable>
          </View>
        )}
      </View>
      {thread && !deleted && thread.postingBlocked && (
        <View style={s.composer}>
          <PostingBlocked reason={thread.postingBlocked} />
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
            <AutoGrowInput
              ref={input}
              accessibilityLabel="Reply"
              placeholder="Write a reply…"
              placeholderTextColor={colors.mutedForeground}
              selectionColor={colors.primary}
              style={[s.input, s.replyInput]}
              focusedStyle={s.inputFocused}
              minHeight={44}
              maxHeight={160}
              maxLength={MESSAGE_BODY_MAX}
              value={body}
              onChangeText={setBody}
              onSubmit={() => void submitReply()}
            />
            <View {...keepsFocus}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={busy === "reply" ? "Posting…" : "Post reply"}
                accessibilityState={{ disabled: !!busy || !body.trim() }}
                disabled={!!busy || !body.trim()}
                style={(state) => [s.sendButton, pressFade(state), (!!busy || !body.trim()) && s.disabled]}
                onPress={() => void submitReply()}
              >
                <Icon name="send" size={20} color={colors.primaryForeground} filled />
              </Pressable>
            </View>
          </View>
          <Notice message={error} kind="alert" />
          {announcement.region}
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
  leagueHeader: { gap: 20 },
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
  // A phone's thread bar: back, the title (three lines at most) and the thread's options, always in reach.
  threadBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minHeight: 52,
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: colors.chrome,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  threadBarEnd: { width: 8 },
  text: { fontFamily: fonts.body, color: colors.foreground, fontSize: 16, lineHeight: 23 },
  author: {
    fontFamily: fonts.semibold,
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
    maxWidth: "100%",
  },
  meta: { fontFamily: fonts.body, color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.medium, color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  error: { fontFamily: fonts.body, color: colors.destructive, fontSize: 14, lineHeight: 20 },
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
  inputFocused: { borderColor: colors.primary },
  replyInput: { borderRadius: 22, flex: 1, paddingHorizontal: 14 },
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
  // One row whatever the width: the name shortens, the time drops under it, the ⋯ stays at the end.
  postHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  byline: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: 10,
  },
  postMenuButton: { flexShrink: 0, marginVertical: -8, marginRight: -8 },
  // Reactions wrap inside their own space; the quote button keeps its place at the end of the first row.
  postActions: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginVertical: -6 },
  reactions: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
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
    flexShrink: 0,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  quoteReplyIcon: { width: 44, justifyContent: "center", paddingHorizontal: 0, borderRadius: 22 },
  quoteReplyText: { fontFamily: fonts.medium, fontSize: 14, color: colors.mutedForeground },
  highlight: { backgroundColor: colors.raised },
  newLine: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4, paddingTop: 8 },
  newRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.primary },
  newLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.primary },
  newBelow: { position: "absolute", left: 0, right: 0, bottom: 12, alignItems: "center" },
  newBelowPill: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 22,
    backgroundColor: colors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    boxShadow: "0 4px 16px #00000066",
  },
  // In the page for screen readers, out of sight for everyone else.
  announcement: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
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
