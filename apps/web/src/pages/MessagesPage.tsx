import type { MessageThread, ThreadDetail } from "@picks/shared";
import { useEffect, useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { useUnsavedGuard } from "../components/ConfirmDialog";
import { Button } from "../components/ui/button";
import { Card, Notice } from "../components/ui/card";
import { Field, fieldClass, Input } from "../components/ui/input";
import { notifyDone, notifyError } from "../notify";
import { Link, navigate } from "../router";
import { useLoad } from "./useLoad";

export function MessageComposer({
  initialTitle = "",
  initialBody = "",
  reply = false,
  onSubmit,
}: {
  initialTitle?: string;
  initialBody?: string;
  reply?: boolean;
  onSubmit: (value: { title: string; body: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guard = useUnsavedGuard(!!(title || body), "message edits");
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
      <Field label={reply ? "Reply" : "Message"}>
        <textarea
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
        <Link className="flex min-h-11 items-center" to={`${base}/new`}>
          New thread
        </Link>
      </div>
      <p className="m-0 text-muted-foreground">
        Conversations for everyone in your league, across all seasons.
      </p>
      {list.error && <Notice kind="alert">{list.error}</Notice>}
      {!list.data && !list.error && <p>Loading messages…</p>}
      {list.data?.length === 0 && <Card>No threads yet. Start the conversation.</Card>}
      {list.data?.map((t) => (
        <Link
          key={t.id}
          to={`${base}/${t.id}`}
          className="grid gap-1 rounded-md border bg-card p-4 no-underline hover:bg-secondary"
        >
          <span className="font-display text-xl font-bold break-words">
            {t.title} {t.unread && <span className="text-sm text-primary">Unread</span>}
          </span>
          <span className="text-sm text-muted-foreground">
            {t.authorName} · {t.version - 1} {t.version === 2 ? "reply" : "replies"} ·{" "}
            {new Date(t.updatedAt).toLocaleString()}
          </span>
        </Link>
      ))}
    </section>
  );
}

function ThreadPage({ leagueId, threadId }: { leagueId: string; threadId: string }) {
  const param = { leagueId, threadId };
  const endpoint = api.leagues[":leagueId"].messages[":threadId"];
  const thread = useLoad(() => unwrap<ThreadDetail>(endpoint.$get({ param })), threadId);
  const [refreshing, setRefreshing] = useState(false);
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
          <h3 className="text-2xl break-words">{thread.data.title}</h3>
          {thread.data.posts.map((p) => (
            <Card key={p.id}>
              <p className="m-0 text-sm text-muted-foreground">
                {p.authorName} · {new Date(p.createdAt).toLocaleString()}
              </p>
              <p className="m-0 whitespace-pre-wrap break-words">{p.body}</p>
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
              onSubmit={async (json) => {
                await unwrap(endpoint.replies.$post({ param, json: { body: json.body } }));
                notifyDone("Reply posted.");
                thread.reload();
                window.dispatchEvent(new Event("messages-changed"));
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
