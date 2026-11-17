// biome-ignore-all lint/correctness/noReactNativeRawText: SettingsHeading renders its children inside native Text.
import { type AccountDeletionPreview, deleteAccountSchema, SUPPORT_EMAIL } from "@picks/shared";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { messageOf, request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { notifyDone } from "../lib/notify";
import { confirmDiscard } from "../lib/unsaved";
import { Icon } from "./Icon";
import { SettingsHeading } from "./SettingsHeading";
import { Body, Button, Card, colors, ErrorMessage, Field, fonts, Sheet } from "./ui";

const list = (leagues: { name: string }[]) => leagues.map((l) => l.name).join(", ");

/**
 * Settings → Delete account (App Store guideline 5.1.1(v)). A sheet says what will happen, asks for the password,
 * and deletes at once; then this device signs out.
 */
export function DeleteAccount() {
  const auth = useAuth();
  const [preview, setPreview] = useState<AccountDeletionPreview>();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"loading" | "deleting">();
  const [error, setError] = useState<string>();

  async function start() {
    // Like Sign out: work not saved elsewhere is asked about first.
    if (!(await confirmDiscard())) return;
    setOpen(true);
    setError(undefined);
    setBusy("loading");
    try {
      setPreview(await request<AccountDeletionPreview>("/me/deletion"));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(undefined);
    }
  }
  function close() {
    if (busy === "deleting") return;
    setOpen(false);
    setPassword("");
    setError(undefined);
  }
  async function remove() {
    const parsed = deleteAccountSchema.safeParse({ password });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message);
    setBusy("deleting");
    setError(undefined);
    try {
      await request("/me", { method: "DELETE", body: parsed.data });
    } catch (err) {
      setBusy(undefined);
      return setError(messageOf(err));
    }
    setOpen(false);
    await auth.signOut({ accountDeleted: true }).catch(() => undefined);
    router.replace("/");
    notifyDone("Your account was deleted.");
  }

  const blocked = !!preview?.soleAdmin.length;
  return (
    <>
      <Card>
        <SettingsHeading>Delete account</SettingsHeading>
        <Body muted>
          Deletes your email, name, devices and messages. Results from weeks already played stay, as Deleted
          player.
        </Body>
        <Button title="Delete account" variant="destructive" onPress={() => void start()} />
      </Card>
      <Sheet visible={open} onClose={close} title="Delete your account?">
        {busy === "loading" && <Body muted>Checking your leagues…</Body>}
        {preview && !preview.available && (
          <Body>
            Account deletion isn't available in the app yet. Email {SUPPORT_EMAIL} and we'll delete it for
            you.
          </Body>
        )}
        {preview?.available && (
          <>
            <Body>
              This can't be undone. Your email, name, notification settings, devices and messages are deleted,
              and you leave {preview.leaving.length ? list(preview.leaving) : "your leagues"}. Picks from
              weeks already played stay in the results as Deleted player, so nobody else's standings change.
            </Body>
            {auth.me?.isOperator && (
              <Body muted>You run the app: take your id out of OPERATOR_USER_IDS afterwards.</Body>
            )}
            {preview.deletedLeagues.length > 0 && (
              <Body muted>
                You're the only member of {list(preview.deletedLeagues)}, so{" "}
                {preview.deletedLeagues.length === 1 ? "it is" : "they are"} deleted too.
              </Body>
            )}
            {blocked ? (
              <View style={{ gap: 8 }}>
                <Body>
                  First make someone else an admin of {list(preview.soleAdmin)}, so{" "}
                  {preview.soleAdmin.length === 1 ? "it keeps" : "they keep"} an admin.
                </Body>
                {preview.soleAdmin.map((league) => (
                  <Pressable
                    key={league.id}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${league.name}'s League tab`}
                    onPress={() => {
                      close();
                      router.push({ pathname: "/leagues/[id]/league", params: { id: league.id } });
                    }}
                    style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}
                  >
                    <Text style={{ flex: 1, fontFamily: fonts.medium, fontSize: 16, color: colors.primary }}>
                      {league.name}
                    </Text>
                    <Icon name="chevron-right" size={18} color={colors.primary} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <>
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="current-password"
                  editable={!busy}
                />
                <ErrorMessage message={error} />
                <Button
                  title={busy === "deleting" ? "Deleting…" : "Delete my account"}
                  variant="destructive"
                  disabled={!!busy || !password}
                  onPress={() => void remove()}
                />
              </>
            )}
          </>
        )}
        {!preview && <ErrorMessage message={error} />}
        <Button title="Cancel" variant="ghost" disabled={busy === "deleting"} onPress={close} />
      </Sheet>
    </>
  );
}
