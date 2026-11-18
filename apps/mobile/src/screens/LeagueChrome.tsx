import {
  LEAGUE_TABS,
  LEAGUE_TYPE_INFO,
  type LeagueTabId,
  type LeagueType,
  leagueTabPath,
} from "@picks/shared";
import { usePathname } from "expo-router";
import type { ReactNode } from "react";
import { Platform, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppLink, openPath } from "../components/AppLink";
import { Icon } from "../components/Icon";
import { colors, fonts } from "../components/ui";
import { readLoadCache } from "../lib/loadCache";
import { counted } from "../lib/messagePresentation";
import { useLeagueTabsNav } from "./leagueContext";
import { Select } from "./leagueUi";

/** Dynamic Type may grow the fixed-height chrome (tab bar, header rows) this far and no further. */
const CHROME_FONT_SCALE = 1.3;

/** A league type's tabs, in order, from the registry (`LEAGUE_TYPE_INFO[type].tabs`). */
export const leagueTabs = (type: LeagueType) =>
  LEAGUE_TYPE_INFO[type].tabs.map((id) => ({ id, path: leagueTabPath(type, id), ...LEAGUE_TABS[id] }));
export function LeagueHeader({
  leagueName,
  season,
  seasonChoices,
  onSeason,
  selector,
  seasonWidth,
}: {
  leagueId: string;
  leagueName: string;
  season?: number | "new";
  seasonChoices?: { value: number | "new"; label: string }[];
  onSeason?: (year: number | "new") => void;
  /** Another type's selector in the season's place (squares' board). */
  selector?: ReactNode;
  /** The season selector's width, when its labels are longer than a year. */
  seasonWidth?: number;
}) {
  // The selector rides on the "All leagues" row, so the league's name keeps the whole width under it whatever
  // the selector says ("2026 playoffs", a board's game).
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        {/* On iPhone, Your leagues is already under this screen: go back down to it rather than stack another. */}
        <AppLink
          href="/"
          how={Platform.OS === "web" ? "push" : "dismissTo"}
          style={({ pressed }) => ({
            minHeight: 44,
            flexShrink: 0,
            flexDirection: "row",
            gap: 4,
            alignItems: "center",
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Icon name="arrow-left" size={14} color={colors.mutedForeground} />
          <Text
            maxFontSizeMultiplier={CHROME_FONT_SCALE}
            style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.mutedForeground }}
          >
            All leagues
          </Text>
        </AppLink>
        {season !== undefined && onSeason && (
          <Select
            compact
            compactWidth={seasonWidth}
            label="Season"
            value={season}
            choices={seasonChoices ?? [{ value: season, label: String(season) }]}
            onChange={onSeason}
          />
        )}
        {season === undefined && selector}
      </View>
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        maxFontSizeMultiplier={CHROME_FONT_SCALE}
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
  );
}
export function LeagueTabBar({
  leagueId,
  type = "weekly",
  active,
  unreadCount = 0,
  reportsWaiting,
  wide = false,
}: {
  leagueId: string;
  /** The league's type, whose tabs the bar shows. */
  type?: LeagueType;
  active: LeagueTabId;
  unreadCount?: number;
  /** Reports waiting for this commissioner's review; the League tab shows a dot while there are any. */
  reportsWaiting?: number;
  wide?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontal = wide && width >= 768;
  const path = usePathname();
  // Drawn inside this league's own tab navigator (its tabs), or on a screen above it (a week, a board).
  const tabsNav = useLeagueTabsNav();
  const inLeague = tabsNav?.leagueId === leagueId ? tabsNav : null;
  // Screens above the league (a week, a board) don't hold it, so the bar reads the copy the league last loaded.
  // Only commissioners are sent a count.
  const reports =
    reportsWaiting ??
    readLoadCache<{ openReports?: number | null }>(`/leagues/${leagueId}`)?.openReports ??
    0;
  const badges: Partial<Record<LeagueTabId, string>> = {
    ...(unreadCount > 0 ? { messages: counted(unreadCount, "unread thread") } : {}),
    ...(reports > 0 ? { league: `${counted(reports, "report")} waiting` } : {}),
  };
  const tabs = leagueTabs(type).map((item) => ({
    ...item,
    // A tab stays a link from the screens under it (Manage week sits under League).
    href: `/leagues/${leagueId}${item.path ? `/${item.path}` : ""}`,
  }));
  function open(target: string, tab: LeagueTabId) {
    // In a browser a tab is a link: Back walks the tabs you opened. The tab you are on does nothing.
    if (Platform.OS === "web") {
      if (path !== target) void openPath(target);
      return;
    }
    // On iPhone the league's tabs are its own tab navigator: they switch in place, each kept as it was, so Back
    // leaves the league. From a screen above the league (a week, a board) go back down to the tab underneath.
    if (inLeague) inLeague.open(tab);
    else void openPath(target, "dismissTo");
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
      {tabs.map((item) => {
        const selected = item.id === active;
        const ink = selected ? colors.primary : colors.mutedForeground;
        const badge = badges[item.id];
        return (
          <AppLink
            key={item.id}
            href={item.href}
            // VoiceOver reads one label per tab, so the count goes in it; on the web the badge is its own image.
            accessibilityLabel={badge && Platform.OS !== "web" ? `${item.title}, ${badge}` : item.title}
            accessibilityState={{ selected }}
            aria-current={selected ? "page" : undefined}
            onPress={() => open(item.href, item.id)}
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
              <Icon name={item.icon} size={horizontal ? 20 : 24} filled={selected} color={ink} />
              {badge && (
                <View
                  role="img"
                  aria-label={badge}
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
            <Text
              maxFontSizeMultiplier={CHROME_FONT_SCALE}
              style={{ fontFamily: fonts.medium, fontSize: horizontal ? 14 : 11, color: ink }}
            >
              {item.title}
            </Text>
          </AppLink>
        );
      })}
    </View>
  );
}
