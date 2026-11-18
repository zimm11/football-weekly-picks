// biome-ignore-all lint/correctness/noReactNativeRawText: SettingsHeading renders its children inside native Text.
import { type BlockedPlayer, type NotificationSettings, SUPPORT_EMAIL } from "@picks/shared";
import { type ComponentRef, useRef, useState } from "react";
import { Text, type TextInput, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { BackLink } from "../components/BackLink";
import { DeleteAccount } from "../components/DeleteAccount";
import { DeviceNotifications } from "../components/DeviceNotifications";
import { FadeIn } from "../components/FadeIn";
import { useHomeScreenHelp } from "../components/HomeScreenInstall";
import { setBlocked } from "../components/Moderation";
import { PreferenceToggle } from "../components/PreferenceToggle";
import { SettingsHeading } from "../components/SettingsHeading";
import { SettingsRow, SettingsRowPanel, SettingsRows } from "../components/SettingsRow";
import { colors, space, type } from "../components/theme";
import { Body, Button, Card, ErrorMessage, Field, Notice, Screen, Title } from "../components/ui";
import { getSupabase, request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { authFailure } from "../lib/authErrors";
import { appLink } from "../lib/config";
import { useAction, useFormGuard, useResource } from "../lib/hooks";
import { notifyDone, notifyError } from "../lib/notify";
import { Action } from "./leagueUi";

/** One of Settings' three groups: its title, then its cards. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.lg }}>
      <Title level={2} size="heading">
        {title}
      </Title>
      {children}
    </View>
  );
}

export function AccountScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [editingEmail, setEditingEmail] = useState(false);
  const emailField = useRef<ComponentRef<typeof TextInput>>(null);
  const settings = useAction();
  const emailAction = useAction();
  useFormGuard(!!email.trim(), () => setEmail(""));
  // In an iPhone browser tab the device card already shows the install steps, so this card would repeat them.
  const homeScreen = useHomeScreenHelp();
  const currentEmail = auth.session?.user.email ?? "";
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
  const closeEmail = () => {
    setEditingEmail(false);
    setEmail("");
  };
  async function notifications(key: keyof NotificationSettings, value: boolean) {
    await request("/me/notifications", { method: "PUT", body: { [key]: value } });
    await auth.refreshProfile();
  }
  const name = auth.me?.displayName ?? "";
  return (
    <Screen narrow contentStyle={{ gap: space["3xl"] }}>
      <View style={{ gap: space.lg }}>
        <BackLink />
        <Title>Settings</Title>
      </View>
      <Group title="Notifications">
        <Card>
          <SettingsHeading level={3}>By email</SettingsHeading>
          <View style={{ gap: space.md }}>
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
      </Group>
      <Group title="Account">
        <SettingsRows>
          <SettingsRow
            key="name"
            icon="user"
            label="Name and picture"
            href="/change-name"
            accessibilityLabel={name ? `Name and picture, ${name}` : undefined}
            trailing={
              name ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, maxWidth: "45%" }}>
                  <Text
                    numberOfLines={1}
                    style={[type.small, { color: colors.mutedForeground, flexShrink: 1 }]}
                  >
                    {name}
                  </Text>
                  <Avatar name={name} avatarId={auth.me?.avatarId ?? null} size={28} />
                </View>
              ) : undefined
            }
          />
          <SettingsRow
            key="email"
            icon="email"
            label="Email"
            detail={currentEmail || undefined}
            expanded={editingEmail}
            onPress={() => {
              if (editingEmail) closeEmail();
              else {
                setEditingEmail(true);
                // After the field has mounted.
                setTimeout(() => emailField.current?.focus(), 0);
              }
            }}
          >
            {editingEmail && (
              <FadeIn from={-4}>
                <SettingsRowPanel>
                  <Field
                    ref={emailField}
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
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.md }}>
                    <Button
                      fit
                      title={emailAction.busy ? "Sending…" : "Change email"}
                      busy={emailAction.busy}
                      disabled={!email.trim()}
                      onPress={changeEmail}
                    />
                    <Button
                      fit
                      title="Cancel"
                      variant="ghost"
                      disabled={emailAction.busy}
                      onPress={closeEmail}
                    />
                  </View>
                </SettingsRowPanel>
              </FadeIn>
            )}
          </SettingsRow>
          <SettingsRow key="password" icon="lock" label="Password" href="/reset-password" />
          <DeleteAccount key="delete" />
        </SettingsRows>
        <BlockedPlayers />
      </Group>
      <Group title="Help">
        {homeScreen.available && (
          <Card>
            <SettingsHeading level={3}>Home screen app</SettingsHeading>
            <Body muted>
              Open POW Pick'em from your home screen like any other app. On iPhone, that's also how
              notifications work.
            </Body>
            <Button title="Show me how" variant="outline" onPress={homeScreen.open} />
          </Card>
        )}
        <SettingsRows>
          <SettingsRow
            key="support"
            icon="email"
            label="Contact support"
            detail={SUPPORT_EMAIL}
            mail={SUPPORT_EMAIL}
          />
          <SettingsRow key="terms" icon="document" label="Terms of use" href="/terms" />
          <SettingsRow key="privacy" icon="shield" label="Privacy policy" href="/privacy" />
          <SettingsRow key="guide" icon="question" label="How to play" href="/how-to-play" />
        </SettingsRows>
      </Group>
      {homeScreen.sheet}
    </Screen>
  );
}

/** Players you blocked, with Unblock. Hidden while there are none. */
function BlockedPlayers() {
  const blocked = useResource<BlockedPlayer[]>("/blocks");
  const [busy, setBusy] = useState<string>();
  if (!blocked.data?.length) return null;
  return (
    <Card>
      <SettingsHeading level={3}>Blocked players</SettingsHeading>
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
