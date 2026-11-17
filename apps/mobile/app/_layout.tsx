import { useFonts } from "expo-font";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { type ReactElement, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppHeader } from "../src/components/AppHeader";
import { GestureRoot } from "../src/components/GestureRoot";
import { HomeScreenOffer } from "../src/components/HomeScreenInstall";
import { Splash } from "../src/components/Splash";
import { colors, ErrorMessage, Screen } from "../src/components/ui";
import { AuthProvider } from "../src/lib/auth";
import { DialogProvider } from "../src/lib/dialogs";
import { NotificationBanner } from "../src/lib/notify";

const web = Platform.OS === "web";

/**
 * The web build shows one screen at a time. A phone's stack keeps earlier screens alive
 * for the back gesture, but in a browser those hidden copies would stay in the page (duplicate forms, stale
 * content for screen readers). Going back re-renders the earlier screen, which reloads its data.
 */
function FocusedOnly({
  navigation,
  children,
}: {
  navigation: {
    isFocused: () => boolean;
    addListener: (event: "focus" | "blur", listener: () => void) => () => void;
  };
  children: ReactElement;
}) {
  const [focused, setFocused] = useState(navigation.isFocused());
  useEffect(() => {
    const offFocus = navigation.addListener("focus", () => setFocused(true));
    const offBlur = navigation.addListener("blur", () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  return focused ? children : <View />;
}

const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.chrome,
    text: colors.foreground,
    border: colors.border,
    notification: colors.primary,
  },
};
/**
 * Barlow and Barlow Condensed (SIL Open Font License, `assets/fonts/OFL.txt`), copied out of
 * `@expo-google-fonts/*`: the web export serves an asset from where it lives, and a path under
 * `node_modules/.pnpm/@scope+name@version/` makes Cloudflare redirect every font request once.
 */
const fonts = {
  Barlow: require("../assets/fonts/Barlow_400Regular.ttf"),
  BarlowMedium: require("../assets/fonts/Barlow_500Medium.ttf"),
  BarlowSemiBold: require("../assets/fonts/Barlow_600SemiBold.ttf"),
  BarlowCondensed: require("../assets/fonts/BarlowCondensed_700Bold.ttf"),
  BarlowCondensedSemibold: require("../assets/fonts/BarlowCondensed_600SemiBold.ttf"),
  BarlowCondensedExtraBold: require("../assets/fonts/BarlowCondensed_800ExtraBold.ttf"),
};

export default function Layout() {
  const [loaded, error] = useFonts(fonts);
  if (error)
    return (
      <SafeAreaProvider>
        <Screen>
          <ErrorMessage message="The app fonts couldn’t load. Close and reopen POW Pick’em." />
        </Screen>
      </SafeAreaProvider>
    );
  if (!loaded)
    return (
      <SafeAreaProvider>
        <Splash />
      </SafeAreaProvider>
    );
  return (
    <GestureRoot style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={theme}>
          <AuthProvider>
            <DialogProvider>
              <StatusBar style="light" />
              {/* On the web, one header above whichever screen is showing; on a phone, each screen's own. */}
              {web && <AppHeader />}
              <Stack
                screenOptions={{
                  headerShown: !web,
                  header: () => <AppHeader />,
                  contentStyle: { backgroundColor: colors.background },
                }}
                screenLayout={
                  web
                    ? ({ children, navigation }) => (
                        <FocusedOnly navigation={navigation}>{children}</FocusedOnly>
                      )
                    : undefined
                }
              >
                <Stack.Screen name="index" options={{ title: "Your leagues" }} />
                <Stack.Screen name="account" options={{ title: "Settings" }} />
                <Stack.Screen name="how-to-play" options={{ title: "How to play" }} />
                <Stack.Screen name="terms" options={{ title: "Terms of use" }} />
              </Stack>
              <NotificationBanner />
              {web && <HomeScreenOffer />}
            </DialogProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureRoot>
  );
}
