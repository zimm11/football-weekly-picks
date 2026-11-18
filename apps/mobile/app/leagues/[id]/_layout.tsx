import { useLocalSearchParams } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { Platform } from "react-native";
import { FocusedOnly } from "../../../src/components/FocusedOnly";
import { colors } from "../../../src/components/ui";
import { useGatedPageTitle } from "../../../src/lib/gatedTitle";
import { AuthGate } from "../../../src/screens/AuthScreen";
import { LeagueBottomBar, LeagueShell, LeagueTabsFrame } from "../../../src/screens/LeagueScreen";

const web = Platform.OS === "web";

/**
 * A league: one screen of the app's stack, holding its tabs (`LeagueShell` in src/screens/LeagueScreen.tsx loads
 * the league once for all of them). Every type has the same routes; the tab bar shows the type's own tabs
 * (`LEAGUE_TYPE_INFO[type].tabs`) and a route the type lacks is the not-found screen, so no tab is hidden here
 * (the navigator would redirect a hidden one to the first tab).
 *
 * In a browser each tab change is a new history entry (`backBehavior: "history"`), so Back walks the tabs, and
 * only the tab showing is in the page. On iPhone visited tabs stay mounted as they were, and Back (the gesture,
 * "All leagues") leaves the league rather than walking its tabs.
 */
export default function LeagueLayout() {
  useGatedPageTitle();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <LeagueShell leagueId={id}>
        <Tabs
          backBehavior={web ? "history" : "none"}
          screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.background } }}
          tabBar={() => <LeagueBottomBar />}
          layout={(props) => <LeagueTabsFrame {...props} />}
          screenLayout={web ? ({ children }) => <FocusedOnly>{children}</FocusedOnly> : undefined}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="results/index" />
          <Tabs.Screen name="standings/index" />
          <Tabs.Screen name="messages" />
          <Tabs.Screen name="league/index" />
        </Tabs>
      </LeagueShell>
    </AuthGate>
  );
}
