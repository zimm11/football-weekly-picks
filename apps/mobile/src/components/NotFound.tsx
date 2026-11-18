import { Text, useWindowDimensions, View } from "react-native";
import { useAuth } from "../lib/auth";
import { webTransition } from "../lib/motion";
import { AppLink } from "./AppLink";
import { Icon } from "./Icon";
import { hoverFill } from "./pressState";
import { space } from "./theme";
import { Body, colors, fonts, Screen, Title } from "./ui";

/**
 * The not-found screen: for an unknown path, a league tab its type doesn't have, and something that is gone or
 * isn't the player's to see (a league they were removed from, a deleted board): pass what it was as `title`
 * ("League not found") and, if it helps, a line of `detail`. Its one way on is home: Your leagues signed in,
 * the front page signed out. The screen that shows it names the browser tab (`usePageTitle`).
 */
export function NotFound({ title = "Page not found", detail }: { title?: string; detail?: string }) {
  const { session, loading } = useAuth();
  const wide = useWindowDimensions().width >= 768;
  return (
    <Screen narrow>
      <View
        style={{
          alignItems: "center",
          gap: space["2xl"],
          paddingTop: wide ? space["5xl"] + space["4xl"] : space["3xl"],
        }}
      >
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: colors.raised,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="football" size={28} color={colors.mutedForeground} />
        </View>
        {/* An alert, so a page that turns into this one (the league was just deleted) is announced. */}
        <View accessibilityRole="alert" style={{ gap: space.md, alignItems: "center" }}>
          <Title style={{ textAlign: "center" }}>{title}</Title>
          {!!detail && (
            <Body muted style={{ textAlign: "center" }}>
              {detail}
            </Body>
          )}
        </View>
        <HomeLink label={session || loading ? "Your leagues" : "Home"} align="center" />
      </View>
    </Screen>
  );
}

/** The way home from a dead end: a real link, replacing the page that has nothing to show. */
export function HomeLink({
  label = "Your leagues",
  align = "start",
}: {
  label?: string;
  /** Where it sits in its column: at the start (under a message), or centered (the not-found screen). */
  align?: "start" | "center";
}) {
  return (
    <AppLink
      href="/"
      how="replace"
      style={(state) => ({
        minHeight: 44,
        alignSelf: align === "center" ? "center" : "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: hoverFill(state, colors.raised, colors.raisedHover),
        ...webTransition(["background-color"]),
      })}
    >
      <Icon name="arrow-left" size={14} color={colors.foreground} />
      <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.foreground }}>{label}</Text>
    </AppLink>
  );
}
