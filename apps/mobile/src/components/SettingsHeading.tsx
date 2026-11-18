import type { ReactNode } from "react";
import { Text } from "react-native";
import { colors, fonts } from "./theme";

/**
 * A Settings card's title: the Eyebrow look, announced as a heading. `level` is its place in the page's outline:
 * 2 for a card of its own under the page's title, 3 for a card inside a section (Notifications → By email).
 */
export function SettingsHeading({ children, level = 2 }: { children: ReactNode; level?: 2 | 3 }) {
  return (
    <Text
      role="heading"
      aria-level={level}
      style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.mutedForeground }}
    >
      {children}
    </Text>
  );
}
