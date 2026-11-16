import type { PushDevice, PushSettings } from "@picks/shared";
import { useEffect, useRef, useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { PushNotificationSettings } from "../components/PushNotificationSettings";
import { SettingsSkeleton } from "../components/Skeletons";
import { Card, Eyebrow, Notice } from "../components/ui/card";
import { notifyDone } from "../notify";
import { disablePush, preparePush, pushSupport, savePush } from "../push";

/** This browser's push notifications: the "On this device" part of Settings. Loads its own state. */
export function DeviceNotifications() {
  const [support] = useState(pushSupport);
  const [state, setState] = useState<{
    config: PushSettings;
    registration?: ServiceWorkerRegistration;
    subscription?: PushSubscription | null;
    device: PushDevice | null;
  }>();
  const [denied, setDenied] = useState(
    () => "Notification" in window && Notification.permission === "denied",
  );
  const operation = useRef({ busy: false, revision: 0 });
  const [error, setError] = useState<string>();
  useEffect(() => {
    let current = true;
    async function load() {
      if (operation.current.busy) return;
      const revision = ++operation.current.revision;
      const config = await unwrap<PushSettings>(api.push.config.$get());
      const registration = support === "supported" && config.configured ? await preparePush() : undefined;
      const subscription = await registration?.pushManager.getSubscription();
      const { device } = subscription
        ? await unwrap<{ device: PushDevice | null }>(
            api.push.device.$post({ json: { endpoint: subscription.endpoint } }),
          )
        : { device: null };
      if (current && revision === operation.current.revision && !operation.current.busy) {
        setError(undefined);
        setDenied("Notification" in window && Notification.permission === "denied");
        setState({ config, registration, subscription, device });
      }
    }
    void load().catch((err) => current && setError(messageOf(err)));
    const refresh = () => {
      if (document.visibilityState === "visible")
        void load().catch((err) => current && setError(messageOf(err)));
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      current = false;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [support]);
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
    // The native permission prompt must be invoked synchronously from the Enable button's tap.
    const permission = Notification.requestPermission();
    return permission.then(async (result) => {
      setDenied(result === "denied");
      if (result !== "granted")
        throw new Error("Notifications weren't enabled. You can try again when you're ready.");
      if (!state?.registration || !state.config.publicKey)
        throw new Error("Notifications aren't ready. Reload and try again.");
      // Start with a fresh endpoint when the browser has no registration for this account (e.g. shared device).
      if (state.subscription && !state.device && !(await state.subscription.unsubscribe()))
        throw new Error("Couldn't reset this device's notifications. Try again.");
      const subscription = await state.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: state.config.publicKey,
      });
      const device = await savePush(subscription, { newThreads: true, pickReminders: true });
      setState({ ...state, subscription, device });
      notifyDone("Notifications enabled on this device.");
    });
  }
  if (error || !state) {
    return (
      <Card aria-labelledby="device-notifications-heading">
        <Eyebrow id="device-notifications-heading" className="m-0">
          On this device
        </Eyebrow>
        {error ? (
          <Notice kind="alert">{error}</Notice>
        ) : (
          <SettingsSkeleton label="Loading notifications on this device" />
        )}
      </Card>
    );
  }
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
          if (!state.subscription) throw new Error("Enable notifications first.");
          const device = await savePush(state.subscription, preferences);
          setState({ ...state, device });
          notifyDone("Notification preferences saved.");
        })
      }
    />
  );
}
