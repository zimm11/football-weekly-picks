// biome-ignore-all lint/correctness/noReactNativeRawText: SettingsHeading renders its children inside native Text.
import { type BlockedPlayer, type NotificationSettings, SUPPORT_EMAIL } from "@picks/shared";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppLink } from "../components/AppLink";
import { BackLink } from "../components/BackLink";
import { DeleteAccount } from "../components/DeleteAccount";
import { DeviceNotifications } from "../components/DeviceNotifications";
import { useHomeScreenHelp } from "../components/HomeScreenInstall";
import { Icon } from "../components/Icon";
import { setBlocked } from "../components/Moderation";
import { PreferenceToggle } from "../components/PreferenceToggle";
import { ProfilePicture } from "../components/ProfilePicture";
import { hoverFill } from "../components/pressState";
import { SettingsHeading } from "../components/SettingsHeading";
import {
  Body,
  Button,
  Card,
  colors,
  ErrorMessage,
  Field,
  fonts,
  Notice,
  Screen,
  Title,
} from "../components/ui";
import { getSupabase, request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { authFailure } from "../lib/authErrors";
import { appLink } from "../lib/config";
import { useAction, useFormGuard, useResource } from "../lib/hooks";
import { mailtoProps } from "../lib/mail";
import { notifyDone, notifyError } from "../lib/notify";
import { Action } from "./leagueUi";
export function AccountScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const settings = useAction();
  const emailAction = useAction();
  useFormGuard(!!email.trim(), () => setEmail(""));
  // In an iPhone browser tab the device card already shows the install steps, so this card would repeat them.
  const homeScreen = useHomeScreenHelp();
  const changeEmail = () => {
    if (!email.trim()) return;
    const from = auth.session?.user.email;
    void emailAction.run(
      async () => {
        if (email.trim().toLowerCase() === from?.toLowerCase()) throw new Error("That's already your email.");
        const { error } = await (await getSupabase()).auth.updateUser(
          { email: email.trim() },
          { emailRedirectTo: appLink("/account") },
        );
        if (error) throw authFailure(error);
        setEmail("");
      },
      `Confirm the change from both ${from ?? "your current address"} and ${email.trim()}.`,
    );
  };
  async function notifications(key: keyof NotificationSettings, value: boolean) {
    await request("/me/notifications", { method: "PUT", body: { [key]: value } });
    await auth.refreshProfile();
  }
  return (
    <Screen narrow>
      <BackLink />
      <Title>Settings</Title>
      {auth.me?.displayName && (
        <ProfilePicture
          name={auth.me.displayName}
          avatarId={auth.me.avatarId ?? null}
          onSave={async (avatarId) => {
            await request("/me/avatar", { method: "PUT", body: { avatarId } });
            await auth.refreshProfile();
          }}
        />
      )}
      <View style={{ gap: 12 }}>
        <Title level={2} style={{ fontSize: 24, lineHeight: 28 }}>
          Notifications
        </Title>
        <Card>
          <SettingsHeading level={3}>By email</SettingsHeading>
          <View style={{ gap: 8 }}>
            <PreferenceToggle
              label="New message threads"
              description="When someone starts a thread on one of your leagues' message boards."
              checked={auth.me?.notifications.newThreads ?? true}
              disabled={settings.busy}
              onChange={(value) =>
                void settings.run(() => notifications("newThreads", value), "Email settings saved.")
              }
            />
            <PreferenceToggle
              label="Pick reminders"
              description="At 7pm the evening before a game day, if you still have games to pick."
              checked={auth.me?.notifications.pickReminders ?? true}
              disabled={settings.busy}
              onChange={(value) =>
                void settings.run(() => notifications("pickReminders", value), "Email settings saved.")
              }
            />
            <PreferenceToggle
              label="Results and updates"
              description="When a week opens or is final in a league that runs itself, and when you're added to a league."
              checked={auth.me?.notifications.leagueEvents ?? true}
              disabled={settings.busy}
              onChange={(value) =>
                void settings.run(() => notifications("leagueEvents", value), "Email settings saved.")
              }
            />
          </View>
          <ErrorMessage message={settings.error} />
          <Notice message={settings.status} />
        </Card>
        <DeviceNotifications />
      </View>
      {homeScreen.available && (
        <Card>
          <SettingsHeading>Home screen app</SettingsHeading>
          <Body muted>
            Open POW Pick'em from your home screen like any other app. On iPhone, that's also how
            notifications work.
          </Body>
          <Button title="Show me how" variant="outline" onPress={homeScreen.open} />
        </Card>
      )}
      <Card>
        <SettingsHeading>Email address</SettingsHeading>
        <Field label="Current email" value={auth.session?.user.email ?? ""} editable={false} />
        <Field
          label="New email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          editable={!emailAction.busy}
          onSubmit={changeEmail}
        />
        <ErrorMessage message={emailAction.error} />
        <Notice message={emailAction.status} />
        <Button
          title={emailAction.busy ? "Sending…" : "Change email"}
          busy={emailAction.busy}
          disabled={!email.trim()}
          onPress={changeEmail}
        />
      </Card>
      <BlockedPlayers />
      <Card>
        <SettingsHeading>Help</SettingsHeading>
        <SettingsLink icon="email" label="Contact support" detail={SUPPORT_EMAIL} mail={SUPPORT_EMAIL} />
        <SettingsLink icon="document" label="Terms of use" href="/terms" />
        <SettingsLink icon="lock" label="Privacy policy" href="/privacy" />
      </Card>
      <Card>
        <SettingsHeading>Password</SettingsHeading>
        <SettingsLink label="Change password" href="/reset-password" />
      </Card>
      <DeleteAccount />
      {homeScreen.sheet}
    </Screen>
  );
}

/** A row in a Settings card: another page (`href`, a real link) or an email to `mail`. */
function SettingsLink({
  icon,
  label,
  detail,
  mail,
  href,
}: {
  icon?: "email" | "document" | "lock";
  label: string;
  detail?: string;
  mail?: string;
  href?: string;
}) {
  const shared = {
    accessibilityLabel: detail ? `${label}, ${detail}` : undefined,
    style: (state: Parameters<typeof hoverFill>[0]) => ({
      minHeight: 44,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      marginHorizontal: -8,
      paddingHorizontal: 8,
      borderRadius: 10,
      backgroundColor: hoverFill(state),
    }),
  };
  const content = (
    <>
      {icon && <Icon name={icon} size={18} color={colors.mutedForeground} />}
      <View style={{ flex: 1 }}>
        <Body style={{ fontFamily: fonts.medium }}>{label}</Body>
        {detail && <Body muted>{detail}</Body>}
      </View>
      <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
    </>
  );
  if (href)
    return (
      <AppLink href={href} {...shared}>
        {content}
      </AppLink>
    );
  return (
    <Pressable accessibilityRole="link" {...(mail ? mailtoProps(mail) : null)} {...shared}>
      {content}
    </Pressable>
  );
}

/** Players you blocked, with Unblock. Hidden while there are none. */
function BlockedPlayers() {
  const blocked = useResource<BlockedPlayer[]>("/blocks");
  const [busy, setBusy] = useState<string>();
  if (!blocked.data?.length) return null;
  return (
    <Card>
      <SettingsHeading>Blocked players</SettingsHeading>
      <Body muted>
        Their threads, replies and reactions are hidden from you. Picks and standings don't change.
      </Body>
      {blocked.data.map((player) => (
        <View
          key={player.userId}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}
        >
          <Body style={{ flex: 1 }}>{player.displayName}</Body>
          <Action
            secondary
            compact
            label={`Unblock ${player.displayName}`}
            busy={busy === player.userId}
            disabled={!!busy && busy !== player.userId}
            onPress={() => {
              setBusy(player.userId);
              void setBlocked(player.userId, false)
                .then(() => {
                  notifyDone(`${player.displayName} is unblocked.`);
                  blocked.setData(blocked.data?.filter((p) => p.userId !== player.userId));
                })
                .catch((err) => notifyError(err instanceof Error ? err.message : "Couldn't unblock."))
                .finally(() => setBusy(undefined));
            }}
          >
            {busy === player.userId ? "Unblocking…" : "Unblock"}
          </Action>
        </View>
      ))}
    </Card>
  );
}
