import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";

export type Credentials = { email: string; password: string };
export type SignInMode = "sign-in" | "sign-up";
/** An error message, `{ status }` for news that isn't a failure (check your email), or undefined on success. */
export type SignInResult = string | { status: string } | undefined;

type Props = {
  onSubmit: (mode: SignInMode, credentials: Credentials) => Promise<SignInResult>;
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
  const [pending, setPending] = useState<SignInMode | "reset">();
  const [status, setStatus] = useState<string>();

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const mode: SignInMode = submitter?.value === "sign-up" ? "sign-up" : "sign-in";
    const form = new FormData(e.currentTarget);
    setPending(mode);
    setError(undefined);
    setStatus(undefined);
    const result = await onSubmit(mode, { email, password: String(form.get("password")) });
    if (typeof result === "string") setError(result);
    else if (result) setStatus(result.status);
    setPending(undefined);
  }

  async function requestReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending("reset");
    setSentTo(undefined);
    const failure = await onResetRequest(email);
    setError(failure);
    if (!failure) setSentTo(email);
    setPending(undefined);
  }

  function switchTo(next: boolean) {
    setForgot(next);
    setError(undefined);
    setStatus(undefined);
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
          <Button type="submit" disabled={!!pending}>
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
      {status && <Notice kind="status">{status}</Notice>}
      <div className="grid gap-2">
        <Button type="submit" value="sign-in" disabled={!!pending}>
          {pending === "sign-in" ? "Signing in…" : "Sign in"}
        </Button>
        <Button type="submit" value="sign-up" variant="outline" disabled={!!pending}>
          {pending === "sign-up" ? "Creating account…" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
