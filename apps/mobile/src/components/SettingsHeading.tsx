import type { ReactNode } from "react";
import { CardTitle } from "./ui";

/**
 * A Settings card's title: the app's `CardTitle`, announced as a heading. `level` is its place in the page's
 * outline: 2 for a card of its own under the page's title, 3 for a card inside a section (Notifications → By
 * email).
 */
export function SettingsHeading({ children, level = 2 }: { children: ReactNode; level?: 2 | 3 }) {
  return <CardTitle level={level}>{children}</CardTitle>;
}
