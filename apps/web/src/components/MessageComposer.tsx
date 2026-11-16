import { ArrowBendUpLeftIcon, PaperPlaneRightIcon, XIcon } from "@phosphor-icons/react";
import type { MessageQuote as Quote } from "@picks/shared";
import { useEffect, useRef, useState } from "react";
import { messageOf } from "../api";
import { useUnsavedGuard } from "./ConfirmDialog";
import { Button } from "./ui/button";
import { Notice } from "./ui/card";
import { Field, fieldClass, Input } from "./ui/input";

/** Starts a thread, or (with `reply`) writes a reply, optionally quoting an earlier message. */
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
  // The reply box starts one line tall and grows with what is typed, up to a few lines.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `body` is what changes the height to measure.
  useEffect(() => {
    const box = replyInput.current;
    if (!reply || !box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [reply, body]);
  const submitting = async () => {
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
  };
  if (reply) {
    return (
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitting();
        }}
      >
        {guard}
        {quote && (
          <section
            aria-label="Reply quote preview"
            className="flex items-center gap-2 rounded-lg bg-raised py-1 pr-1 pl-3 text-sm"
          >
            <ArrowBendUpLeftIcon aria-hidden className="size-4 shrink-0 text-primary" />
            <p className="m-0 min-w-0 flex-1 truncate">
              <span className="font-semibold">{quote.authorName} wrote:</span>{" "}
              <span className="text-muted-foreground">{quote.body}</span>
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove quote"
              className="size-9 rounded-full"
              disabled={busy}
              onClick={onCancelQuote}
            >
              <XIcon aria-hidden className="size-4" />
            </Button>
          </section>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={replyInput}
            aria-label="Reply"
            placeholder="Write a reply…"
            rows={1}
            className={`${fieldClass} min-h-11 resize-none rounded-2xl py-2.5`}
            required
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy}
          />
          <Button
            aria-label={busy ? "Posting…" : "Post reply"}
            size="icon"
            className="rounded-full"
            disabled={busy || !body.trim()}
          >
            <PaperPlaneRightIcon aria-hidden weight="fill" />
          </Button>
        </div>
        {error && <Notice kind="alert">{error}</Notice>}
      </form>
    );
  }
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        submitting();
      }}
    >
      {guard}
      <Field label="Thread title">
        <Input
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={busy}
        />
      </Field>
      <Field label="Message">
        <textarea
          aria-label="Message"
          className={`${fieldClass} min-h-32 py-3`}
          required
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy}
        />
      </Field>
      {error && <Notice kind="alert">{error}</Notice>}
      <Button disabled={busy || !body.trim() || !title.trim()}>{busy ? "Posting…" : "Create thread"}</Button>
    </form>
  );
}
