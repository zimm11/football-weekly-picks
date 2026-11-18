/** What a confirmation asks: a title, an optional line under it, and the confirming button's words. */
export type ConfirmPrompt = { title: string; message?: string; confirmLabel?: string; destructive?: boolean };

type Presenter = (prompt: ConfirmPrompt) => Promise<boolean>;
let present: Presenter | undefined;

/**
 * Asks the player to confirm, in the app's own dialog (`DialogProvider` in `lib/dialogs.tsx` draws it), and
 * resolves true when they do. Resolves false when they cancel, or when no dialog is mounted.
 *
 * This file has no interface code on purpose: anything may import it (the unsaved-work guard, a link)
 * without pulling in the components the dialog is drawn with.
 */
export function showConfirm(prompt: ConfirmPrompt): Promise<boolean> {
  return present?.(prompt) ?? Promise.resolve(false);
}

/** The mounted dialog registers itself here; returns how to take it away again. */
export function setConfirmPresenter(presenter: Presenter) {
  present = presenter;
  return () => {
    if (present === presenter) present = undefined;
  };
}
