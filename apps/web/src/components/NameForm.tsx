import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

type Props = {
  initialName?: string;
  submitLabel?: string;
  /** Resolves to an error message, or undefined on success. */
  onSubmit: (displayName: string) => Promise<string | undefined>;
  /** Shown as a way out when the player already has a name. */
  onCancel?: () => void;
};

/** Asks for the name a player is shown under on leaderboards. */
export function NameForm({ initialName = "", submitLabel = "Continue", onSubmit, onCancel }: Props) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("displayName")).trim();
    if (!name) return setError("Enter a name");
    setPending(true);
    setError(await onSubmit(name));
    setPending(false);
  }

  return (
    <form onSubmit={handle} className="grid gap-4">
      <Field label="Display name">
        <Input
          name="displayName"
          defaultValue={initialName}
          maxLength={40}
          required
          autoComplete="nickname"
        />
      </Field>
      {error && <Notice kind="alert">{error}</Notice>}
      <div className="grid gap-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
