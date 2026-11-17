// biome-ignore-all lint/correctness/noReactNativeRawText: SettingsHeading renders its children inside native Text.
import type { NotificationSettings } from "@picks/shared";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { BackLink } from "../components/BackLink";
import { DeviceNotifications } from "../components/DeviceNotifications";
import { useHomeScreenHelp } from "../components/HomeScreenInstall";
import { Icon } from "../components/Icon";
import { PreferenceToggle } from "../components/PreferenceToggle";
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
import { appLink } from "../lib/config";
import { useAction, useFormGuard } from "../lib/hooks";
import { openScreen } from "../lib/navigation";
export function AccountScreen() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const settings = useAction();
  const emailAction = useAction();
  useFormGuard(!!email.trim(), () => setEmail(""));
  // In an iPhone browser tab the device card already shows the install steps, so this card would repeat them.
  const homeScreen = useHomeScreenHelp();
  async function notifications(key: keyof NotificationSettings, value: boolean) {
    await request("/me/notifications", { method: "PUT", body: { [key]: value } });
    await auth.refreshProfile();
  }
  return (
    <Screen narrow>
      <BackLink />
      <Title>Settings</Title>
      <View style={{ gap: 12 }}>
        <Title style={{ fontSize: 24, lineHeight: 28 }}>Notifications</Title>
        <Card>
          <SettingsHeading>By email</SettingsHeading>
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
          autoComplete="email"
          editable={!emailAction.busy}
        />
        <ErrorMessage message={emailAction.error} />
        <Notice message={emailAction.status} />
        <Button
          title={emailAction.busy ? "Sending…" : "Change email"}
          disabled={emailAction.busy || !email.trim()}
          onPress={() =>
            void emailAction.run(
              async () => {
                if (email.trim().toLowerCase() === auth.session?.user.email?.toLowerCase())
                  throw new Error("That's already your email.");
                const { error } = await (await getSupabase()).auth.updateUser(
                  { email: email.trim() },
                  { emailRedirectTo: appLink("/account") },
                );
                if (error) throw error;
                setEmail("");
              },
              `Confirm the change from both ${auth.session?.user.email ?? "your current address"} and ${email.trim()}.`,
            )
          }
        />
      </Card>
      <Card>
        <SettingsHeading>Password</SettingsHeading>
        <Pressable
          accessibilityRole="link"
          onPress={() => void openScreen("/reset-password")}
          style={{
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Body style={{ fontFamily: fonts.medium }}>Change password</Body>
          <Icon name="chevron-right" size={18} color={colors.mutedForeground} />
        </Pressable>
      </Card>
      {homeScreen.sheet}
    </Screen>
  );
}
