import {
  FEEDBACK_KIND_LABELS,
  type FeedbackKind,
  feedbackPageSchema,
  sendFeedbackSchema,
} from "@picks/shared";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "../components/Icon";
import { Menu, MenuItem, useAnchor } from "../components/Popover";
import { Body, Button, Card, colors, ErrorMessage, Field, fonts, Screen, Title } from "../components/ui";
import { WebSelect } from "../components/WebSelect";
import { request } from "../lib/api";
import { useAction, useFormGuard } from "../lib/hooks";
import { notifyDone } from "../lib/notify";
import { confirmDiscard } from "../lib/unsaved";

const KINDS = ["bug", "feature", "other"] as const;

const prompts = {
  bug: "What happened, and what did you expect instead?",
  feature: "What would you like the app to do?",
  other: "What's on your mind?",
};
export function FeedbackScreen() {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [message, setMessage] = useState("");
  const choose = useAnchor();
  const [sent, setSent] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const action = useAction();
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const parsed = feedbackPageSchema.safeParse(params.from);
  const from = parsed.success ? parsed.data : "/";
  useFormGuard(!sent && !leaving && !!message.trim(), () => setMessage(""));
  useEffect(() => {
    if (sent) {
      notifyDone("Thanks. Your feedback was sent.");
      router.replace(from as Href);
    }
  }, [sent, router, from]);
  // Leaves once the guard above has let go, so a confirmed Cancel doesn't ask twice.
  useEffect(() => {
    if (leaving) router.replace(from as Href);
  }, [leaving, router, from]);
  return (
    <Screen narrow contentStyle={{ paddingTop: 32 }}>
      <View style={{ gap: 8 }}>
        <Title>Send feedback</Title>
        <Body muted>Found a bug or have an idea? It goes straight to the people who run POW Pick'em.</Body>
      </View>
      <Card>
        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: fonts.medium, fontSize: 14, color: colors.foreground }}>
            What kind of feedback?
          </Text>
          {WebSelect ? (
            <WebSelect
              label="What kind of feedback?"
              value={kind}
              choices={KINDS.map((value) => ({ value, label: FEEDBACK_KIND_LABELS[value] }))}
              onChange={(value) => setKind(KINDS.find((k) => k === value) ?? kind)}
              disabled={action.busy}
            />
          ) : (
            <Pressable
              ref={choose.ref}
              accessibilityRole="button"
              accessibilityLabel={`What kind of feedback? ${FEEDBACK_KIND_LABELS[kind]}`}
              disabled={action.busy}
              onPress={choose.open}
              style={{
                minHeight: 44,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.input,
                padding: 12,
                backgroundColor: colors.background,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Body>{FEEDBACK_KIND_LABELS[kind]}</Body>
              <Icon name="chevron-down" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <Field
          label={prompts[kind]}
          value={message}
          onChangeText={setMessage}
          multiline
          maxLength={4000}
          style={{ minHeight: 160, textAlignVertical: "top" }}
          editable={!action.busy}
        />
        <ErrorMessage message={action.error} />
        <View style={{ gap: 8 }}>
          <Button
            title={action.busy ? "Sending…" : "Send feedback"}
            disabled={action.busy || !message.trim()}
            onPress={() =>
              void action.run(async () => {
                await request("/feedback", {
                  method: "POST",
                  body: sendFeedbackSchema.parse({ kind, message, page: from }),
                });
                setMessage("");
                setSent(true);
              })
            }
          />
          <Button
            title="Cancel"
            variant="ghost"
            disabled={action.busy}
            onPress={() => {
              // Asks first on every platform, as the web form's Cancel does.
              void confirmDiscard().then((leave) => leave && setLeaving(true));
            }}
          />
        </View>
      </Card>
      {/* A dropdown under the control, as the web form's select. */}
      <Menu
        anchor={choose.anchor}
        onClose={choose.close}
        label="What kind of feedback?"
        width={choose.anchor?.width}
      >
        {KINDS.map((value) => (
          <MenuItem
            key={value}
            label={FEEDBACK_KIND_LABELS[value]}
            checked={value === kind}
            onPress={() => {
              setKind(value);
              choose.close();
            }}
          />
        ))}
      </Menu>
    </Screen>
  );
}
