import { type FormEvent, useState } from "react";

type Props = {
  initialName?: string;
  submitLabel?: string;
  /** Resolves to an error message, or undefined on success. */
  onSubmit: (displayName: string) => Promise<string | undefined>;
};

/** Asks for the name a player is shown under on leaderboards. */
export function NameForm({ initialName = "", submitLabel = "Continue", onSubmit }: Props) {
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
    <form onSubmit={handle} className="stack" style={{ maxWidth: 320 }}>
      <label>
        Display name
        <input
          name="displayName"
          defaultValue={initialName}
          maxLength={40}
          required
          autoComplete="nickname"
        />
      </label>
      <button type="submit" className="primary" disabled={pending}>
        {submitLabel}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
