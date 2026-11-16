import { BellIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { type PushSupport, pushSupport } from "../push";
import { Link } from "../router";
import { Button, buttonVariants } from "./ui/button";

/** Set once a player answers the prompt ("Not now"), so Your leagues never asks on this browser again. */
const DISMISSED_KEY = "pow:notifications-prompt-dismissed";

/**
 * Whether Your leagues should suggest turning on notifications: only on a device that could get them and
 * hasn't been asked yet. Once the browser's permission is granted or denied, Settings is the place for it.
 * An iPhone browser tab qualifies too, since the way there is the home-screen app.
 */
export function shouldOfferNotifications(input: {
  support: PushSupport;
  permission: NotificationPermission | undefined;
  dismissed: boolean;
}): boolean {
  if (input.dismissed) return false;
  if (input.support === "home-screen") return true;
  return input.support === "supported" && input.permission === "default";
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    // No storage means "Not now" couldn't stick, so don't ask at all.
    return true;
  }
}

/** A quiet, one-line suggestion on Your leagues that points at Settings. */
export function NotificationsPromptView({ onDismiss }: { onDismiss: () => void }) {
  return (
    <section
      aria-label="Pick reminders"
      className="flex items-center gap-3 rounded-xl bg-card py-1.5 pr-1.5 pl-4"
    >
      <BellIcon aria-hidden className="size-5 shrink-0 text-primary" />
      <p className="m-0 min-w-0 flex-1 font-medium">Get pick reminders</p>
      <Link to="/account" className={buttonVariants({ variant: "secondary" })}>
        Turn on
      </Link>
      <Button variant="ghost" size="icon" aria-label="Not now" title="Not now" onClick={onDismiss}>
        <XIcon aria-hidden className="size-5" />
      </Button>
    </section>
  );
}

/** The prompt where it applies, and nothing otherwise. "Not now" hides it for good on this browser. */
export function NotificationsPrompt() {
  const [show, setShow] = useState(() =>
    shouldOfferNotifications({
      support: pushSupport(),
      permission: "Notification" in window ? Notification.permission : undefined,
      dismissed: readDismissed(),
    }),
  );
  if (!show) return null;
  return (
    <NotificationsPromptView
      onDismiss={() => {
        try {
          localStorage.setItem(DISMISSED_KEY, "1");
        } catch {}
        setShow(false);
      }}
    />
  );
}
