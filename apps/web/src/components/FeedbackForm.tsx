import { FEEDBACK_KIND_LABELS, FEEDBACK_KINDS, FEEDBACK_MAX_LENGTH, type FeedbackKind } from "@picks/shared";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, fieldClass, NativeSelect } from "@/components/ui/input";
import { useUnsavedGuard } from "./ConfirmDialog";

type Props = {
  /** Resolves to an error message, or undefined once the feedback is sent. */
  onSubmit: (value: { kind: FeedbackKind; message: string }) => Promise<string | undefined>;
  onCancel: () => void;
};

const PROMPTS: Record<FeedbackKind, string> = {
  bug: "What happened, and what did you expect instead?",
  feature: "What would you like the app to do?",
  other: "What's on your mind?",
};

/** A bug report, feature request or note to the people who run the app. */
export function FeedbackForm({ onSubmit, onCancel }: Props) {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const guard = useUnsavedGuard(!!message.trim(), "feedback");

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(undefined);
    const failure = await onSubmit({ kind, message: message.trim() });
    // Clearing the text drops the unsaved-work guard, so the screen can move on.
    if (failure) setError(failure);
    else setMessage("");
    setPending(false);
  }

  return (
    <form onSubmit={handle} className="grid gap-4">
      {guard}
      <Field label="What kind of feedback?">
        <NativeSelect
          value={kind}
          onChange={(e) => setKind(e.target.value as FeedbackKind)}
          disabled={pending}
        >
          {FEEDBACK_KINDS.map((value) => (
            <option key={value} value={value}>
              {FEEDBACK_KIND_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label={PROMPTS[kind]}>
        <textarea
          className={`${fieldClass} min-h-40 py-3`}
          required
          maxLength={FEEDBACK_MAX_LENGTH}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={pending}
        />
      </Field>
      {error && <Notice kind="alert">{error}</Notice>}
      <div className="grid gap-2">
        <Button type="submit" disabled={pending || !message.trim()}>
          {pending ? "Sending…" : "Send feedback"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
