import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * A tap felt on iPhone, following Apple's guidance: `select` for a choice that changes (a team, a square, a
 * reaction), `toggle` for a firmer, significant switch (the POW on or off), and `success`, `warn` and `error`
 * for how an action turned out. Not for every tap, and never for what the system already feels (pull to
 * refresh, the native pickers). The website's `haptics.web.ts` does nothing.
 *
 * Fire and forget: nothing here throws or rejects. `expo-haptics` finds its native module with
 * `requireOptionalNativeModule`, so importing it is safe in a build made before it was added; there each call
 * rejects (UnavailabilityError), which is swallowed. iPhone only: Android would need the vibrate permission.
 */
function feel(run: () => Promise<void>) {
  if (Platform.OS !== "ios") return;
  try {
    run().catch(() => {});
  } catch {
    // A missing native module or an older build: no tap.
  }
}

export const haptics = {
  select: () => feel(() => Haptics.selectionAsync()),
  toggle: () => feel(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => feel(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warn: () => feel(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => feel(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
