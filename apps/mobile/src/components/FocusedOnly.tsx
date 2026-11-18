import { useIsFocused } from "expo-router";
import type { ReactElement } from "react";
import { View } from "react-native";

/**
 * A navigator's `screenLayout` for the web build, which shows one screen at a time:
 * `screenLayout={({ children }) => <FocusedOnly>{children}</FocusedOnly>}`. A phone's navigators keep earlier
 * screens (and visited tabs) alive for the back gesture and the tab bar, but in a browser those hidden copies
 * would stay in the page (duplicate headings and forms, stale content for screen readers). Coming back
 * re-renders the screen, which draws from the load cache and reloads. Used by the root stack, a league's tabs
 * and its Messages stack. A screen's layout sits inside its route, so it reads the route's focus.
 */
export function FocusedOnly({ children }: { children: ReactElement }) {
  return useIsFocused() ? children : <View />;
}
