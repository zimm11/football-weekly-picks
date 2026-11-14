import type { NotificationSettings } from "@picks/shared";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

/** Resolves to an error message, or undefined on success. */
type Submit<T> = (value: T) => Promise<string | undefined>;

/** Starts an email change. Supabase confirms it from both the old and the new address. */
export function EmailChangeForm({
  currentEmail,
  onSubmit,
  onDirtyChange,
}: {
  currentEmail?: string;
  onSubmit: Submit<string>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next = email.trim();
    if (next.toLowerCase() === currentEmail?.toLowerCase()) return setError("That's already your email.");
    setPending(true);
    const failure = await onSubmit(next);
    setPending(false);
    setError(failure);
    if (!failure) {
      setEmail("");
      onDirtyChange?.(false);
    }
  }

  return (
    <form onSubmit={handle} className="grid gap-4" aria-label="Email address">
      <Field label="Current email">
        <Input value={currentEmail ?? ""} readOnly />
      </Field>
      <Field label="New email">
        <Input
          name="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            onDirtyChange?.(e.target.value.trim() !== "");
          }}
        />
      </Field>
      {error && <Notice kind="alert">{error}</Notice>}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Change email"}
      </Button>
    </form>
  );
}

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
      <input
        type="checkbox"
        className="mt-0.5 size-5 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="grid gap-0.5">
        <span className="leading-tight font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

/**
 * The notification emails a player can switch off. Each change saves straight away: the box shows the new
 * state at once, and `settings` (what the server confirmed, or the old value if the save failed) takes over
 * when `onChange` settles.
 */
export function NotificationSettingsForm({
  settings,
  onChange,
}: {
  settings: NotificationSettings;
  onChange: (patch: Partial<NotificationSettings>) => Promise<unknown>;
}) {
  const [saving, setSaving] = useState<Partial<NotificationSettings>>();
  const shown = { ...settings, ...saving };
  const change = async (patch: Partial<NotificationSettings>) => {
    setSaving(patch);
    await onChange(patch);
    setSaving(undefined);
  };
  return (
    <fieldset className="grid gap-2" aria-busy={!!saving}>
      <legend className="sr-only">Notification emails</legend>
      <Toggle
        label="New message threads"
        description="When someone starts a thread on one of your leagues' message boards."
        checked={shown.newThreads}
        disabled={!!saving}
        onChange={(newThreads) => change({ newThreads })}
      />
      <Toggle
        label="Pick reminders"
        description="At 7pm the evening before a game day, if you still have games to pick."
        checked={shown.pickReminders}
        disabled={!!saving}
        onChange={(pickReminders) => change({ pickReminders })}
      />
    </fieldset>
  );
}
