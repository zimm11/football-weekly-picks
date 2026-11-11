import { type FormEvent, useState } from "react";

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
    <form onSubmit={handle} className="stack" style={{ maxWidth: 320 }}>
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" />
      </label>
      <label>
        Password
        <input name="password" type="password" required minLength={6} autoComplete="current-password" />
      </label>
      <button type="submit" value="sign-in" className="primary" disabled={pending}>
        Sign in
      </button>
      <button type="submit" value="sign-up" disabled={pending}>
        Create account
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
