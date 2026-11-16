import type { UnsubscribeResult } from "@picks/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, Notice } from "@/components/ui/card";
import { api, messageOf, unwrap } from "../api";
import { Link } from "../router";

const KIND_LABEL: Record<UnsubscribeResult["kind"], string> = {
  new_thread: "new-thread emails",
  pick_reminder: "pick reminder emails",
};

/** The kind named in a token (`<user>.<kind>.<signature>`), only for wording; the API checks the signature. */
function kindOf(token: string): UnsubscribeResult["kind"] | undefined {
  const kind = token.split(".")[1];
  return kind === "new_thread" || kind === "pick_reminder" ? kind : undefined;
}

/**
 * Where an email's "turn off" link lands. It asks before acting, because mail scanners open links on their
 * own; mail clients' built-in unsubscribe button posts to the API directly instead.
 */
export function UnsubscribePage({ signedIn }: { signedIn: boolean }) {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  const kind = kindOf(token);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function unsubscribe() {
    setPending(true);
    setError(undefined);
    try {
      await unwrap<UnsubscribeResult>(api.unsubscribe.$post({ query: { token } }));
      setDone(true);
    } catch (err) {
      setError(messageOf(err));
    }
    setPending(false);
  }

  const label = kind ? KIND_LABEL[kind] : "these emails";
  return (
    <div className="mx-auto grid max-w-sm gap-5 pt-6">
      <h2 className="text-4xl leading-none font-extrabold">{done ? "You're unsubscribed" : "Unsubscribe"}</h2>
      <Card>
        {!kind ? (
          <Notice kind="alert">This unsubscribe link isn't valid. Check you copied all of it.</Notice>
        ) : done ? (
          <Notice kind="status">You won't get {label} any more.</Notice>
        ) : (
          <>
            <p className="m-0">Stop getting {label} from POW Pick'em?</p>
            {error && <Notice kind="alert">{error}</Notice>}
            <Button onClick={unsubscribe} disabled={pending}>
              {pending ? "Unsubscribing…" : `Turn off ${label}`}
            </Button>
          </>
        )}
        <p className="m-0 text-sm text-muted-foreground">
          {signedIn ? (
            <>
              Choose which emails you get in <Link to="/account">Settings</Link>.
            </>
          ) : (
            <>
              <Link to="/login">Sign in</Link> to choose which emails you get.
            </>
          )}
        </p>
      </Card>
    </div>
  );
}
