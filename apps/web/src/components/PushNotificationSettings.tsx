import type { PushPreferences } from "@picks/shared";
import { type FormEvent, useState } from "react";
import type { PushSupport } from "../push";
import { useUnsavedGuard } from "./ConfirmDialog";
import { HomeScreenInstructions } from "./HomeScreenInstall";
import { Button } from "./ui/button";
import { Card, Notice } from "./ui/card";

type Props = {
  support: PushSupport;
  configured: boolean;
  enabled: boolean;
  denied: boolean;
  preferences: PushPreferences;
  onEnable: () => Promise<void>;
  onDisable: () => Promise<void>;
  onSave: (preferences: PushPreferences) => Promise<void>;
};

/** Device capabilities and browser permission requests live in the page; this form only presents them. */
export function PushNotificationSettings({
  support,
  configured,
  enabled,
  denied,
  preferences,
  onEnable,
  onDisable,
  onSave,
}: Props) {
  const [draft, setDraft] = useState(preferences);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const dirty =
    draft.newThreads !== preferences.newThreads || draft.pickReminders !== preferences.pickReminders;
  const guard = useUnsavedGuard(dirty, "notification preferences");
  // Call immediately: an awaited step before onEnable would lose iOS's user gesture.
  function run(label: string, action: () => Promise<void>) {
    setError(undefined);
    setBusy(label);
    action()
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't update notifications."))
      .finally(() => setBusy(undefined));
  }
  function save(event: FormEvent) {
    event.preventDefault();
    run("Saving…", () => onSave(draft));
  }
  return (
    <>
      {guard}
      <Card>
        <h3 className="text-2xl">Notifications on this device</h3>
        <p className="m-0 text-muted-foreground">
          Get new league threads and reminders for missing picks. Notifications can appear on your lock
          screen, including league names and thread titles.
        </p>
        {support === "home-screen" ? (
          <>
            <p className="m-0 text-muted-foreground">
              On iPhone or iPad, add POW Pick'em to your home screen, open its icon, then return here to
              enable notifications. Requires iOS or iPadOS 16.4 or later.
            </p>
            <HomeScreenInstructions />
          </>
        ) : support === "unsupported" ? (
          <p className="m-0 text-muted-foreground">
            Push notifications aren't supported in this browser. Try an up-to-date browser or the home-screen
            app.
          </p>
        ) : !configured ? (
          <p className="m-0 text-muted-foreground">
            Notifications aren't available yet. Please check back later.
          </p>
        ) : (
          <>
            <p role="status" className="m-0">
              {denied
                ? "Notifications are blocked on this device."
                : enabled
                  ? "Notifications are on for this device."
                  : "Notifications are off for this device."}
            </p>
            {denied && (
              <p className="m-0 text-muted-foreground">
                Notifications are blocked. Allow them in your device or browser notification settings, then
                return here.
              </p>
            )}
            {enabled && (
              <form onSubmit={save} className="grid gap-3">
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={draft.newThreads}
                    disabled={!!busy}
                    onChange={(event) => setDraft({ ...draft, newThreads: event.target.checked })}
                  />
                  New league threads
                </label>
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-primary"
                    checked={draft.pickReminders}
                    disabled={!!busy}
                    onChange={(event) => setDraft({ ...draft, pickReminders: event.target.checked })}
                  />
                  Missing-pick reminders
                </label>
                <p className="m-0 text-sm text-muted-foreground">
                  Reminders start at 7pm in your league's time zone the evening before game day, only when you
                  still have games to pick. Delivery may be delayed by your device or network.
                </p>
                <Button type="submit" disabled={!!busy || !dirty}>
                  {busy === "Saving…" ? busy : "Save preferences"}
                </Button>
              </form>
            )}
            <Button
              type="button"
              variant={enabled ? "outline" : "default"}
              disabled={!!busy || (!enabled && denied)}
              onClick={() => run(enabled ? "Turning off…" : "Enabling…", enabled ? onDisable : onEnable)}
            >
              {busy && busy !== "Saving…"
                ? busy
                : enabled
                  ? "Turn off on this device"
                  : "Enable notifications"}
            </Button>
          </>
        )}
        {error && <Notice kind="alert">{error}</Notice>}
        <p className="m-0 text-sm text-muted-foreground">
          Settings apply to this device. Signing out turns notifications off here. Repeat setup on any other
          device where you want them.
        </p>
      </Card>
    </>
  );
}
