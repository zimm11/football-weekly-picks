// biome-ignore-all lint/correctness/noReactNativeRawText: SettingsHeading renders its children inside native Text.
import type { PushDevice, PushPreferences, PushSettings } from "@picks/shared";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { messageOf, request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useFormGuard } from "../lib/hooks";
import {
  disablePush,
  lookupPush,
  type PushSupport,
  preparePush,
  pushSupport,
  savePush,
} from "../lib/notifications.web";
import { notifyDone } from "../lib/notify";
import { Disclosure } from "../screens/leagueUi";
import { HomeScreenInstructions } from "./HomeScreenInstall";
import { PreferenceToggle } from "./PreferenceToggle";
import { SettingsHeading } from "./SettingsHeading";
import { Body, Button, Card, colors, ErrorMessage, Notice, styles } from "./ui";

type State = {
  config: PushSettings;
  registration?: ServiceWorkerRegistration;
  subscription?: PushSubscription | null;
  device: PushDevice | null;
};

const blocked = () => "Notification" in window && Notification.permission === "denied";

/** Settings → On this device in a browser: Web Push through `/push-sw.js`. Loads its own state. */
export function DeviceNotifications() {
  const userId = useAuth().session?.user.id;
  const [support] = useState(pushSupport);
  const [state, setState] = useState<State>();
  const [denied, setDenied] = useState(blocked);
  const operation = useRef({ busy: false, revision: 0 });
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is what asks again after a failure.
  useEffect(() => {
    let current = true;
    async function load() {
      if (operation.current.busy) return;
      const revision = ++operation.current.revision;
      const config = await request<PushSettings>("/push/config");
      const registration = support === "supported" && config.configured ? await preparePush() : undefined;
      const subscription = await registration?.pushManager.getSubscription();
      const { device } = subscription ? await lookupPush(subscription.endpoint) : { device: null };
      if (current && revision === operation.current.revision && !operation.current.busy) {
        setError(undefined);
        setDenied(blocked());
        setState({ config, registration, subscription, device });
      }
    }
    const fail = (err: unknown) => current && setError(messageOf(err));
    void load().catch(fail);
    const refresh = () => {
      if (document.visibilityState === "visible") void load().catch(fail);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      current = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [support, attempt]);
  function change(action: () => Promise<void>) {
    operation.current.busy = true;
    operation.current.revision++;
    try {
      return action().finally(() => {
        operation.current.busy = false;
      });
    } catch (err) {
      operation.current.busy = false;
      return Promise.reject(err);
    }
  }
  function enable() {
    // The browser's permission prompt must be asked for synchronously from the Enable button's tap.
    const permission = Notification.requestPermission();
    return permission.then(async (result) => {
      setDenied(result === "denied");
      if (result !== "granted")
        throw new Error("Notifications weren't enabled. You can try again when you're ready.");
      if (!state?.registration || !state.config.publicKey || !userId)
        throw new Error("Notifications aren't ready. Reload and try again.");
      // Start with a fresh endpoint when the browser has no registration for this account (e.g. shared device).
      if (state.subscription && !state.device && !(await state.subscription.unsubscribe()))
        throw new Error("Couldn't reset this device's notifications. Try again.");
      const subscription = await state.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: state.config.publicKey,
      });
      const device = await savePush(subscription, { newThreads: true, pickReminders: true }, userId);
      setState({ ...state, subscription, device });
      notifyDone("Notifications enabled on this device.");
    });
  }
  if (error || !state)
    return (
      <Card>
        <SettingsHeading>On this device</SettingsHeading>
        {error ? (
          <ErrorMessage
            message={error}
            onRetry={() => {
              setError(undefined);
              setAttempt((n) => n + 1);
            }}
          />
        ) : (
          <View role="status" aria-label="Loading notifications on this device" style={{ gap: 12 }}>
            <View style={[styles.skeleton, { width: "80%" }]} />
            <View style={[styles.skeleton, { height: 44, borderRadius: 10 }]} />
          </View>
        )}
      </Card>
    );
  return (
    <PushNotificationSettings
      key={state.device?.id ?? "off"}
      support={support}
      configured={state.config.configured}
      enabled={!!state.device}
      denied={denied}
      preferences={state.device ?? { newThreads: true, pickReminders: true }}
      onEnable={() => change(enable)}
      onDisable={() =>
        change(async () => {
          await disablePush(state.subscription);
          setState({ ...state, subscription: null, device: null });
          notifyDone("Notifications turned off on this device.");
        })
      }
      onSave={(preferences) =>
        change(async () => {
          if (!state.subscription || !userId) throw new Error("Enable notifications first.");
          const device = await savePush(state.subscription, preferences, userId);
          setState({ ...state, device });
          notifyDone("Notification preferences saved.");
        })
      }
    />
  );
}

/** Presents what the loader found; the browser's permission request stays in the loader. */
function PushNotificationSettings({
  support,
  configured,
  enabled,
  denied,
  preferences,
  onEnable,
  onDisable,
  onSave,
}: {
  support: PushSupport;
  configured: boolean;
  enabled: boolean;
  denied: boolean;
  preferences: PushPreferences;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onSave: (preferences: PushPreferences) => Promise<void>;
}) {
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const dirty =
    draft.newThreads !== preferences.newThreads || draft.pickReminders !== preferences.pickReminders;
  useFormGuard(dirty, () => setDraft(preferences));
  // Call immediately: an awaited step before onEnable would lose iOS's user gesture.
  function run(label: string, action: () => Promise<void>) {
    setError(undefined);
    setBusy(label);
    action()
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't update notifications."))
      .finally(() => setBusy(undefined));
  }
  const small = { fontSize: 14, lineHeight: 20 };
  return (
    <Card>
      <SettingsHeading>On this device</SettingsHeading>
      <Body muted>
        New threads and missing-pick reminders as notifications. They can show league names and thread titles
        on your lock screen.
      </Body>
      {support === "home-screen" ? (
        <>
          <Body muted>
            On iPhone or iPad, add POW Pick'em to your home screen, open its icon, then return here to enable
            notifications. Requires iOS or iPadOS 16.4 or later.
          </Body>
          {/* Only iPhone and iPad browser tabs reach this state, so only their steps apply. */}
          <HomeScreenInstructions platform="ios" />
        </>
      ) : support === "unsupported" ? (
        <Body muted>
          Push notifications aren't supported in this browser. Try an up-to-date browser or the home-screen
          app.
        </Body>
      ) : !configured ? (
        <Body muted>Notifications aren't available yet. Please check back later.</Body>
      ) : (
        <>
          <View role="status">
            <Body>
              {denied
                ? "Notifications are blocked on this device."
                : enabled
                  ? "Notifications are on for this device."
                  : "Notifications are off for this device."}
            </Body>
          </View>
          {denied && (
            <Disclosure title="How to turn them back on">
              <View style={{ gap: 8 }}>
                <Body muted style={small}>
                  <Body style={small}>iPhone or iPad:</Body> Settings → Notifications → POW Pick'em → Allow
                  Notifications.
                </Body>
                <Body muted style={small}>
                  <Body style={small}>Android:</Body> in Chrome, tap the icon left of the address →
                  Permissions → Notifications → Allow. For the home-screen app, long-press its icon → App info
                  → Notifications.
                </Body>
                <Body muted style={small}>
                  <Body style={small}>Computer:</Body> click the icon left of the address → allow
                  Notifications.
                </Body>
                <Body muted style={small}>
                  Then come back here and tap Enable notifications.
                </Body>
              </View>
            </Disclosure>
          )}
          {enabled && (
            <View style={{ gap: 12 }}>
              <PreferenceToggle
                label="New league threads"
                checked={draft.newThreads}
                disabled={!!busy}
                onChange={(value) => setDraft((old) => ({ ...old, newThreads: value }))}
              />
              <PreferenceToggle
                label="Missing-pick reminders"
                checked={draft.pickReminders}
                disabled={!!busy}
                onChange={(value) => setDraft((old) => ({ ...old, pickReminders: value }))}
              />
              <Body muted style={small}>
                Reminders start at 7pm in your league's time zone the evening before game day, only when you
                still have games to pick. Delivery may be delayed by your device or network.
              </Body>
              <Button
                title={busy === "Saving…" ? busy : "Save preferences"}
                disabled={!!busy || !dirty}
                onPress={() => run("Saving…", () => onSave(draft))}
              />
            </View>
          )}
          <Button
            variant={enabled ? "outline" : "primary"}
            disabled={!!busy || (!enabled && denied)}
            title={
              busy && busy !== "Saving…" ? busy : enabled ? "Turn off on this device" : "Enable notifications"
            }
            onPress={() => run(enabled ? "Turning off…" : "Enabling…", enabled ? onDisable : onEnable)}
          />
        </>
      )}
      <Notice kind="alert" message={error} />
      <Body muted style={[small, { color: colors.mutedForeground }]}>
        Settings apply to this device. Signing out turns notifications off here. Repeat setup on any other
        device where you want them.
      </Body>
    </Card>
  );
}
