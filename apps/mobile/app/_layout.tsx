import { useFonts } from "expo-font";
import { DarkTheme, type ErrorBoundaryProps, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppHeader } from "../src/components/AppHeader";
import { ErrorScreen } from "../src/components/ErrorScreen";
import { GestureRoot } from "../src/components/GestureRoot";
import { HomeScreenOffer } from "../src/components/HomeScreenInstall";
import { Splash } from "../src/components/Splash";
import { colors, ErrorMessage, Screen } from "../src/components/ui";
import { AuthProvider, useAuth } from "../src/lib/auth";
import { DialogProvider } from "../src/lib/dialogs";
import { isTabSwap } from "../src/lib/navigation";
import { NotificationBanner } from "../src/lib/notify";

const web = Platform.OS === "web";

// The iPhone's launch screen stays up until the fonts and the session are ready (`Opening` hides it), so the
// app opens on its first real screen instead of flashing through an empty one. A no-op in a browser.
void SplashScreen.preventAutoHideAsync();
/** The longest the launch screen is held: on a slow connection the in-app splash takes over and says why. */
const LAUNCH_SCREEN_MAX_MS = 4000;

/**
 * A render error anywhere in the app shows a readable screen with Reload instead of a blank page. Expo Router
 * wraps this layout in the exported `ErrorBoundary` (it stands in for the whole app, header included), and each
 * screen under it in `screenErrorBoundary`, so a screen that fails keeps the header and the rest of the app.
 */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return (
    <SafeAreaProvider>
      <ErrorScreen {...props} />
    </SafeAreaProvider>
  );
}
export const unstable_settings = {
  screenErrorBoundary: ErrorScreen,
  // On iPhone a screen opened directly (a notification, a link) gets Your leagues under it, so Back and
  // "All leagues" have somewhere to go. A browser has its own history, and stays as it was.
  ...(web ? null : { anchor: "index" }),
};

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

/**
 * One splash from launch until the app can draw: it covers the whole window (header included) while the
 * session and profile are read for the first time, exactly where the font-loading splash was, so the wordmark
 * doesn't jump when the header arrives. Later waits (signing in, an emailed link) show inside the page, under
 * the header (`AuthGate`). The screens stay mounted underneath so the router is ready; they are hidden from
 * screen readers until the splash lifts.
 */
function Opening({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const opened = useRef(false);
  if (!auth.loading) opened.current = true;
  const opening = !opened.current;
  useEffect(() => {
    if (!opening) return SplashScreen.hide();
    const timer = setTimeout(() => SplashScreen.hide(), LAUNCH_SCREEN_MAX_MS);
    return () => clearTimeout(timer);
  }, [opening]);
  return (
    <>
      <View
        style={{ flex: 1 }}
        aria-hidden={opening}
        importantForAccessibility={opening ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {opening && (
        <View style={StyleSheet.absoluteFill}>
          <Splash name={auth.me?.displayName ?? undefined} />
        </View>
      )}
    </>
  );
}

export default function Layout() {
  const [loaded, error] = useFonts(fonts);
  useEffect(() => {
    // Nothing else will lift the launch screen if the fonts fail.
    if (error) SplashScreen.hide();
  }, [error]);
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
              <Opening>
                {/* On the web, one header above whichever screen is showing; on a phone, each screen's own. */}
                {web && <AppHeader />}
                <Stack
                  screenOptions={({ route }) => ({
                    headerShown: !web,
                    header: () => <AppHeader />,
                    contentStyle: { backgroundColor: colors.background },
                    // A league tab opened from the iPhone tab bar takes the last tab's place without a slide.
                    animation: isTabSwap(route.params) ? "none" : "default",
                  })}
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
                  <Stack.Screen name="privacy" options={{ title: "Privacy policy" }} />
                </Stack>
              </Opening>
              <NotificationBanner />
              {web && <HomeScreenOffer />}
            </DialogProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureRoot>
  );
}
