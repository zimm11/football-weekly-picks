import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

type Props = {
  /** Resolves to an error message, or undefined on success. */
  onSubmit: (password: string) => Promise<string | undefined>;
  onCancel?: () => void;
};

/** Sets a new password for the signed-in account, after a reset link or from the account menu. */
export function NewPasswordForm({ onSubmit, onCancel }: Props) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) return setError("The passwords don't match.");
    setPending(true);
    setError(await onSubmit(password));
    setPending(false);
  }

  return (
    <form onSubmit={handle} className="grid gap-4">
      <Field label="New password">
        <Input name="password" type="password" required minLength={6} autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password">
        <Input name="confirm" type="password" required minLength={6} autoComplete="new-password" />
      </Field>
      {error && <Notice kind="alert">{error}</Notice>}
      <div className="grid gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save password"}
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
