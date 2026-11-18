import { useRouter } from "expo-router";
import { type ComponentRef, useEffect, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { BackLink } from "../components/BackLink";
import { widths } from "../components/theme";
import { Body, Button, Card, ErrorMessage, Field, Screen, Title } from "../components/ui";
import { getSupabase } from "../lib/api";
import { authFailure } from "../lib/authErrors";
import { useDesktopFocus } from "../lib/desktopFocus";
import { useAction, useFormGuard } from "../lib/hooks";
import { notifyDone } from "../lib/notify";
export function PasswordScreen() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const action = useAction();
  const first = useRef<ComponentRef<typeof TextInput>>(null);
  const second = useRef<ComponentRef<typeof TextInput>>(null);
  useDesktopFocus(first);
  useFormGuard(!saved && (!!password || !!confirmation), () => {
    setPassword("");
    setConfirmation("");
  });
  useEffect(() => {
    if (saved) {
      notifyDone("Password updated.");
      router.replace("/");
    }
  }, [saved, router]);
  const save = () =>
    void action.run(async () => {
      if (password.length < 6) throw new Error("Use a password of at least six characters.");
      if (password !== confirmation) throw new Error("The passwords don't match.");
      const { error } = await (await getSupabase()).auth.updateUser({ password });
      if (error) throw authFailure(error);
      setPassword("");
      setConfirmation("");
      setSaved(true);
    });
  return (
    <Screen narrow contentStyle={{ maxWidth: widths.auth, paddingTop: 32 }}>
      <ViewHeader />
      <Card>
        <Field
          ref={first}
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          reveal
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!action.busy}
          enterKeyHint="next"
          onSubmit={() => second.current?.focus()}
        />
        <Field
          ref={second}
          label="Confirm new password"
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
          reveal
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!action.busy}
          onSubmit={save}
        />
        <ErrorMessage message={action.error} />
        <Button title={action.busy ? "Saving…" : "Save password"} busy={action.busy} onPress={save} />
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
function ViewHeader() {
  return (
    <>
      <BackLink />
      <Title>Choose a new password</Title>
      <Body muted>You'll use it the next time you sign in.</Body>
    </>
  );
}
