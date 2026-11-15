import { ArrowBendUpLeftIcon, PlusIcon } from "@phosphor-icons/react";
import type { MessageReaction, MessageThread, MessageQuote as Quote, ThreadDetail } from "@picks/shared";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { Avatar } from "../components/Avatar";
import { useUnsavedGuard } from "../components/ConfirmDialog";
import { MessageQuote } from "../components/MessageQuote";
import { MessageReactions } from "../components/MessageReactions";
import { Badge } from "../components/ui/badge";
import { Button, buttonVariants } from "../components/ui/button";
import { Card, Notice } from "../components/ui/card";
import { Field, fieldClass, Input } from "../components/ui/input";
import { relativeTime } from "../format";
import { notifyDone, notifyError } from "../notify";
import { Link, navigate } from "../router";
import { useLoad } from "./useLoad";
import { useNow } from "./useNow";

export function MessageComposer({
  initialTitle = "",
  initialBody = "",
  reply = false,
  quote,
  onCancelQuote,
  onSubmit,
}: {
  initialTitle?: string;
  initialBody?: string;
  reply?: boolean;
  quote?: Quote;
  onCancelQuote?: () => void;
  onSubmit: (value: { title: string; body: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const replyInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (quote?.id) replyInput.current?.focus();
  }, [quote?.id]);
  const guard = useUnsavedGuard(!!(title || body || quote), "message edits");
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await onSubmit({ title, body });
          setTitle("");
          setBody("");
        } catch (err) {
          setError(messageOf(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {guard}
      {!reply && (
        <Field label="Thread title">
          <Input
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
          />
        </Field>
      )}
      {quote && (
        <section className="grid gap-2" aria-label="Reply quote preview">
          <MessageQuote quote={quote} />
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancelQuote}>
            Remove quote
          </Button>
        </section>
      )}
      <Field label={reply ? "Reply" : "Message"}>
        <textarea
          ref={replyInput}
          aria-label={reply ? "Reply" : "Message"}
          className={`${fieldClass} min-h-32 py-3`}
          required
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy}
        />
      </Field>
      {error && <Notice kind="alert">{error}</Notice>}
      <Button disabled={busy || !body.trim() || (!reply && !title.trim())}>
        {busy ? "Posting…" : reply ? "Post reply" : "Create thread"}
      </Button>
    </form>
  );
}

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
        <Link to={base}>‹ Message board</Link>
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
      {!list.data && !list.error && <p>Loading messages…</p>}
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
  const [refreshing, setRefreshing] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [quote, setQuote] = useState<Quote>();
  const [replyBusy, setReplyBusy] = useState(false);
  const [readError, setReadError] = useState("");
  useEffect(() => {
    const version = thread.data?.version;
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
  }, [thread.data, leagueId, threadId]);
  return (
    <section className="grid gap-3">
      <Link className="flex min-h-11 items-center" to={`/leagues/${leagueId}/messages`}>
        ‹ Message board
      </Link>
      {thread.error && <Notice kind="alert">{thread.error}</Notice>}
      {readError && <Notice kind="alert">Could not mark this thread read: {readError}</Notice>}
      {thread.data ? (
        <>
          <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
            <div className="grid min-w-0 gap-2">
              {thread.data.pinned && <Badge>Pinned announcement</Badge>}
              <h3 className="text-2xl break-words">{thread.data.title}</h3>
            </div>
            {thread.data.canPin && (
              <Button
                variant="outline"
                disabled={pinning}
                onClick={async () => {
                  setPinning(true);
                  try {
                    const result = await unwrap<{ pinned: boolean }>(
                      endpoint.pin.$put({
                        param,
                        json: { pinned: !thread.data?.pinned },
                      }),
                    );
                    thread.setData((current) => current && { ...current, pinned: result.pinned });
                    notifyDone(result.pinned ? "Announcement pinned." : "Announcement unpinned.");
                  } catch (err) {
                    notifyError(messageOf(err));
                  } finally {
                    setPinning(false);
                  }
                }}
              >
                {pinning ? "Saving…" : thread.data.pinned ? "Unpin announcement" : "Pin announcement"}
              </Button>
            )}
          </div>
          {thread.data.posts.map((p) => (
            <Card
              key={p.id}
              id={`message-${p.id}`}
              tabIndex={-1}
              aria-label={`Message ${p.position} by ${p.authorName}`}
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
                  className="ml-auto gap-1.5 px-2 font-sans text-sm font-medium tracking-normal text-muted-foreground normal-case hover:text-foreground"
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
          <Button
            variant="outline"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              try {
                thread.setData(await unwrap<ThreadDetail>(endpoint.$get({ param })));
              } catch (err) {
                notifyError(messageOf(err));
              } finally {
                setRefreshing(false);
              }
            }}
          >
            {refreshing ? "Refreshing…" : "Refresh replies"}
          </Button>
          <Card>
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
          </Card>
        </>
      ) : (
        !thread.error && <p>Loading thread…</p>
      )}
    </section>
  );
}
