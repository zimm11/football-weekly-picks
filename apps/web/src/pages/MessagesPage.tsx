import {
  ArrowBendUpLeftIcon,
  CaretLeftIcon,
  DotsThreeIcon,
  PlusIcon,
  PushPinIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import {
  type MessageReaction,
  type MessageThread,
  type MessageQuote as Quote,
  THREAD_PAGE_SIZE,
  type ThreadDetail,
  type ThreadPage as ThreadListPage,
} from "@picks/shared";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { Avatar } from "../components/Avatar";
import { useConfirm } from "../components/ConfirmDialog";
import { TAB_BAR_OFFSET } from "../components/LeagueNav";
import { LoadError } from "../components/LoadError";
import { MessageComposer } from "../components/MessageComposer";
import { MessageQuote } from "../components/MessageQuote";
import { MessageReactions } from "../components/MessageReactions";
import { ListSkeleton } from "../components/Skeletons";
import { Badge } from "../components/ui/badge";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, Notice } from "../components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { relativeTime } from "../format";
import { announceMessagesChanged, MESSAGES_REFRESH_MS, setUnreadThreads } from "../lib/unread";
import { useAction } from "../lib/useAction";
import { usePolling } from "../lib/usePolling";
import { notifyDone, notifyError } from "../notify";
import { Link, navigate } from "../router";
import { useLoad } from "./useLoad";
import { useNow } from "./useNow";

const loadThreads = (leagueId: string, before?: string) =>
  unwrap<ThreadListPage>(
    api.leagues[":leagueId"].messages.$get({
      param: { leagueId },
      query: before ? { limit: String(THREAD_PAGE_SIZE), before } : { limit: String(THREAD_PAGE_SIZE) },
    }),
  );

export function MessagesPage({ leagueId, threadId }: { leagueId: string; threadId?: string }) {
  const base = `/leagues/${leagueId}/messages`;
  const [createdId, setCreatedId] = useState<string>();
  // Navigate after the composer has cleared its unsaved guard.
  useEffect(() => {
    if (createdId) navigate(`${base}/${createdId}`);
  }, [createdId, base]);
  if (threadId && threadId !== "new")
    return <ThreadPage key={threadId} leagueId={leagueId} threadId={threadId} />;
  if (threadId === "new")
    return (
      <Card>
        <Link
          className="flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
          to={base}
        >
          <CaretLeftIcon aria-hidden weight="bold" className="size-3.5" />
          Message board
        </Link>
        <h3 className="text-2xl">New thread</h3>
        <MessageComposer
          onSubmit={async (json) => {
            const result = await unwrap<{ id: string }>(
              api.leagues[":leagueId"].messages.$post({ param: { leagueId }, json }),
            );
            notifyDone("Thread created.");
            announceMessagesChanged();
            setCreatedId(result.id);
          }}
        />
      </Card>
    );
  return <Board leagueId={leagueId} />;
}

/**
 * The thread list. The newest page (with every pinned announcement) is fetched again every 30 seconds while
 * it is on screen, and it reports the unread count for the Messages tab. Older pages load on request and stay
 * below it; a thread bumped since shows once, at its new place.
 */
function Board({ leagueId }: { leagueId: string }) {
  const base = `/leagues/${leagueId}/messages`;
  const now = useNow();
  const list = useLoad(() => loadThreads(leagueId), leagueId);
  usePolling(list.reload, MESSAGES_REFRESH_MS);
  const unreadCount = list.data?.unreadCount;
  useEffect(() => {
    if (unreadCount !== undefined) setUnreadThreads(leagueId, unreadCount);
  }, [leagueId, unreadCount]);
  const [older, setOlder] = useState<{ threads: MessageThread[]; nextCursor: string | null }>();
  const { busy, run } = useAction<"older">();

  const first = list.data?.threads ?? [];
  const shown = new Set(first.map((t) => t.id));
  const threads = [...first, ...(older?.threads ?? []).filter((t) => !shown.has(t.id))];
  const cursor = older ? older.nextCursor : list.data?.nextCursor;

  function loadOlder() {
    if (!cursor) return;
    run("older", async () => {
      const page = await loadThreads(leagueId, cursor);
      setOlder((prev) => {
        const have = new Set(prev?.threads.map((t) => t.id));
        return {
          threads: [...(prev?.threads ?? []), ...page.threads.filter((t) => !have.has(t.id))],
          nextCursor: page.nextCursor,
        };
      });
    });
  }

  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl">Message board</h3>
        <Link className={buttonVariants({ size: "sm" })} to={`${base}/new`}>
          <PlusIcon aria-hidden weight="bold" className="size-4" />
          New thread
        </Link>
      </div>
      {list.error && !list.data && <LoadError message={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <ListSkeleton label="Loading messages" rows={3} />}
      {list.data && threads.length === 0 && <Card>No threads yet. Start the conversation.</Card>}
      {threads.length > 0 && (
        <ul className="m-0 grid list-none divide-y divide-border overflow-hidden rounded-xl bg-card p-0">
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                to={`${base}/${t.id}`}
                className="flex items-start gap-3 p-4 text-foreground no-underline transition-colors hover:bg-raised"
              >
                <Avatar name={t.authorName} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex items-center gap-2">
                    <span className={cn("min-w-0 break-words", t.unread ? "font-semibold" : "font-medium")}>
                      {t.title}
                    </span>
                    {t.unread && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-primary">
                        <span aria-hidden className="size-2 rounded-full bg-primary" />
                        Unread
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t.authorName} · {t.version - 1} {t.version === 2 ? "reply" : "replies"}
                  </span>
                  {t.pinned && <Badge className="mt-1">Pinned announcement</Badge>}
                </span>
                <time dateTime={t.updatedAt} className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(t.updatedAt, now)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <Button type="button" variant="secondary" disabled={!!busy} onClick={loadOlder}>
          {busy ? "Loading…" : "Load older threads"}
        </Button>
      )}
    </section>
  );
}

function ThreadPage({ leagueId, threadId }: { leagueId: string; threadId: string }) {
  const param = { leagueId, threadId };
  const endpoint = api.leagues[":leagueId"].messages[":threadId"];
  const now = useNow();
  const thread = useLoad(() => unwrap<ThreadDetail>(endpoint.$get({ param })), threadId);
  const { busy: pinning, run } = useAction<"pin">();
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [quote, setQuote] = useState<Quote>();
  const [replyBusy, setReplyBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const version = thread.data?.version;
  const { setData } = thread;
  // Unmount the reply composer first so its unsaved guard clears before leaving a deleted thread.
  useEffect(() => {
    if (deleted) navigate(`/leagues/${leagueId}/messages`);
  }, [deleted, leagueId]);
  useEffect(() => {
    if (!version) return;
    const markRead = () => {
      if (document.visibilityState !== "visible") return;
      unwrap(
        api.leagues[":leagueId"].messages[":threadId"].read.$post({
          param: { leagueId, threadId },
          json: { version },
        }),
      ).then(
        () => {
          setReadError("");
          announceMessagesChanged();
        },
        (err) => setReadError(messageOf(err)),
      );
    };
    markRead();
    document.addEventListener("visibilitychange", markRead);
    return () => document.removeEventListener("visibilitychange", markRead);
  }, [version, leagueId, threadId]);
  // New replies arrive on their own: every 30 seconds while the thread is on screen, and on returning to it.
  // A failed refresh is left alone; the next one tries again.
  usePolling(() => {
    unwrap<ThreadDetail>(
      api.leagues[":leagueId"].messages[":threadId"].$get({ param: { leagueId, threadId } }),
    ).then(setData, () => {});
  }, MESSAGES_REFRESH_MS);

  function togglePin() {
    const current = thread.data;
    if (!current) return;
    const pinned = !current.pinned;
    run(
      "pin",
      async () => {
        const result = await unwrap<{ pinned: boolean }>(endpoint.pin.$put({ param, json: { pinned } }));
        thread.setData((data) => data && { ...data, pinned: result.pinned });
      },
      pinned ? "Announcement pinned." : "Announcement unpinned.",
    );
  }

  async function deleteThread() {
    if (!thread.data || deleting || replyBusy) return;
    if (
      !(await confirm({
        title: `Delete “${thread.data.title}”?`,
        detail:
          "This permanently deletes the thread, all replies and reactions, and any unsent reply. This can't be undone.",
        action: "Delete thread",
      }))
    )
      return;
    setDeleting(true);
    try {
      await unwrap(endpoint.$delete({ param }));
      setDeleted(true);
      notifyDone("Thread deleted.");
      announceMessagesChanged();
    } catch (err) {
      notifyError(messageOf(err));
      setDeleting(false);
    }
  }

  return (
    <section className="grid gap-3">
      {confirmDialog}
      <Link
        className="flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
        to={`/leagues/${leagueId}/messages`}
      >
        <CaretLeftIcon aria-hidden weight="bold" className="size-3.5" />
        Message board
      </Link>
      {thread.error && !thread.data && <LoadError message={thread.error} onRetry={thread.reload} />}
      {readError && <Notice kind="alert">Could not mark this thread read: {readError}</Notice>}
      {thread.data ? (
        <>
          <div className="flex items-start gap-2">
            <div className="grid min-w-0 flex-1 gap-2">
              {thread.data.pinned && (
                <Badge>
                  <PushPinIcon aria-hidden weight="fill" className="size-3.5" />
                  Pinned announcement
                </Badge>
              )}
              <h3 className="text-2xl break-words">{thread.data.title}</h3>
            </div>
            {(thread.data.canPin || thread.data.canDelete) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size={deleting ? "default" : "icon"}
                    aria-label={deleting ? "Deleting…" : `Options for ${thread.data.title}`}
                    className="-mt-1 rounded-full text-muted-foreground hover:text-foreground"
                    disabled={!!pinning || deleting || replyBusy}
                  >
                    {deleting ? "Deleting…" : <DotsThreeIcon aria-hidden weight="bold" className="size-6" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {thread.data.canPin && (
                    <DropdownMenuItem onSelect={togglePin}>
                      <PushPinIcon aria-hidden />
                      {thread.data.pinned ? "Unpin announcement" : "Pin announcement"}
                    </DropdownMenuItem>
                  )}
                  {thread.data.canDelete && (
                    <DropdownMenuItem variant="destructive" onSelect={deleteThread}>
                      <TrashIcon aria-hidden />
                      Delete thread
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {thread.data.posts.map((p) => (
            <Card
              key={p.id}
              id={`message-${p.id}`}
              tabIndex={-1}
              aria-label={`Message ${p.position} by ${p.authorName}`}
              className="gap-3"
            >
              <p className="m-0 flex items-center gap-2.5 text-sm">
                <Avatar name={p.authorName} />
                <span className="font-semibold">{p.authorName}</span>
                <time dateTime={p.createdAt} className="text-muted-foreground">
                  {relativeTime(p.createdAt, now)}
                </time>
              </p>
              {p.quote && <MessageQuote quote={p.quote} />}
              <p className="m-0 whitespace-pre-wrap break-words">{p.body}</p>
              <div className="-my-1.5 flex flex-wrap items-center gap-x-2">
                <MessageReactions
                  reactions={p.reactions}
                  onChange={async (emoji, active) => {
                    const reactions = await unwrap<MessageReaction[]>(
                      endpoint.posts[":postId"].reactions.$put({
                        param: { ...param, postId: p.id },
                        json: { emoji, active },
                      }),
                    );
                    thread.setData(
                      (current) =>
                        current && {
                          ...current,
                          posts: current.posts.map((post) =>
                            post.id === p.id ? { ...post, reactions } : post,
                          ),
                        },
                    );
                  }}
                />
                <Button
                  variant="ghost"
                  className="ml-auto gap-1.5 px-2 text-sm font-medium text-muted-foreground hover:text-foreground"
                  aria-label={`Quote message ${p.position} by ${p.authorName}`}
                  disabled={replyBusy || deleting}
                  onClick={() => setQuote({ id: p.id, authorName: p.authorName, body: p.body })}
                >
                  <ArrowBendUpLeftIcon aria-hidden className="size-4" />
                  Quote reply
                </Button>
              </div>
            </Card>
          ))}
          {/* Always on screen, like a chat app, so replying never means scrolling to the end. */}
          <div
            className={cn(
              "sticky z-30 -mx-4 border-t bg-chrome/90 px-4 py-3 backdrop-blur-md",
              TAB_BAR_OFFSET,
            )}
          >
            {!deleted && (
              <MessageComposer
                reply
                disabled={deleting}
                quote={quote}
                onCancelQuote={() => setQuote(undefined)}
                onSubmit={async (json) => {
                  setReplyBusy(true);
                  try {
                    await unwrap(
                      endpoint.replies.$post({ param, json: { body: json.body, quotedPostId: quote?.id } }),
                    );
                    setQuote(undefined);
                    notifyDone("Reply posted.");
                    thread.reload();
                    announceMessagesChanged();
                  } finally {
                    setReplyBusy(false);
                  }
                }}
              />
            )}
          </div>
        </>
      ) : (
        !thread.error && <ListSkeleton label="Loading thread" rows={3} />
      )}
    </section>
  );
}
