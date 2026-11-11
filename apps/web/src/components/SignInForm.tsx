import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

export type Credentials = { email: string; password: string };
export type SignInMode = "sign-in" | "sign-up";

type Props = {
  /** Resolves to an error message, or undefined on success. */
  onSubmit: (mode: SignInMode, credentials: Credentials) => Promise<string | undefined>;
};

export function SignInForm({ onSubmit }: Props) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode: SignInMode = submitter?.value === "sign-up" ? "sign-up" : "sign-in";
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(
      await onSubmit(mode, { email: String(form.get("email")), password: String(form.get("password")) }),
    );
    setPending(false);
  }

  return (
    <form onSubmit={handle} className="grid gap-4">
      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" required minLength={6} autoComplete="current-password" />
      </Field>
      {error && <Notice kind="alert">{error}</Notice>}
      <div className="grid gap-2">
        <Button type="submit" value="sign-in" disabled={pending}>
          Sign in
        </Button>
        <Button type="submit" value="sign-up" variant="outline" disabled={pending}>
          Create account
        </Button>
      </div>
    </form>
  );
}
