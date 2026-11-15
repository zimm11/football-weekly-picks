import { PlusIcon, SmileyIcon } from "@phosphor-icons/react";
import { MESSAGE_REACTIONS, type MessageEmoji, type MessageReaction } from "@picks/shared";
import { cn } from "cn";
import { DropdownMenu as Menu } from "radix-ui";
import { useState } from "react";
import { messageOf } from "../api";
import { notifyError } from "../notify";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu";

// The pills are small, so each sits inside a 44px-tall button that takes the tap.
const target =
  "group flex h-11 min-w-11 items-center justify-center outline-hidden disabled:pointer-events-none disabled:opacity-45";
const pill =
  "flex h-8 items-center rounded-full border text-sm tabular-nums transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring";

/**
 * The reactions a message already has, as chips that toggle your own, and an add-reaction button that
 * opens the full set of emoji. An emoji nobody has used appears only in that menu.
 */
export function MessageReactions({
  reactions,
  onChange,
}: {
  reactions: MessageReaction[];
  onChange: (emoji: MessageEmoji, active: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState<MessageEmoji>();
  const reactionFor = (emoji: MessageEmoji) => reactions.find((r) => r.emoji === emoji);

  async function toggle(emoji: MessageEmoji) {
    setSaving(emoji);
    try {
      await onChange(emoji, !reactionFor(emoji)?.reacted);
    } catch (err) {
      notifyError(messageOf(err));
    } finally {
      setSaving(undefined);
    }
  }

  return (
    <fieldset aria-label="Message reactions" className="flex min-w-0 flex-wrap items-center gap-x-1.5">
      {MESSAGE_REACTIONS.map(({ emoji, label }) => {
        const reaction = reactionFor(emoji);
        // A first reaction has no chip yet, so one appears while it saves to say what is happening.
        if (!reaction?.count && saving !== emoji) return null;
        return (
          <button
            key={emoji}
            type="button"
            className={target}
            aria-label={`${label}, ${reaction?.count ?? 0} reactions`}
            aria-pressed={reaction?.reacted ?? false}
            title={`${reaction?.reacted ? "Remove" : "Add"} ${label.toLowerCase()} reaction`}
            disabled={!!saving}
            onClick={() => toggle(emoji)}
          >
            <span
              className={cn(
                pill,
                "gap-1.5 px-2.5",
                reaction?.reacted
                  ? "border-primary/70 bg-primary/20 text-foreground group-hover:bg-primary/30"
                  : "border-border bg-secondary/60 text-muted-foreground group-hover:bg-secondary",
              )}
            >
              <span aria-hidden="true" className="text-base leading-none">
                {emoji}
              </span>
              {saving === emoji ? "Saving…" : reaction?.count || null}
            </span>
          </button>
        );
      })}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={target}
          aria-label="Add reaction"
          title="Add reaction"
          disabled={!!saving}
        >
          <span
            className={cn(
              pill,
              "gap-0.5 border-border bg-secondary/60 px-2 text-muted-foreground group-hover:bg-secondary group-hover:text-foreground group-data-[state=open]:bg-secondary group-data-[state=open]:text-foreground",
            )}
          >
            <SmileyIcon aria-hidden className="size-5" />
            <PlusIcon aria-hidden weight="bold" className="size-3" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="flex max-w-[calc(100vw-1rem)] min-w-0 flex-wrap gap-0.5 rounded-[1.75rem] border border-border p-1 shadow-lg ring-0">
          {MESSAGE_REACTIONS.map(({ emoji, label }) => (
            <Menu.CheckboxItem
              key={emoji}
              aria-label={label}
              checked={reactionFor(emoji)?.reacted ?? false}
              onCheckedChange={() => toggle(emoji)}
              className="flex size-11 cursor-default items-center justify-center rounded-full text-2xl outline-hidden transition-colors select-none focus:bg-accent data-[state=checked]:bg-primary/25"
            >
              <span aria-hidden="true">{emoji}</span>
            </Menu.CheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </fieldset>
  );
}
