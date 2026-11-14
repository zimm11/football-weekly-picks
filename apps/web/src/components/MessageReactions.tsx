import { MESSAGE_REACTIONS, type MessageEmoji, type MessageReaction } from "@picks/shared";
import { useState } from "react";
import { messageOf } from "../api";
import { notifyError } from "../notify";
import { Button } from "./ui/button";

export function MessageReactions({
  reactions,
  onChange,
}: {
  reactions: MessageReaction[];
  onChange: (emoji: MessageEmoji, active: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState<MessageEmoji>();
  return (
    <fieldset aria-label="Message reactions" className="flex flex-wrap gap-2">
      {MESSAGE_REACTIONS.map(({ emoji, label }) => {
        const reaction = reactions.find((r) => r.emoji === emoji);
        return (
          <Button
            key={emoji}
            variant={reaction?.reacted ? "default" : "outline"}
            className="min-w-11 px-3 font-sans text-base"
            aria-label={`${label}, ${reaction?.count ?? 0} reactions`}
            aria-pressed={reaction?.reacted ?? false}
            title={`${reaction?.reacted ? "Remove" : "Add"} ${label.toLowerCase()} reaction`}
            disabled={!!saving}
            onClick={async () => {
              setSaving(emoji);
              try {
                await onChange(emoji, !reaction?.reacted);
              } catch (err) {
                notifyError(messageOf(err));
              } finally {
                setSaving(undefined);
              }
            }}
          >
            <span aria-hidden="true">{emoji}</span>
            {saving === emoji ? "Saving…" : reaction?.count || null}
          </Button>
        );
      })}
    </fieldset>
  );
}
