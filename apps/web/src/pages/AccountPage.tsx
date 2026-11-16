import type { Me, NotificationSettings } from "@picks/shared";
import { useState } from "react";
import { EmailChangeForm, NotificationSettingsForm } from "@/components/AccountForms";
import { SettingsSkeleton } from "@/components/Skeletons";
import { Button } from "@/components/ui/button";
import { Card, Eyebrow, Notice } from "@/components/ui/card";
import { api, getSupabase, messageOf, unwrap } from "../api";
import { useUnsavedGuard } from "../components/ConfirmDialog";
import { notifyDone, notifyError } from "../notify";
import { pushSupport } from "../push";
import { Link } from "../router";
import { DeviceNotifications } from "./DeviceNotifications";
import { useLoad } from "./useLoad";

/**
 * Settings: every way the app reaches the player (email and this device's notifications), the home-screen
 * app, the email address, and a way to the change-password screen.
 */
export function AccountPage({
  email,
  onAddToHomeScreen,
}: {
  email?: string;
  /** Opens the home-screen help over this screen. Absent once the app runs from the home screen. */
  onAddToHomeScreen?: () => void;
}) {
  // Loaded here rather than reused from the app shell: an unsubscribe link may have changed them since.
  const settings = useLoad(async () => (await unwrap<Me>(api.me.$get())).notifications, "notifications");
  const [emailDirty, setEmailDirty] = useState(false);
  const unsavedDialog = useUnsavedGuard(emailDirty, "email changes");

  async function changeEmail(next: string) {
    const { error } = await (await getSupabase()).auth.updateUser(
      { email: next },
      { emailRedirectTo: `${window.location.origin}/account` },
    );
    if (error) return error.message;
    notifyDone(`Confirm the change from both ${email ?? "your current address"} and ${next}.`);
    return undefined;
  }

  async function changeNotifications(patch: Partial<NotificationSettings>) {
    try {
      settings.setData(await unwrap<NotificationSettings>(api.me.notifications.$put({ json: patch })));
      notifyDone("Email settings saved.");
    } catch (err) {
      notifyError(messageOf(err));
    }
  }

  // In an iPhone browser tab the device card already shows the install steps, so the home-screen card would
  // repeat them.
  const showHomeScreen = onAddToHomeScreen && pushSupport() !== "home-screen";

  return (
    <div className="mx-auto grid max-w-lg gap-5">
      <h2 className="text-4xl leading-none font-extrabold">Settings</h2>
      <section aria-labelledby="notifications-title" className="grid gap-3">
        <h3 id="notifications-title" className="text-2xl">
          Notifications
        </h3>
        <Card aria-labelledby="email-notifications-heading">
          <Eyebrow id="email-notifications-heading" className="m-0">
            By email
          </Eyebrow>
          {settings.error && <Notice kind="alert">{settings.error}</Notice>}
          {settings.data ? (
            <NotificationSettingsForm settings={settings.data} onChange={changeNotifications} />
          ) : (
            !settings.error && <SettingsSkeleton label="Loading email settings" />
          )}
        </Card>
        <DeviceNotifications />
      </section>
      {showHomeScreen && (
        <Card aria-labelledby="home-screen-heading">
          <Eyebrow id="home-screen-heading" className="m-0">
            Home screen app
          </Eyebrow>
          <p className="m-0 text-muted-foreground">
            Open POW Pick'em from your home screen like any other app. On iPhone, that's also how
            notifications work.
          </p>
          <Button variant="outline" onClick={onAddToHomeScreen}>
            Show me how
          </Button>
        </Card>
      )}
      <Card aria-labelledby="email-heading">
        <Eyebrow id="email-heading" className="m-0">
          Email address
        </Eyebrow>
        <EmailChangeForm currentEmail={email} onSubmit={changeEmail} onDirtyChange={setEmailDirty} />
      </Card>
      <Card aria-labelledby="password-heading">
        <Eyebrow id="password-heading" className="m-0">
          Password
        </Eyebrow>
        <Link
          to="/reset-password"
          className="-mx-2 flex min-h-11 items-center rounded-md px-2 font-medium text-foreground no-underline transition-colors hover:bg-raised"
        >
          Change password
        </Link>
      </Card>
      {unsavedDialog}
    </div>
  );
}
