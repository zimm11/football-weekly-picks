import {
  REPORT_NOTE_MAX,
  REPORT_REASON_LABELS,
  REPORT_REASONS,
  type ReportInput,
  type ReportReason,
} from "@picks/shared";
import { useCallback, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { notifyDone } from "../lib/notify";
import { AppLink } from "./AppLink";
import { Icon } from "./Icon";
import { hoverFill } from "./pressState";
import { Body, Button, colors, ErrorMessage, Field, fonts, Sheet } from "./ui";

/** What a report is about, minus the reason and note the sheet asks for. */
export type ReportTarget =
  | Omit<Extract<ReportInput, { kind: "post" }>, "reason" | "note">
  | Omit<Extract<ReportInput, { kind: "display_name" }>, "reason" | "note">
  | Omit<Extract<ReportInput, { kind: "league_name" }>, "reason" | "note">;

/**
 * Report a message, a player's name or a league's name: a reason, an optional note, then **Send report**. Once
 * sent, it offers to block the player too (when there is one).
 *
 * Closing the sheet before sending (a tap outside, Escape) keeps the reason and note, so opening it again for
 * the same thing picks up where the player left off; a report about something else starts empty.
 */
export function ReportSheet({
  target,
  subject,
  onClose,
  onReported,
  onBlock,
}: {
  /** Open while set. */
  target: ReportTarget | null;
  /** What is being reported, for the title: "message from Pat", "Pat's name". */
  subject: string;
  onClose: () => void;
  onReported?: () => void;
  /** Offered after sending, to block the player too. */
  onBlock?: { name: string; run: () => Promise<void> };
}) {
  const [reason, setReason] = useState<ReportReason>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"send" | "block">();
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  // What the unsent reason and note are about.
  const [draftFor, setDraftFor] = useState<string>();
  const about = target ? JSON.stringify(target) : undefined;
  if (about && about !== draftFor) {
    setDraftFor(about);
    setReason(undefined);
    setNote("");
    setError(undefined);
    setSent(false);
  }
  const close = () => {
    if (busy) return;
    setError(undefined);
    // A sent report is done with; an unsent one waits for the sheet to open again.
    if (sent) setDraftFor(undefined);
    onClose();
  };
  async function send() {
    if (!target || !reason || busy) return;
    setBusy("send");
    setError(undefined);
    try {
      await request("/reports", {
        method: "POST",
        body: { ...target, reason, ...(note.trim() && { note: note.trim() }) },
      });
      setSent(true);
      onReported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Sheet visible={!!target} onClose={close} title={sent ? "Report sent" : "Report"}>
      {sent ? (
        <>
          <Body>Thanks. We review reports within 24 hours.</Body>
          {onBlock && (
            <>
              <Body muted>
                Blocking {onBlock.name} hides their threads, replies and reactions from you. It doesn't change
                picks or standings, and they aren't told.
              </Body>
              <Button
                title={busy === "block" ? "Blocking…" : `Block ${onBlock.name}`}
                variant="outline"
                icon="block"
                disabled={!!busy}
                onPress={() => {
                  setBusy("block");
                  void onBlock
                    .run()
                    .then(() => {
                      setBusy(undefined);
                      notifyDone(`${onBlock.name} is blocked.`);
                      close();
                    })
                    .catch((err) => {
                      setBusy(undefined);
                      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
                    });
                }}
              />
            </>
          )}
          <ErrorMessage message={error} />
          <Button title="Done" disabled={!!busy} onPress={close} />
        </>
      ) : (
        <>
          <Body muted>Reporting {subject}. Only the people who review reports see who sent it.</Body>
          <View accessibilityRole="radiogroup" accessibilityLabel="Reason" style={{ gap: 4 }}>
            {REPORT_REASONS.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                // Both: `aria-checked` is what a browser reads, `accessibilityState` what VoiceOver does.
                aria-checked={reason === value}
                accessibilityState={{ checked: reason === value, disabled: !!busy }}
                disabled={!!busy}
                onPress={() => setReason(value)}
                style={(state) => ({
                  minHeight: 44,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: reason === value ? colors.raised : hoverFill(state),
                })}
              >
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    borderWidth: 2,
                    borderColor: reason === value ? colors.primary : colors.mutedForeground,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {reason === value && (
                    <View
                      style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary }}
                    />
                  )}
                </View>
                <Text
                  style={{ fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: colors.foreground }}
                >
                  {REPORT_REASON_LABELS[value]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field
            label="Anything else (optional)"
            value={note}
            onChangeText={setNote}
            maxLength={REPORT_NOTE_MAX}
            multiline
            editable={!busy}
            style={{ minHeight: 88, textAlignVertical: "top" }}
          />
          <ErrorMessage message={error} />
          <Button
            title={busy === "send" ? "Sending…" : "Send report"}
            icon="flag"
            disabled={!reason || !!busy}
            onPress={() => void send()}
          />
        </>
      )}
    </Sheet>
  );
}

/**
 * Asks a player who hasn't agreed to the terms yet to do so before their first post, reply or reaction. `ensure`
 * resolves true at once for a player who has, otherwise once they agree (false if they close the sheet).
 */
export function useTermsGate() {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const waiting = useRef<((agreed: boolean) => void) | undefined>(undefined);
  const accepted = !!auth.me?.moderation?.termsAccepted;
  const ensure = useCallback(() => {
    if (accepted) return Promise.resolve(true);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      waiting.current = resolve;
    });
  }, [accepted]);
  const finish = (agreed: boolean) => {
    setOpen(false);
    setError(undefined);
    waiting.current?.(agreed);
    waiting.current = undefined;
  };
  const sheet = (
    <Sheet visible={open} onClose={() => !busy && finish(false)} title="Message board rules">
      <TermsSummary />
      <ErrorMessage message={error} />
      <Button
        title={busy ? "Saving…" : "Agree and continue"}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void request("/me/terms", { method: "PUT" })
            .then(() => auth.refreshProfile())
            .then(() => {
              setBusy(false);
              finish(true);
            })
            .catch((err) => {
              setBusy(false);
              setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
            });
        }}
      />
      <Button title="Not now" variant="ghost" disabled={busy} onPress={() => finish(false)} />
    </Sheet>
  );
  return { ensure, sheet };
}

/** The short version of the Terms, with a link to the whole page. */
export function TermsSummary() {
  return (
    <View style={{ gap: 12 }}>
      <Body>Trash talk about teams, picks and standings is part of the fun. Keep it about the game.</Body>
      <Body>
        There is no tolerance for harassment, hate, sexual content, threats or spam. Posts are checked
        automatically; what breaks these rules is refused or removed, and players who keep breaking them can't
        post.
      </Body>
      <AppLink href="/terms" style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="document" size={18} color={colors.primary} />
        <Text style={{ fontFamily: fonts.medium, fontSize: 16, color: colors.primary }}>
          Read the Terms of use
        </Text>
      </AppLink>
    </View>
  );
}

/** Blocks or unblocks a player. */
export async function setBlocked(userId: string, blocked: boolean) {
  await request(`/blocks/${encodeURIComponent(userId)}`, { method: blocked ? "PUT" : "DELETE" });
}
