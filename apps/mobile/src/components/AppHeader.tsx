import { type Href, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../lib/auth";
import { webTransition } from "../lib/motion";
import { openScreen } from "../lib/navigation";
import { notifyError } from "../lib/notify";
import { useSignInFormShown } from "../lib/signInForm";
import { confirmDiscard, hasUnsavedWork } from "../lib/unsaved";
import { AppLink } from "./AppLink";
import { Avatar } from "./Avatar";
import { Icon, type IconName } from "./Icon";
import { Menu, MenuItem, useAnchor } from "./Popover";
import { hoverFill, pressFade, pressState } from "./pressState";
import { space, type, widths } from "./theme";
import { colors, fonts } from "./ui";

/** Dynamic Type may grow the header's text this far: the bar is a fixed 56px. */
const CHROME_FONT_SCALE = 1.3;

export function AppHeader() {
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const menu = useAnchor();
  const [busy, setBusy] = useState(false);
  const formShown = useSignInFormShown();
  const signedIn = !!auth.session;
  // The player's name is known once their profile has loaded; until they have chosen one there is no avatar
  // to show, and nothing in the account menu they can use but Sign out.
  const name = auth.me?.displayName;
  // Under the name in the account menu, so a player with two accounts can tell which this is.
  const email = auth.session?.user.email;
  // The signed-out home page is a wider column: the logo lines up with its edge.
  const column = !auth.loading && !signedIn && path === "/" ? widths.landing : widths.page;
  const closeMenu = menu.close;
  useEffect(() => {
    if (!signedIn) closeMenu();
  }, [signedIn, closeMenu]);
  const rows: { label: string; icon: IconName; path?: Href; action?: () => void }[] = [
    ...(name
      ? [
          { label: "Name and picture", icon: "user" as const, path: "/change-name" as Href },
          { label: "Settings", icon: "settings" as const, path: "/account" as Href },
          { label: "Change password", icon: "lock" as const, path: "/reset-password" as Href },
          {
            label: "Send feedback",
            icon: "chat" as const,
            path: { pathname: "/feedback", params: { from: path } } as Href,
          },
        ]
      : []),
    ...(auth.me?.isOperator
      ? [{ label: "Operator", icon: "chart" as const, path: "/operator" as Href }]
      : []),
    { label: busy ? "Signing out…" : "Sign out", icon: "sign-out", action: () => void signOut() },
  ];
  async function signOut() {
    if (busy) return;
    // The menu closes before the question is asked, so staying for unsaved work leaves the screen usable.
    if (hasUnsavedWork()) {
      menu.close();
      if (!(await confirmDiscard())) return;
    }
    setBusy(true);
    try {
      await auth.signOut();
      menu.close();
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
          maxWidth: column,
          alignSelf: "center",
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        {/* The app's name is the page's top heading, linking home, as on the web. */}
        <View accessibilityRole="header" aria-level={1} style={{ marginRight: "auto" }}>
          <AppLink
            href="/"
            // On iPhone, Your leagues is the bottom of the stack: go back down to it rather than add another.
            how={Platform.OS === "web" ? "push" : "dismissTo"}
            accessibilityLabel="POW Pick'em"
            style={(state) => {
              const { pressed, hovered } = pressState(state);
              return {
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                minHeight: 44,
                opacity: pressed ? 0.7 : hovered ? 0.85 : 1,
                ...webTransition(["opacity"]),
              };
            }}
          >
            <Icon name="football" color={colors.pow} size={24} filled />
            <Text
              maxFontSizeMultiplier={CHROME_FONT_SCALE}
              style={{
                fontFamily: fonts.displayExtraBold,
                fontSize: 20,
                color: colors.foreground,
                textTransform: "uppercase",
              }}
            >
              POW Pick'em
            </Text>
          </AppLink>
        </View>
        <View
          role="navigation"
          aria-label="Main navigation"
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <AppLink
            href="/how-to-play"
            aria-current={path === "/how-to-play" ? "page" : undefined}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 10,
              justifyContent: "center",
              opacity: pressed ? 0.7 : 1,
              ...webTransition(["opacity"]),
            })}
          >
            {(state) => (
              <Text
                maxFontSizeMultiplier={CHROME_FONT_SCALE}
                style={{
                  fontFamily: fonts.medium,
                  fontSize: 14,
                  color:
                    path === "/how-to-play" || pressState(state).hovered
                      ? colors.foreground
                      : colors.mutedForeground,
                  ...webTransition(["color"]),
                }}
              >
                How to play
              </Text>
            )}
          </AppLink>
          {auth.loading ? (
            // Nobody is signed in or out until the session has been read: hold the avatar's place, empty.
            <View style={{ width: 63, height: 44 }} />
          ) : signedIn ? (
            <Pressable
              ref={menu.ref}
              accessibilityRole="button"
              // Named for the player, as on the web: the account menu sits under their name.
              accessibilityLabel={name ?? "Account"}
              accessibilityState={{ expanded: !!menu.anchor }}
              onPress={menu.open}
              // The whole pill lights under the mouse or a finger: 4px around the avatar, 6px past the chevron.
              style={(state) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 7,
                minHeight: 44,
                paddingLeft: space.xs,
                paddingRight: space.sm,
                borderRadius: 100,
                backgroundColor: hoverFill(state),
                ...webTransition(["background-color"]),
              })}
            >
              {name ? (
                <Avatar avatarId={auth.me?.avatarId} name={name} />
              ) : (
                // No name yet (the display-name step, or a profile that didn't load): no initials to show.
                <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.raised }} />
              )}
              <Icon name="chevron-down" size={14} color={colors.mutedForeground} />
            </Pressable>
          ) : path === "/login" || formShown ? null : (
            // Left out where the sign-in form is already on the page: it would only drop the page asked for.
            <AppLink
              href="/login"
              style={(state) => ({
                minHeight: 44,
                paddingHorizontal: 12,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.primary,
                ...webTransition(["opacity"]),
                ...pressFade(state),
              })}
            >
              <Text
                maxFontSizeMultiplier={CHROME_FONT_SCALE}
                style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primaryForeground }}
              >
                Sign in
              </Text>
            </AppLink>
          )}
        </View>
      </View>
      {/* Under the avatar, its right edge on the avatar's, at every width. */}
      <Menu anchor={menu.anchor} onClose={menu.close} label="Account" align="end" width={240}>
        {!!name && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.lg,
              padding: space.lg,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              marginBottom: space.xs,
            }}
          >
            <Avatar avatarId={auth.me?.avatarId} name={name} size={36} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={1}
                style={{ ...type.body, fontFamily: fonts.semibold, color: colors.foreground }}
              >
                {name}
              </Text>
              {!!email && (
                <Text numberOfLines={1} style={{ ...type.small, color: colors.mutedForeground }}>
                  {email}
                </Text>
              )}
            </View>
          </View>
        )}
        {rows.map((row, index) => {
          const item = (
            <MenuItem
              key={row.icon}
              label={row.label}
              icon={row.icon}
              disabled={busy}
              onPress={() => {
                if (row.path) {
                  menu.close();
                  void openScreen(row.path);
                } else row.action?.();
              }}
            />
          );
          // Sign out, set apart from the rest by a hairline.
          return row.action && index > 0 ? (
            <View
              key={row.icon}
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.border,
                marginTop: space.xs,
                paddingTop: space.xs,
              }}
            >
              {item}
            </View>
          ) : (
            item
          );
        })}
      </Menu>
    </View>
  );
}
