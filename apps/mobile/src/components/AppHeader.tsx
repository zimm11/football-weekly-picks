import { type Href, usePathname } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { openScreen } from "../lib/navigation";
import { notifyError } from "../lib/notify";
import { confirmDiscard } from "../lib/unsaved";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Body, Button, colors, fonts } from "./ui";
export function AppHeader() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows: { label: string; icon: IconName; path?: Href; action?: () => void }[] = [
    { label: "Change your name", icon: "users", path: "/change-name" },
    { label: "Settings", icon: "settings", path: "/account" },
    { label: "Change password", icon: "lock", path: "/reset-password" },
    { label: "Send feedback", icon: "chat", path: { pathname: "/feedback", params: { from: path } } },
    ...(auth.me?.isOperator
      ? [{ label: "Operator", icon: "chart" as const, path: "/operator" as Href }]
      : []),
    { label: busy ? "Signing out…" : "Sign out", icon: "sign-out", action: () => void signOut() },
  ];
  async function signOut() {
    if (busy) return;
    // The menu closes first, so staying for unsaved work leaves the screen usable.
    if (!(await confirmDiscard())) return setMenu(false);
    setBusy(true);
    try {
      await auth.signOut();
      setMenu(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Couldn’t sign out. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <View
      style={{
        backgroundColor: colors.chrome,
        paddingTop: insets.top,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}
    >
      <View
        style={{
          height: 56,
          width: "100%",
          maxWidth: 896,
          alignSelf: "center",
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        {/* The app's name is the page's top heading, linking home, as on the web. */}
        <View accessibilityRole="header" aria-level={1} style={{ marginRight: "auto" }}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="POW Pick'em"
            onPress={() => void openScreen("/")}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}
          >
            <Icon name="football" color={colors.pow} size={24} filled />
            <Text
              style={{
                fontFamily: fonts.displayExtraBold,
                fontSize: 20,
                color: colors.foreground,
                textTransform: "uppercase",
              }}
            >
              POW Pick'em
            </Text>
          </Pressable>
        </View>
        <View
          role="navigation"
          aria-label="Main navigation"
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <Pressable
            accessibilityRole="link"
            aria-current={path === "/how-to-play" ? "page" : undefined}
            onPress={() => void openScreen("/how-to-play")}
            style={{ minHeight: 44, paddingHorizontal: 10, justifyContent: "center" }}
          >
            <Text
              style={{
                fontFamily: fonts.medium,
                fontSize: 14,
                color: path === "/how-to-play" ? colors.foreground : colors.mutedForeground,
              }}
            >
              How to play
            </Text>
          </Pressable>
          {auth.session ? (
            <Pressable
              accessibilityRole="button"
              // Named for the player, as on the web: the account menu sits under their name.
              accessibilityLabel={auth.me?.displayName ?? "Account"}
              accessibilityState={{ expanded: menu }}
              onPress={() => setMenu(true)}
              style={{ flexDirection: "row", alignItems: "center", gap: 7, minHeight: 44, paddingLeft: 4 }}
            >
              <Avatar name={auth.me?.displayName ?? "Account"} />
              <Icon name="chevron-down" size={14} color={colors.mutedForeground} />
            </Pressable>
          ) : (
            <Button link title="Sign in" small onPress={() => void openScreen("/login")} />
          )}
        </View>
      </View>
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityLabel="Close account menu"
            accessibilityRole="button"
            style={{ position: "absolute", inset: 0 }}
            onPress={() => setMenu(false)}
          />
          <View
            accessibilityRole="menu"
            accessibilityLabel="Account"
            style={{
              position: "absolute",
              right: 16,
              top: insets.top + 52,
              width: 240,
              borderRadius: 12,
              padding: 6,
              backgroundColor: colors.popover,
              borderWidth: 1,
              borderColor: colors.border,
              boxShadow: "0 8px 30px #00000066",
            }}
          >
            {auth.me?.displayName && (
              <View
                style={{
                  padding: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                  marginBottom: 4,
                }}
              >
                <Body style={{ fontFamily: fonts.semibold }}>{auth.me.displayName}</Body>
              </View>
            )}
            {rows.map((row) => (
              <Pressable
                key={row.label}
                accessibilityRole="menuitem"
                disabled={busy}
                onPress={() => {
                  if (row.path) {
                    setMenu(false);
                    void openScreen(row.path);
                  } else row.action?.();
                }}
                style={({ pressed }) => ({
                  minHeight: 44,
                  paddingHorizontal: 10,
                  borderRadius: 6,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: pressed ? colors.raised : "transparent",
                })}
              >
                <Icon name={row.icon} size={17} color={colors.mutedForeground} />
                <Text style={{ fontFamily: fonts.body, fontSize: 15, color: colors.foreground }}>
                  {row.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}
