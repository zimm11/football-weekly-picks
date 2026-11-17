import type { ReactNode } from "react";
import { Text } from "react-native";
import { colors, fonts } from "./theme";

/** A Settings card's title: the Eyebrow look, announced as a heading (web's `h4` card titles). */
export function SettingsHeading({ children }: { children: ReactNode }) {
  return (
    <Text
      role="heading"
      aria-level={4}
      style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.mutedForeground }}
    >
      {children}
    </Text>
  );
}
