import { Stack } from "expo-router";
import { Platform } from "react-native";
import { FocusedOnly } from "../../../../src/components/FocusedOnly";
import { colors } from "../../../../src/components/ui";

const web = Platform.OS === "web";

// On iPhone a thread opened straight from a link or a notification gets the board under it, so Back goes to the
// board (and from there, out of the league). A browser has its own history, and stays as it was.
export const unstable_settings = web ? {} : { anchor: "index" };

/**
 * The Messages tab: the board, with a thread (or the New thread form) pushed on top. On iPhone the board stays
 * mounted under a thread, so Back returns to it as it was; the league's tab bar stays below both.
 */
export default function MessagesLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      screenLayout={web ? ({ children }) => <FocusedOnly>{children}</FocusedOnly> : undefined}
    />
  );
}
