import { usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../components/Icon";
import { colors, fonts } from "../components/ui";

type Notice = { message: string; kind: "status" | "alert" };
const listeners = new Set<(value: Notice) => void>();
export function notifyDone(message: string) {
  for (const listener of listeners) listener({ message, kind: "status" });
}
export function notifyError(message: string) {
  for (const listener of listeners) listener({ message, kind: "alert" });
}
export function NotificationBanner() {
  const [notice, setNotice] = useState<Notice>();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  // Phones keep the league tab bar (and a save bar) at the bottom; wide screens put the tabs at the top.
  const wide = useWindowDimensions().width >= 768;
  const leagueScreen =
    path.startsWith("/leagues/") || path.startsWith("/weeks/") || path.startsWith("/boards/");
  useEffect(() => {
    listeners.add(setNotice);
    return () => {
      listeners.delete(setNotice);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  return notice ? (
    // Centered at the bottom. The full-width row does the centering, since an
    // absolutely positioned view ignores alignSelf.
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        bottom: insets.bottom + (leagueScreen ? (wide ? 96 : 136) : 24),
        left: 0,
        right: 0,
        paddingHorizontal: 16,
        alignItems: "center",
      }}
    >
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole={notice.kind === "alert" ? "alert" : "text"}
        style={{
          width: "100%",
          maxWidth: 420,
          backgroundColor: colors.raised,
          padding: 14,
          borderRadius: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          boxShadow: "0 4px 20px #00000055",
        }}
      >
        <Icon
          name={notice.kind === "alert" ? "warning" : "check-circle"}
          filled
          size={20}
          color={notice.kind === "alert" ? colors.destructive : colors.win}
        />
        <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.foreground, flex: 1 }}>
          {notice.message}
        </Text>
        <Pressable
          accessibilityLabel="Dismiss notification"
          accessibilityRole="button"
          onPress={() => setNotice(undefined)}
          style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="close" size={16} color={colors.mutedForeground} />
        </Pressable>
      </View>
    </View>
  ) : null;
}
