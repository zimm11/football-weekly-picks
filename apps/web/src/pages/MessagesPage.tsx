import {
  ArrowBendUpLeftIcon,
  CaretLeftIcon,
  DotsThreeIcon,
  PlusIcon,
  PushPinIcon,
} from "@phosphor-icons/react";
import type { MessageReaction, MessageThread, MessageQuote as Quote, ThreadDetail } from "@picks/shared";
import { cn } from "cn";
import { useEffect, useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { Avatar } from "../components/Avatar";
import { TAB_BAR_OFFSET } from "../components/LeagueNav";
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
import { notifyDone, notifyError } from "../notify";
import { Link, navigate } from "../router";
import { useLoad } from "./useLoad";
import { useNow } from "./useNow";

export function MessagesPage({ leagueId, threadId }: { leagueId: string; threadId?: string }) {
  const base = `/leagues/${leagueId}/messages`;
  const now = useNow();
  const [createdId, setCreatedId] = useState<string>();
  // Navigate after the composer has cleared its unsaved guard.
  useEffect(() => {
    if (createdId) navigate(`${base}/${createdId}`);
  }, [createdId, base]);
  const list = useLoad(
    () => unwrap<MessageThread[]>(api.leagues[":leagueId"].messages.$get({ param: { leagueId } })),
    leagueId,
  );
  useEffect(() => {
    const timer = setInterval(list.reload, 30000);
    return () => clearInterval(timer);
  }, [list.reload]);
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
            window.dispatchEvent(new Event("messages-changed"));
            setCreatedId(result.id);
          }}
        />
      </Card>
    );
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl">Message board</h3>
        <Link className={buttonVariants({ size: "sm" })} to={`${base}/new`}>
          <PlusIcon aria-hidden weight="bold" className="size-4" />
          New thread
        </Link>
      </div>
      {list.error && <Notice kind="alert">{list.error}</Notice>}
      {!list.data && !list.error && <ListSkeleton label="Loading messages" rows={3} />}
      {list.data?.length === 0 && <Card>No threads yet. Start the conversation.</Card>}
      {!!list.data?.length && (
        <ul className="m-0 grid list-none divide-y divide-border overflow-hidden rounded-xl bg-card p-0">
          {list.data.map((t) => (
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
    </section>
  );
}

function ThreadPage({ leagueId, threadId }: { leagueId: string; threadId: string }) {
  const param = { leagueId, threadId };
  const endpoint = api.leagues[":leagueId"].messages[":threadId"];
  const now = useNow();
  const thread = useLoad(() => unwrap<ThreadDetail>(endpoint.$get({ param })), threadId);
  const [pinning, setPinning] = useState(false);
  const [quote, setQuote] = useState<Quote>();
  const [replyBusy, setReplyBusy] = useState(false);
  const [readError, setReadError] = useState("");
  const version = thread.data?.version;
  const { setData } = thread;
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
          window.dispatchEvent(new Event("messages-changed"));
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
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      unwrap<ThreadDetail>(
        api.leagues[":leagueId"].messages[":threadId"].$get({ param: { leagueId, threadId } }),
      ).then(setData, () => {});
    };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [leagueId, threadId, setData]);

  async function togglePin() {
    if (!thread.data) return;
    setPinning(true);
    try {
      const result = await unwrap<{ pinned: boolean }>(
        endpoint.pin.$put({ param, json: { pinned: !thread.data.pinned } }),
      );
      thread.setData((current) => current && { ...current, pinned: result.pinned });
      notifyDone(result.pinned ? "Announcement pinned." : "Announcement unpinned.");
    } catch (err) {
      notifyError(messageOf(err));
    } finally {
      setPinning(false);
    }
  }

  return (
    <section className="grid gap-3">
      <Link
        className="flex min-h-11 w-fit items-center gap-1 text-sm font-medium text-muted-foreground no-underline hover:text-foreground"
        to={`/leagues/${leagueId}/messages`}
      >
        <CaretLeftIcon aria-hidden weight="bold" className="size-3.5" />
        Message board
      </Link>
      {thread.error && <Notice kind="alert">{thread.error}</Notice>}
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
            {thread.data.canPin && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Thread options"
                    className="-mt-1 rounded-full text-muted-foreground hover:text-foreground"
                    disabled={pinning}
                  >
                    <DotsThreeIcon aria-hidden weight="bold" className="size-6" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={togglePin}>
                    <PushPinIcon aria-hidden />
                    {thread.data.pinned ? "Unpin announcement" : "Pin announcement"}
                  </DropdownMenuItem>
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
                  disabled={replyBusy}
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
            <MessageComposer
              reply
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
                  window.dispatchEvent(new Event("messages-changed"));
                } finally {
                  setReplyBusy(false);
                }
              }}
            />
          </div>
        </>
      ) : (
        !thread.error && <ListSkeleton label="Loading thread" rows={3} />
      )}
    </section>
  );
}
