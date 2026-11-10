import type { Example } from "@picks/shared";
import { type FormEvent, useState } from "react";

/** PLACEHOLDER component: shows a list plus an add form. Replace with real UI. */
type Props = {
  items: Example[];
  /** Resolves to an error message, or undefined on success. */
  onAdd: (title: string) => Promise<string | undefined>;
};

export function ExampleList({ items, onAdd }: Props) {
  const [error, setError] = useState<string>();

  async function handle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const title = String(new FormData(form).get("title"));
    const err = await onAdd(title);
    setError(err);
    if (!err) form.reset();
  }

  return (
    <section>
      <form onSubmit={handle} style={{ display: "flex", gap: 8 }}>
        <label>
          New item <input name="title" required />
        </label>
        <button type="submit">Add</button>
      </form>
      {error && (
        <p role="alert" style={{ color: "crimson" }}>
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p>No items yet.</p>
      ) : (
        <ul aria-label="Items">
          {items.map((item) => (
            <li key={item.id}>{item.title}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
