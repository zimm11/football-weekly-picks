import { feedbackPageSchema } from "@picks/shared";
import { useEffect, useState } from "react";
import { api, messageOf, unwrap } from "../api";
import { FeedbackForm } from "../components/FeedbackForm";
import { Card } from "../components/ui/card";
import { notifyDone } from "../notify";
import { navigate } from "../router";

/** The in-app path the player came from (`/feedback?from=...`), or home if it is missing or not one of ours. */
function cameFrom(): string {
  const from = new URLSearchParams(window.location.search).get("from");
  const parsed = feedbackPageSchema.safeParse(from);
  return parsed.success ? parsed.data : "/";
}

/** Where any signed-in player reports a bug or asks for a feature. */
export function FeedbackPage() {
  const [from] = useState(cameFrom);
  const [sent, setSent] = useState(false);
  // Go back only after the form has cleared, so its unsaved-work guard doesn't ask.
  useEffect(() => {
    if (sent) navigate(from);
  }, [sent, from]);

  return (
    <div className="mx-auto grid max-w-lg gap-5 pt-6">
      <div className="grid gap-2">
        <h2 className="text-4xl leading-none font-extrabold">Send feedback</h2>
        <p className="m-0 text-muted-foreground">
          Found a bug or have an idea? It goes straight to the people who run POW Pick'em.
        </p>
      </div>
      <Card>
        <FeedbackForm
          onCancel={() => navigate(from)}
          onSubmit={async (value) => {
            try {
              await unwrap(api.feedback.$post({ json: { ...value, page: from } }));
            } catch (err) {
              return messageOf(err);
            }
            notifyDone("Thanks. Your feedback was sent.");
            setSent(true);
            return undefined;
          }}
        />
      </Card>
    </div>
  );
}
