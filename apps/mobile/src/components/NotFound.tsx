import { Text, View } from "react-native";
import { useAuth } from "../lib/auth";
import { AppLink } from "./AppLink";
import { Icon } from "./Icon";
import { Body, colors, fonts, Screen, Title } from "./ui";

/**
 * The not-found screen: for an unknown path, a league tab its type doesn't have, and something that is gone or
 * isn't the player's to see (a league they were removed from, a deleted board): pass what it was as `title`
 * ("League not found") and, if it helps, a line of `detail`. Its one way on is home: Your leagues signed in,
 * the front page signed out. The screen that shows it names the browser tab (`usePageTitle`).
 */
export function NotFound({ title = "Page not found", detail }: { title?: string; detail?: string }) {
  const { session, loading } = useAuth();
  return (
    <Screen>
      {/* An alert, so a page that turns into this one (the league was just deleted) is announced. */}
      <View accessibilityRole="alert" style={{ gap: 8 }}>
        <Title>{title}</Title>
        {!!detail && <Body muted>{detail}</Body>}
      </View>
      <HomeLink label={session || loading ? "Your leagues" : "Home"} />
    </Screen>
  );
}

/** The way home from a dead end: a real link, replacing the page that has nothing to show. */
export function HomeLink({ label = "Your leagues" }: { label?: string }) {
  return (
    <AppLink
      href="/"
      how="replace"
      style={({ pressed }) => ({
        minHeight: 44,
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: pressed ? colors.raisedHover : colors.raised,
      })}
    >
      <Icon name="arrow-left" size={14} color={colors.foreground} />
      <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.foreground }}>{label}</Text>
    </AppLink>
  );
}
