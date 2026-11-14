import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

export type Credentials = { email: string; password: string };
export type SignInMode = "sign-in" | "sign-up";

type Props = {
  /** Resolves to an error message, or undefined on success. */
  onSubmit: (mode: SignInMode, credentials: Credentials) => Promise<string | undefined>;
  /** Emails a password reset link. Resolves to an error message, or undefined once the email is sent. */
  onResetRequest: (email: string) => Promise<string | undefined>;
  /** Start on the "forgot password" step, e.g. after following an expired reset link. */
  startForgot?: boolean;
  /** A problem to show before the user has done anything, e.g. an expired reset link. */
  initialError?: string;
};

export function SignInForm({ onSubmit, onResetRequest, startForgot = false, initialError }: Props) {
  const [forgot, setForgot] = useState(startForgot);
  const [email, setEmail] = useState("");
  const [error, setError] = useState(initialError);
  const [sentTo, setSentTo] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode: SignInMode = submitter?.value === "sign-up" ? "sign-up" : "sign-in";
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(await onSubmit(mode, { email, password: String(form.get("password")) }));
    setPending(false);
  }

  async function requestReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setSentTo(undefined);
    const failure = await onResetRequest(email);
    setError(failure);
    if (!failure) setSentTo(email);
    setPending(false);
  }

  function switchTo(next: boolean) {
    setForgot(next);
    setError(undefined);
    setSentTo(undefined);
  }

  const emailField = (
    <Field label="Email">
      <Input
        name="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
    </Field>
  );

  if (forgot) {
    return (
      <form onSubmit={requestReset} className="grid gap-4">
        <p className="m-0 text-muted-foreground">
          Enter the email you signed up with and we'll send you a link to choose a new password.
        </p>
        {emailField}
        {error && <Notice kind="alert">{error}</Notice>}
        {sentTo && (
          <Notice kind="status">
            If there's an account for {sentTo}, a reset link is on its way. Check your inbox.
          </Notice>
        )}
        <div className="grid gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : sentTo ? "Send again" : "Send reset link"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => switchTo(false)}>
            Back to sign in
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handle} className="grid gap-4">
      {emailField}
      <div className="grid gap-1">
        <Field label="Password">
          <Input name="password" type="password" required minLength={6} autoComplete="current-password" />
        </Field>
        <Button
          type="button"
          variant="link"
          className="min-h-11 justify-self-end"
          onClick={() => switchTo(true)}
        >
          Forgot password?
        </Button>
      </div>
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
