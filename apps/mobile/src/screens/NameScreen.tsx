import { DISPLAY_NAME_MAX, updateProfileSchema } from "@picks/shared";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { BackLink } from "../components/BackLink";
import { ProfilePicture } from "../components/ProfilePicture";
import { Body, Button, Card, ErrorMessage, Field, Screen, Title } from "../components/ui";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAction, useFormGuard } from "../lib/hooks";
import { notifyDone } from "../lib/notify";
export function NameScreen() {
  const auth = useAuth();
  const router = useRouter();
  const [name, setName] = useState(auth.me?.displayName ?? "");
  const [saved, setSaved] = useState(false);
  const action = useAction();
  useFormGuard(!saved && name.trim() !== auth.me?.displayName, () => setName(auth.me?.displayName ?? ""));
  useEffect(() => {
    if (saved) {
      notifyDone("Name saved.");
      if (router.canGoBack()) router.back();
      else router.replace("/");
    }
  }, [saved, router]);
  return (
    <Screen narrow contentStyle={{ maxWidth: 416, paddingTop: 32 }}>
      <BackLink />
      <Title>Name and picture</Title>
      <Body muted>This is how your leagues see you on the leaderboard.</Body>
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
      <Card>
        <Field
          label="Display name"
          value={name}
          onChangeText={setName}
          maxLength={DISPLAY_NAME_MAX}
          editable={!action.busy}
        />
        <ErrorMessage message={action.error} />
        <Button
          title={action.busy ? "Saving…" : "Save name"}
          disabled={action.busy || !name.trim()}
          onPress={() =>
            void action.run(async () => {
              const parsed = updateProfileSchema.safeParse({ displayName: name });
              if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Enter a name");
              await request("/me", { method: "PUT", body: parsed.data });
              await auth.refreshProfile();
              setSaved(true);
            })
          }
        />
        <Button
          title="Cancel"
          variant="ghost"
          disabled={action.busy}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />
      </Card>
    </Screen>
  );
}
