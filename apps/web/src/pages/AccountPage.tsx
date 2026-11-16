import type { Me, NotificationSettings } from "@picks/shared";
import { useState } from "react";
import { EmailChangeForm, NotificationSettingsForm } from "@/components/AccountForms";
import { LoadError } from "@/components/LoadError";
import { SettingsSkeleton } from "@/components/Skeletons";
import { Card, Eyebrow } from "@/components/ui/card";
import { api, getSupabase, messageOf, unwrap } from "../api";
import { useUnsavedGuard } from "../components/ConfirmDialog";
import { notifyDone, notifyError } from "../notify";
import { Link } from "../router";
import { useLoad } from "./useLoad";

/** Which notification emails to get, the email address, and a way to the change-password screen. */
export function AccountPage({ email }: { email?: string }) {
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

  return (
    <div className="mx-auto grid max-w-lg gap-5">
      <h2 className="text-4xl leading-none font-extrabold">Account</h2>
      <Card aria-labelledby="notifications-heading">
        <Eyebrow id="notifications-heading" className="m-0">
          Notification emails
        </Eyebrow>
        {settings.error && <LoadError message={settings.error} onRetry={settings.reload} />}
        {settings.data ? (
          <NotificationSettingsForm settings={settings.data} onChange={changeNotifications} />
        ) : (
          !settings.error && <SettingsSkeleton label="Loading email settings" />
        )}
      </Card>
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
