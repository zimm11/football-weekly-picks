import { useState } from "react";
import { Text, View } from "react-native";
import { notificationPermission, pushSupport } from "../lib/notifications.web";
import { shouldOfferNotifications } from "../lib/notificationsPrompt";
import { IconButton } from "../screens/leagueUi";
import { AppLink } from "./AppLink";
import { Icon } from "./Icon";
import { hoverFill } from "./pressState";
import { colors, fonts } from "./ui";

/** Set once a player answers the prompt ("Not now"), so Your leagues never asks on this browser again. */
const DISMISSED_KEY = "pow:notifications-prompt-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    // No storage means "Not now" couldn't stick, so don't ask at all.
    return true;
  }
}

/**
 * A quiet, one-line suggestion on Your leagues that points at Settings, only where this browser could get
 * notifications and hasn't been asked yet. "Not now" hides it for good on this browser.
 */
export function NotificationsPrompt() {
  const [show, setShow] = useState(() =>
    shouldOfferNotifications({
      support: pushSupport(),
      permission: notificationPermission(),
      dismissed: readDismissed(),
    }),
  );
  if (!show) return null;
  return (
    <View
      role="region"
      aria-label="Pick reminders"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        borderRadius: 16,
        backgroundColor: colors.card,
        paddingVertical: 6,
        paddingRight: 6,
        paddingLeft: 16,
      }}
    >
      <Icon name="bell" size={20} color={colors.primary} />
      <Text
        style={{ flex: 1, minWidth: 0, fontFamily: fonts.medium, fontSize: 16, color: colors.foreground }}
      >
        Get pick reminders
      </Text>
      <AppLink
        href="/account"
        style={(state) => ({
          minHeight: 44,
          paddingHorizontal: 16,
          borderRadius: 10,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: hoverFill(state, colors.raised, colors.raisedHover),
        })}
      >
        <Text style={{ fontFamily: fonts.semibold, fontSize: 16, color: colors.foreground }}>Turn on</Text>
      </AppLink>
      <IconButton
        name="close"
        label="Not now"
        onPress={() => {
          try {
            localStorage.setItem(DISMISSED_KEY, "1");
          } catch {}
          setShow(false);
        }}
      />
    </View>
  );
}
