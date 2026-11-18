// biome-ignore-all lint/correctness/noReactNativeRawText: Action, Heading and Label render their children inside native Text.
import type { UnsubscribeResult } from "@picks/shared";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, Text } from "react-native";
import { request } from "../src/lib/api";
import { useAuth } from "../src/lib/auth";
import { withNext } from "../src/lib/links";
import { usePageTitle } from "../src/lib/pageTitle";
import { Action, Card, Failure, s } from "../src/screens/leagueUi";

/** Public route. Opening a link never changes preferences; only the explicit button posts. */
export default function Unsubscribe() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = typeof params.token === "string" ? params.token : "";
  const kind = token.split(".")[1];
  const valid = kind === "new_thread" || kind === "pick_reminder" || kind === "league_event";
  const label =
    kind === "new_thread"
      ? "new-thread emails"
      : kind === "league_event"
        ? "results and updates emails"
        : "pick reminder emails";
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const { session, refreshProfile } = useAuth();
  usePageTitle("Unsubscribe");
  async function unsubscribe() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await request<UnsubscribeResult>(`/unsubscribe?token=${encodeURIComponent(token)}`, { method: "POST" });
      setDone(true);
      // Settings reads the signed-in player's cached profile, so it shows the change straight away.
      if (session) await refreshProfile().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't unsubscribe. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content}>
      <Text accessibilityRole="header" aria-level={1} style={s.title}>
        {done ? "You're unsubscribed" : "Unsubscribe"}
      </Text>
      <Card>
        {!valid ? (
          <Failure message="This unsubscribe link isn't valid. Check you copied all of it." />
        ) : done ? (
          <Text accessibilityLiveRegion="polite" style={s.text}>
            You won't get {label} any more.
          </Text>
        ) : (
          <>
            <Text style={s.text}>Stop getting {label} from POW Pick'em?</Text>
            <Failure message={error} />
            <Action
              busy={busy}
              onPress={() => {
                void unsubscribe();
              }}
            >
              {busy ? "Unsubscribing…" : `Turn off ${label}`}
            </Action>
          </>
        )}
        <Text style={s.muted}>
          {session ? "Choose which emails you get in Settings." : "Sign in to choose which emails you get."}
        </Text>
        {/* Signing in comes back here to Settings, which the line above promises. */}
        <Action secondary href={session ? "/account" : withNext("/login", "/account")}>
          {session ? "Settings" : "Sign in"}
        </Action>
      </Card>
    </ScrollView>
  );
}
