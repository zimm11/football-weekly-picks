import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { BackLink } from "../components/BackLink";
import { Body, Button, Card, ErrorMessage, Field, Screen, Title } from "../components/ui";
import { getSupabase } from "../lib/api";
import { useAction, useFormGuard } from "../lib/hooks";
import { notifyDone } from "../lib/notify";
export function PasswordScreen() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saved, setSaved] = useState(false);
  const router = useRouter();
  const action = useAction();
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
  return (
    <Screen narrow contentStyle={{ maxWidth: 416, paddingTop: 32 }}>
      <ViewHeader />
      <Card>
        <Field
          label="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          editable={!action.busy}
        />
        <Field
          label="Confirm new password"
          value={confirmation}
          onChangeText={setConfirmation}
          secureTextEntry
          autoComplete="new-password"
          editable={!action.busy}
        />
        <ErrorMessage message={action.error} />
        <Button
          title={action.busy ? "Saving…" : "Save password"}
          disabled={action.busy}
          onPress={() =>
            void action.run(async () => {
              if (password.length < 6) throw new Error("Use a password of at least six characters.");
              if (password !== confirmation) throw new Error("The passwords don't match.");
              const { error } = await (await getSupabase()).auth.updateUser({ password });
              if (error) throw error;
              setPassword("");
              setConfirmation("");
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
function ViewHeader() {
  return (
    <>
      <BackLink />
      <Title>Choose a new password</Title>
      <Body muted>You'll use it the next time you sign in.</Body>
    </>
  );
}
