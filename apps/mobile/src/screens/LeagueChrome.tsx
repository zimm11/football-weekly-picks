import { router, usePathname } from "expo-router";
import type { ComponentProps } from "react";
import { Platform, Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../components/Icon";
import { colors, fonts } from "../components/ui";
import { confirmDiscard, hasUnsavedWork } from "../lib/unsaved";
import { go, Select } from "./leagueUi";

export const LEAGUE_TABS = [
  { id: "picks", title: "Picks", icon: "football" },
  { id: "results", title: "Results", icon: "list" },
  { id: "standings", title: "Standings", icon: "trophy" },
  { id: "messages", title: "Messages", icon: "chat" },
  { id: "league", title: "League", icon: "users" },
] as const;
export function LeagueHeader({
  leagueName,
  season,
  seasonChoices,
  onSeason,
}: {
  leagueId: string;
  leagueName: string;
  season?: number | "new";
  seasonChoices?: { value: number | "new"; label: string }[];
  onSeason?: (year: number | "new") => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable
          accessibilityRole="link"
          onPress={() => go("/")}
          style={{
            minHeight: 44,
            alignSelf: "flex-start",
            flexDirection: "row",
            gap: 4,
            alignItems: "center",
          }}
        >
          <Icon name="arrow-left" size={14} color={colors.mutedForeground} />
          <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.mutedForeground }}>
            All leagues
          </Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={{
            fontFamily: fonts.displayExtraBold,
            fontSize: 30,
            letterSpacing: 0.75,
            lineHeight: 32,
            textTransform: "uppercase",
            color: colors.foreground,
          }}
        >
          {leagueName}
        </Text>
      </View>
      {season !== undefined && onSeason && (
        <Select
          compact
          label="Season"
          value={season}
          choices={seasonChoices ?? [{ value: season, label: String(season) }]}
          onChange={onSeason}
        />
      )}
    </View>
  );
}
export function LeagueTabBar({
  leagueId,
  active,
  unreadCount = 0,
  wide = false,
  onLeave,
}: {
  leagueId: string;
  active: string;
  unreadCount?: number;
  wide?: boolean;
  /** Called as a tab starts opening, once nothing unsaved stands in the way. */
  onLeave?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontal = wide && width >= 768;
  const path = usePathname();
  async function open(tab: string) {
    // A tab stays a link from the screens under it (Manage week sits under League).
    const target = `/leagues/${leagueId}${tab === "picks" ? "" : `/${tab}`}`;
    if (path === target || (hasUnsavedWork() && !(await confirmDiscard()))) return;
    onLeave?.();
    router.push(target as never);
  }
  return (
    <View
      // The league's sections are links between screens, as on the web.
      role="navigation"
      accessibilityLabel="League"
      style={{
        flexDirection: "row",
        backgroundColor: horizontal ? "transparent" : colors.chrome,
        paddingBottom: horizontal ? 0 : insets.bottom,
        borderTopWidth: horizontal ? 0 : 1,
        borderTopColor: colors.border,
        gap: horizontal ? 4 : 0,
      }}
    >
      {LEAGUE_TABS.map((item) => {
        const selected = item.id === active;
        const ink = selected ? colors.primary : colors.mutedForeground;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="link"
            // VoiceOver reads one label per tab, so the count goes in it; on the web the badge is its own image.
            accessibilityLabel={
              item.id === "messages" && unreadCount > 0 && Platform.OS !== "web"
                ? `Messages, ${unreadCount} unread threads`
                : item.title
            }
            accessibilityState={{ selected }}
            aria-current={selected ? "page" : undefined}
            onPress={() => void open(item.id)}
            style={({ pressed }) => ({
              flex: horizontal ? undefined : 1,
              height: horizontal ? 44 : 64,
              paddingHorizontal: horizontal ? 16 : 0,
              flexDirection: horizontal ? "row" : "column",
              alignItems: "center",
              justifyContent: "center",
              gap: horizontal ? 8 : 4,
              borderRadius: horizontal ? 100 : 0,
              backgroundColor:
                horizontal && selected ? `${colors.primary}20` : pressed ? colors.raised : "transparent",
            })}
          >
            <View>
              <Icon
                name={item.icon as ComponentProps<typeof Icon>["name"]}
                size={horizontal ? 20 : 24}
                filled={selected}
                color={ink}
              />
              {item.id === "messages" && unreadCount > 0 && (
                <View
                  role="img"
                  aria-label={`${unreadCount} unread threads`}
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -4,
                    width: 10,
                    height: 10,
                    borderRadius: 10,
                    backgroundColor: colors.primary,
                    borderWidth: 2,
                    borderColor: colors.chrome,
                  }}
                />
              )}
            </View>
            <Text style={{ fontFamily: fonts.medium, fontSize: horizontal ? 14 : 11, color: ink }}>
              {item.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
