import { router } from "expo-router";
import { Text, View } from "react-native";
import { webTransition } from "../lib/motion";
import { AppLink, openPath } from "./AppLink";
import { Icon } from "./Icon";
import { pressState } from "./pressState";
import { colors, fonts } from "./theme";

/**
 * "‹ Back" at the top of a screen outside a league (Settings, How to play). It returns to
 * the previous screen, or to Your leagues when the screen was opened directly (from a link or notification).
 * A real link to Your leagues either way, so the keyboard and "open in new tab" work.
 */
export function BackLink({ fallbackLabel = "Your leagues" }: { fallbackLabel?: string }) {
  const back = router.canGoBack();
  return (
    <View style={{ marginTop: -12, marginBottom: -8 }}>
      <AppLink
        href="/"
        // Going back is guarded by the screen's own unsaved-work guard; the fallback asks here.
        onPress={() => (back ? router.back() : void openPath("/", "replace"))}
        style={({ pressed }) => ({
          minHeight: 44,
          alignSelf: "flex-start",
          flexDirection: "row",
          gap: 4,
          alignItems: "center",
          opacity: pressed ? 0.7 : 1,
          ...webTransition(["opacity"]),
        })}
      >
        {(state) => {
          const ink = pressState(state).hovered ? colors.foreground : colors.mutedForeground;
          return (
            <>
              <Icon name="arrow-left" size={14} color={ink} />
              <Text
                style={{ fontFamily: fonts.medium, fontSize: 14, color: ink, ...webTransition(["color"]) }}
              >
                {back ? "Back" : fallbackLabel}
              </Text>
            </>
          );
        }}
      </AppLink>
    </View>
  );
}
