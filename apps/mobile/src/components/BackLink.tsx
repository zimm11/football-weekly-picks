import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { confirmDiscard } from "../lib/unsaved";
import { Icon } from "./Icon";
import { colors, fonts } from "./theme";

/**
 * "‹ Back" at the top of a screen outside a league (Settings, How to play). It returns to
 * the previous screen, or to Your leagues when the screen was opened directly (from a link or notification).
 */
export function BackLink({ fallbackLabel = "Your leagues" }: { fallbackLabel?: string }) {
  const back = router.canGoBack();
  return (
    <View style={{ marginTop: -12, marginBottom: -8 }}>
      <Pressable
        accessibilityRole="link"
        onPress={async () => {
          if (back) router.back();
          else if (await confirmDiscard()) router.replace("/");
        }}
        style={{ minHeight: 44, alignSelf: "flex-start", flexDirection: "row", gap: 4, alignItems: "center" }}
      >
        <Icon name="arrow-left" size={14} color={colors.mutedForeground} />
        <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.mutedForeground }}>
          {back ? "Back" : fallbackLabel}
        </Text>
      </Pressable>
    </View>
  );
}
