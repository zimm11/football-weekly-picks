import { useFonts } from "expo-font";
import { DarkTheme, type ErrorBoundaryProps, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppHeader } from "../src/components/AppHeader";
import { ErrorScreen } from "../src/components/ErrorScreen";
import { FocusedOnly } from "../src/components/FocusedOnly";
import { GestureRoot } from "../src/components/GestureRoot";
import { HomeScreenOffer } from "../src/components/HomeScreenInstall";
import { Splash } from "../src/components/Splash";
import { colors, ErrorMessage, Screen } from "../src/components/ui";
import { AuthProvider, useAuth } from "../src/lib/auth";
import { DialogProvider } from "../src/lib/dialogs";
import { duration, easing, nativeDriver, useReducedMotion } from "../src/lib/motion";
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
 * screen readers until opening ends. Then the splash fades away over the first screen, letting clicks through
 * at once, and is gone (at once under reduced motion).
 */
function Opening({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const opened = useRef(false);
  if (!auth.loading) opened.current = true;
  const opening = !opened.current;
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(1)).current;
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    if (!opening) return SplashScreen.hide();
    const timer = setTimeout(() => SplashScreen.hide(), LAUNCH_SCREEN_MAX_MS);
    return () => clearTimeout(timer);
  }, [opening]);
  useEffect(() => {
    if (opening) return;
    if (reduced) {
      setFaded(true);
      return;
    }
    const timing = Animated.timing(fade, {
      toValue: 0,
      duration: duration.base,
      easing: easing.in,
      useNativeDriver: nativeDriver,
    });
    timing.start(() => setFaded(true));
    return () => timing.stop();
  }, [opening, reduced, fade]);
  return (
    <>
      <View
        style={{ flex: 1 }}
        aria-hidden={opening}
        importantForAccessibility={opening ? "no-hide-descendants" : "auto"}
      >
        {children}
      </View>
      {!faded && (
        <Animated.View
          pointerEvents={opening ? "auto" : "none"}
          aria-hidden={!opening}
          importantForAccessibility={opening ? "auto" : "no-hide-descendants"}
          style={[StyleSheet.absoluteFill, { opacity: fade }]}
        >
          <Splash name={auth.me?.displayName ?? undefined} status={!!auth.session} />
        </Animated.View>
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
        <Splash status={false} />
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
                  screenOptions={{
                    headerShown: !web,
                    header: () => <AppHeader />,
                    contentStyle: { backgroundColor: colors.background },
                  }}
                  // The web build shows one screen at a time (`FocusedOnly`); a phone keeps earlier ones for Back.
                  // A league stays mounted under the screens above it: unmounting its tab navigator would forget
                  // which tab was open (Expo Router resets an unmounted navigator), so an in-app Back would land
                  // on its first tab. Its tabs empty themselves while it is covered (`FocusedOnly` there).
                  screenLayout={
                    web
                      ? ({ children, route }) =>
                          route.name === "leagues/[id]" ? children : <FocusedOnly>{children}</FocusedOnly>
                      : undefined
                  }
                >
                  <Stack.Screen name="index" options={{ title: "Your leagues" }} />
                  <Stack.Screen name="leagues/new" options={{ title: "New league" }} />
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
