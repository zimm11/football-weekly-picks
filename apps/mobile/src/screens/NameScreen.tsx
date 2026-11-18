import { DISPLAY_NAME_MAX, updateProfileSchema } from "@picks/shared";
import { useRouter } from "expo-router";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { Text, type TextInput, View } from "react-native";
import { Avatar } from "../components/Avatar";
import { BackLink } from "../components/BackLink";
import { ProfilePicture } from "../components/ProfilePicture";
import { colors, space, type, widths } from "../components/theme";
import { Button, Card, ErrorMessage, Field, Screen, Title } from "../components/ui";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useDesktopFocus } from "../lib/desktopFocus";
import { useAction, useFormGuard } from "../lib/hooks";
import { notifyDone } from "../lib/notify";
export function NameScreen() {
  const auth = useAuth();
  const router = useRouter();
  const [name, setName] = useState(auth.me?.displayName ?? "");
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  useDesktopFocus(field);
  const changed = !!name.trim() && name.trim() !== auth.me?.displayName;
  useFormGuard(!saved && name.trim() !== auth.me?.displayName, () => setName(auth.me?.displayName ?? ""));
  useEffect(() => {
    if (saved) {
      notifyDone("Name saved.");
      if (router.canGoBack()) router.back();
      else router.replace("/");
    }
  }, [saved, router]);
  const save = () => {
    // Nothing to save until the name is there and different.
    if (!changed || action.busy) return;
    void action.run(async () => {
      const parsed = updateProfileSchema.safeParse({ displayName: name });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Enter a name");
      await request("/me", { method: "PUT", body: parsed.data });
      await auth.refreshProfile();
      setSaved(true);
    });
  };
  return (
    <Screen narrow contentStyle={{ maxWidth: widths.form, paddingTop: space["4xl"] }}>
      <BackLink />
      <Title>Name and picture</Title>
      <Card>
        <NamePreview name={name} avatarId={auth.me?.avatarId ?? null} />
        <Field
          ref={field}
          label="Display name"
          value={name}
          onChangeText={setName}
          autoComplete="nickname"
          autoCapitalize="words"
          maxLength={DISPLAY_NAME_MAX}
          editable={!action.busy}
          onSubmit={save}
        />
        <ErrorMessage message={action.error} />
        <Button
          title={action.busy ? "Saving…" : "Save name"}
          busy={action.busy}
          disabled={!changed}
          onPress={save}
        />
        <Button
          title="Cancel"
          variant="ghost"
          disabled={action.busy}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />
      </Card>
      {auth.me?.displayName && (
        <ProfilePicture
          avatarId={auth.me.avatarId ?? null}
          onSave={async (avatarId) => {
            await request("/me/avatar", { method: "PUT", body: { avatarId } });
            await auth.refreshProfile();
          }}
        />
      )}
    </Screen>
  );
}

/**
 * The name as the league will see it, while it is typed: the avatar (the chosen picture, or the typed name's
 * initials and color), the name in the card-title style, and a muted line saying what this is. The sign-up
 * name step draws the same row.
 */
function NamePreview({ name, avatarId }: { name: string; avatarId: number | null }) {
  const shown = name.trim();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
      <Avatar name={shown} avatarId={avatarId} size={48} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[type.cardTitle, { color: shown ? colors.foreground : colors.mutedForeground }]}
        >
          {shown || "Your name"}
        </Text>
        <Text style={[type.small, { color: colors.mutedForeground }]}>How your league sees you</Text>
      </View>
    </View>
  );
}
