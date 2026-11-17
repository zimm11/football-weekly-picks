import type { PushPreferences } from "@picks/shared";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { useAuth } from "../lib/auth";
import { useAction, useFormGuard } from "../lib/hooks";
import { disableNativePush, enableNativePush, nativePushState } from "../lib/notifications";
import { PreferenceToggle } from "./PreferenceToggle";
import { Body, Button, ErrorMessage, Notice } from "./ui";
export function NativeDeviceControls() {
  const { session } = useAuth();
  const action = useAction();
  const [state, setState] = useState<Awaited<ReturnType<typeof nativePushState>>>();
  const [draft, setDraft] = useState<PushPreferences>({ newThreads: true, pickReminders: true });
  const [error, setError] = useState<string>();
  const refresh = useCallback(
    () =>
      nativePushState().then(
        (value) => {
          setState(value);
          setDraft({
            newThreads: value.device?.newThreads ?? true,
            pickReminders: value.device?.pickReminders ?? true,
          });
          setError(undefined);
        },
        () => setError("Couldn’t load notification settings."),
      ),
    [],
  );
  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  const dirty =
    !!state?.device &&
    (draft.newThreads !== state.device.newThreads || draft.pickReminders !== state.device.pickReminders);
  useFormGuard(dirty, () =>
    setDraft({
      newThreads: state?.device?.newThreads ?? true,
      pickReminders: state?.device?.pickReminders ?? true,
    }),
  );
  async function enable() {
    if (!session) return;
    await enableNativePush(draft, session.user.id);
    await refresh();
  }
  return (
    <>
      <ErrorMessage message={error} onRetry={() => void refresh()} />
      {!state && !error ? (
        <Body muted>Checking this device…</Body>
      ) : state && !state.configured ? (
        <Body muted>
          {Platform.OS === "web"
            ? "Device notifications are available in the iPhone and Android app."
            : "Notifications aren't available yet. Please check back later."}
        </Body>
      ) : state?.permission === "denied" ? (
        <>
          <Body>Notifications are blocked on this device.</Body>
          <Body muted>
            Open Settings → Notifications → POW Pick'em → Allow Notifications, then return here.
          </Body>
          <Button title="Open settings" variant="outline" onPress={() => void Linking.openSettings()} />
        </>
      ) : (
        <>
          <Body>
            {state?.device
              ? "Notifications are on for this device."
              : "Notifications are off for this device."}
          </Body>
          {state?.device ? (
            <>
              <PreferenceToggle
                label="New league threads"
                checked={draft.newThreads}
                disabled={action.busy}
                onChange={(value) => setDraft((old) => ({ ...old, newThreads: value }))}
              />
              <PreferenceToggle
                label="Missing-pick reminders"
                checked={draft.pickReminders}
                disabled={action.busy}
                onChange={(value) => setDraft((old) => ({ ...old, pickReminders: value }))}
              />
              <Button
                title={action.busy ? "Saving…" : "Save preferences"}
                disabled={action.busy || !dirty}
                onPress={() => void action.run(enable, "Device settings saved.")}
              />
              <Button
                variant="outline"
                title={action.busy ? "Disconnecting…" : "Turn off on this device"}
                disabled={action.busy}
                onPress={() =>
                  void action.run(async () => {
                    await disableNativePush();
                    await refresh();
                  }, "Device disconnected.")
                }
              />
            </>
          ) : (
            <Button
              title={action.busy ? "Enabling…" : "Enable notifications"}
              disabled={action.busy || !state}
              onPress={() => void action.run(enable, "Notifications enabled.")}
            />
          )}
        </>
      )}
      <ErrorMessage message={action.error} />
      <Notice message={action.status} />
    </>
  );
}
