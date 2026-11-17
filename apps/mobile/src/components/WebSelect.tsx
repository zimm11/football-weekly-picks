import type { ReactElement } from "react";

export type WebSelectProps = {
  /** The accessible name ("Season"); a visible label is the caller's to show. */
  label: string;
  /** The chosen choice's value. */
  value: string;
  /** Each choice's value is what the `<select>` reports (a season reads as its year). */
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** The round season pill rather than a full-width field. */
  compact?: boolean;
};

/**
 * The browser's own `<select>`, in the web build only (WebSelect.web.tsx), with the browser's native keyboard
 * and screen-reader behavior, and the phone's own picker. The iPhone app has none and uses its dropdown menu.
 */
export const WebSelect: ((props: WebSelectProps) => ReactElement) | null = null;
