import type { ErrorBoundaryProps } from "expo-router";
import { router } from "expo-router";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { clearLoadCache } from "../lib/loadCache";
import { colors, fonts } from "./theme";

/**
 * What a player sees when a screen fails to draw (a bug, or data the app didn't expect), instead of a blank
 * navy page: what happened in plain words, **Reload**, and a way home. Expo Router renders it through the
 * boundaries in `app/_layout.tsx`. It may stand in for the whole app, outside every provider, so it uses only
 * the theme and plain React Native views: no auth, no safe-area hooks, no dialogs.
 */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const web = Platform.OS === "web";
  // Whatever was loaded may be what the screen choked on: draw again from a fresh request, not from memory.
  const again = () => {
    clearLoadCache();
    void retry();
  };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        width: "100%",
        maxWidth: 512,
        alignSelf: "center",
        paddingHorizontal: 16,
        paddingVertical: 48,
        gap: 16,
      }}
    >
      <View accessibilityRole="alert" style={{ gap: 8 }}>
        <Text
          accessibilityRole="header"
          style={{
            fontFamily: fonts.displayExtraBold,
            fontSize: 36,
            lineHeight: 36,
            letterSpacing: 0.9,
            color: colors.foreground,
            textTransform: "uppercase",
          }}
        >
          Something went wrong
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.mutedForeground }}>
          This screen couldn’t be shown. Your saved picks are safe. Reloading usually fixes it.
        </Text>
        {__DEV__ && (
          <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.destructive }}>
            {error.message}
          </Text>
        )}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Pressable
          accessibilityRole="button"
          // A browser starts the page over; the app draws the screen again.
          onPress={() => (web ? window.location.reload() : again())}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.primary,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.primaryForeground }}>
            Reload
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          {...(web ? ({ href: "/" } as object) : null)}
          onPress={(event) => {
            // In a browser the link itself loads the front page, which starts the app clean.
            if (web) return;
            event.preventDefault?.();
            router.replace("/");
            again();
          }}
          style={({ pressed }) => ({
            minHeight: 44,
            paddingHorizontal: 16,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? colors.raisedHover : colors.raised,
          })}
        >
          <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.foreground }}>
            Your leagues
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
