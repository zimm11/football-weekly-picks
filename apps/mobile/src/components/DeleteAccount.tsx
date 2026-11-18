import { type AccountDeletionPreview, deleteAccountSchema, SUPPORT_EMAIL } from "@picks/shared";
import { router } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { messageOf, request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { webTransition } from "../lib/motion";
import { notifyDone } from "../lib/notify";
import { confirmDiscard } from "../lib/unsaved";
import { AppLink, openPath } from "./AppLink";
import { Icon } from "./Icon";
import { hoverFill } from "./pressState";
import { SettingsRow } from "./SettingsRow";
import { corner, radius, space, type } from "./theme";
import { Body, Button, colors, ErrorMessage, Field, fonts, Sheet } from "./ui";

const list = (leagues: { name: string }[]) => leagues.map((l) => l.name).join(", ");

/**
 * Which leagues the player leaves, for the sheet's first sentence. While some still need a new commissioner,
 * those are named only in the list below it, so no league is named twice.
 */
function leavePhrase(preview: AccountDeletionPreview) {
  const waiting = new Set(preview.soleAdmin.map((l) => l.id));
  if (!waiting.size) return preview.leaving.length ? list(preview.leaving) : "your leagues";
  const others = preview.leaving.filter((l) => !waiting.has(l.id));
  const below = waiting.size === 1 ? "the league below" : "the leagues below";
  return others.length ? `${list(others)} and ${below}` : below;
}

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
    // Home first, so the sign-in form never stands in for Settings on the way out.
    router.replace("/");
    await auth.signOut({ accountDeleted: true }).catch(() => undefined);
    notifyDone("Your account was deleted.");
  }

  const blocked = !!preview?.soleAdmin.length;
  return (
    <>
      <SettingsRow icon="trash" label="Delete account" destructive onPress={() => void start()} />
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
              and you leave {leavePhrase(preview)}. Picks from weeks already played stay in the results as
              Deleted player, so nobody else's standings change.
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
              // Each league named once: the ones that need a new commissioner only here, each a link to its League tab.
              <View style={{ gap: space.md }}>
                <Body>
                  First make someone else a commissioner of{" "}
                  {preview.soleAdmin.length === 1
                    ? "this league, so it keeps"
                    : "these leagues, so they keep"}{" "}
                  a commissioner.
                </Body>
                <View role="list" style={{ backgroundColor: colors.raised, ...corner(radius.lg) }}>
                  {preview.soleAdmin.map((league, index) => (
                    <View
                      key={league.id}
                      role="listitem"
                      style={index ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                    >
                      <AppLink
                        href={`/leagues/${league.id}/league`}
                        accessibilityLabel={`Open ${league.name}'s League tab`}
                        onPress={() => {
                          close();
                          void openPath(`/leagues/${league.id}/league`);
                        }}
                        style={(state) => [
                          webTransition(["background-color"]),
                          {
                            minHeight: 48,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: space.md,
                            paddingHorizontal: space.lg,
                            ...corner(radius.lg),
                            backgroundColor: hoverFill(state, colors.raised, colors.raisedHover),
                          },
                        ]}
                      >
                        <Text
                          style={[
                            type.body,
                            { flex: 1, fontFamily: fonts.medium, color: colors.primaryText },
                          ]}
                        >
                          {league.name}
                        </Text>
                        <Icon name="chevron-right" size={16} color={colors.primaryText} />
                      </AppLink>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <>
                <Field
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="current-password"
                  textContentType="password"
                  editable={!busy}
                  enterKeyHint="go"
                  onSubmit={() => {
                    if (password && !busy) void remove();
                  }}
                />
                <ErrorMessage message={error} />
                <Button
                  title={busy === "deleting" ? "Deleting…" : "Delete my account"}
                  variant="destructive"
                  busy={busy === "deleting"}
                  disabled={busy === "loading" || !password}
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
