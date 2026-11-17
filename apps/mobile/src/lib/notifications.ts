import type { PushDevice, PushPreferences } from "@picks/shared";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { getSupabase, request } from "./api";
import { apiOrigin, scopedKey } from "./config";
import { internalPath } from "./links";

/** Which player this device is registered to, per API server. */
const ownerKey = () => scopedKey("pow-native-push-owner", apiOrigin());
type Owner = PushPreferences & { userId: string; token: string };
export type NativePushState = {
  permission: "granted" | "denied" | "undetermined";
  configured: boolean;
  device: PushDevice | null;
};

async function owner(): Promise<Owner | null> {
  const stored = await SecureStore.getItemAsync(ownerKey());
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Owner;
    return typeof value.userId === "string" &&
      typeof value.token === "string" &&
      typeof value.newThreads === "boolean" &&
      typeof value.pickReminders === "boolean"
      ? value
      : null;
  } catch {
    return null;
  }
}

// Serialize enable, token rotation and sign-out disconnect so a slow registration cannot re-enable a device
// after the player has just disconnected it.
let pending: Promise<unknown> = Promise.resolve();
function exclusive<T>(action: () => Promise<T>): Promise<T> {
  const result = pending.then(action, action);
  pending = result.catch(() => {});
  return result;
}

async function accountId() {
  const { data } = await (await getSupabase()).auth.getSession();
  return data.session?.user.id;
}

async function expoToken() {
  if (Platform.OS !== "ios" && Platform.OS !== "android")
    throw new Error("Device notifications are available in the iPhone and Android app.");
  if (Constants.appOwnership === "expo")
    throw new Error(
      "Device notifications need a development or App Store build. They aren't available in Expo Go.",
    );
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (
    typeof projectId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)
  ) {
    throw new Error(
      "Notifications aren't configured for this build yet. Connect the app to its Expo project and rebuild.",
    );
  }
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    throw new Error("Couldn't register this device for notifications. Check your connection and try again.");
  }
}

async function save(token: string, preferences: PushPreferences, userId: string, previous?: Owner | null) {
  if ((await accountId()) !== userId)
    throw new Error("Your session changed. Sign in again before enabling notifications.");
  if (previous && previous.userId !== userId)
    throw new Error(
      "This device is linked to another account. Sign out of that account on this device first.",
    );
  const { device } = await request<{ device: PushDevice }>("/push/native/device", {
    method: "PUT",
    body: {
      token,
      newThreads: preferences.newThreads,
      pickReminders: preferences.pickReminders,
      ...(previous && previous.token !== token ? { oldToken: previous.token } : {}),
    },
  });
  await SecureStore.setItemAsync(
    ownerKey(),
    JSON.stringify({ token, userId, newThreads: device.newThreads, pickReminders: device.pickReminders }),
  );
  return device;
}

export function enableNativePush(preferences: PushPreferences, userId: string): Promise<PushDevice> {
  return exclusive(async () => {
    const { configured } = await request<{ configured: boolean }>("/push/native/config");
    if (!configured) throw new Error("Notifications aren't available yet. Please try again later.");
    // Android requires a notification channel before token registration/permission prompting.
    if (Platform.OS === "android")
      await Notifications.setNotificationChannelAsync("default", {
        name: "League updates",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted)
      throw new Error("Allow notifications for POW Pick'em in your device settings to turn them on.");
    const previous = await owner();
    const token = await expoToken();
    return save(token, preferences, userId, previous);
  });
}

/** Disconnect while the current account's access token is still available; a failure must block sign-out. */
export function disableNativePush(): Promise<void> {
  return exclusive(async () => {
    const previous = await owner();
    if (!previous) return;
    if ((await accountId()) !== previous.userId)
      throw new Error("Sign in to the account linked to this device to disconnect its notifications.");
    await request("/push/native/device", { method: "DELETE", body: { token: previous.token } });
    await SecureStore.deleteItemAsync(ownerKey());
  });
}

export async function nativePushState(): Promise<NativePushState> {
  const [permission, config, previous] = await Promise.all([
    Notifications.getPermissionsAsync(),
    request<{ configured: boolean }>("/push/native/config"),
    owner(),
  ]);
  const userId = await accountId();
  const { device } =
    previous && previous.userId === userId
      ? await request<{ device: PushDevice | null }>("/push/native/device", {
          method: "POST",
          body: { token: previous.token },
        })
      : { device: null };
  return {
    permission: permission.granted ? "granted" : permission.status === "denied" ? "denied" : "undetermined",
    configured: config.configured,
    device,
  };
}

/** Refresh an opted-in token without another permission prompt. Call on sign-in and app resume. */
export function reconcileNativePush(userId: string): Promise<void> {
  return exclusive(async () => {
    const previous = await owner();
    if (!previous || previous.userId !== userId) return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      await request("/push/native/device", { method: "DELETE", body: { token: previous.token } });
      await SecureStore.deleteItemAsync(ownerKey());
      return;
    }
    const token = await expoToken();
    if (token !== previous.token) await save(token, previous, userId, previous);
  });
}

/** Accept only our own supported routes from notification data; never open arbitrary external URLs. */
export function subscribeNativeNotifications(
  onPath: (path: string) => void,
  onError?: (error: unknown) => void,
): () => void {
  let active = true;
  let lastId: string | undefined;
  const receive = (response: Notifications.NotificationResponse | null) => {
    if (!active || !response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const id = response.notification.request.identifier;
    if (lastId === id) return;
    const path = internalPath(response.notification.request.content.data?.url);
    if (!path) return;
    lastId = id;
    onPath(path);
    void Notifications.clearLastNotificationResponseAsync();
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(receive);
  const rotation = Notifications.addPushTokenListener(() => {
    void accountId()
      .then((userId) => (userId ? reconcileNativePush(userId) : undefined))
      .catch((error) => {
        if (active) onError?.(error);
      });
  });
  void Notifications.getLastNotificationResponseAsync().then(receive, () => {});
  return () => {
    active = false;
    subscription.remove();
    rotation.remove();
  };
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});
