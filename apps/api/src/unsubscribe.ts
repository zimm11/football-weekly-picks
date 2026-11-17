import { profiles } from "@picks/db";
import { type UnsubscribeResult, unsubscribeSchema } from "@picks/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthVariables } from "./auth";
import { type AppDeps, fail, query } from "./context";
import { verifyUnsubscribeToken } from "./email";

export function unsubscribeRoutes({ db, email }: AppDeps) {
  return (
    new Hono<{ Variables: AuthVariables }>()
      /**
       * Turns off one kind of email for the player a signed link names. Both mail clients' one-click
       * unsubscribe (RFC 8058, which posts a form body we ignore) and the web page send the token in the query.
       * Never a GET: link scanners fetch those.
       */
      .post("/unsubscribe", query(unsubscribeSchema, "This unsubscribe link isn't valid."), async (c) => {
        const { token } = c.req.valid("query");
        const target = email ? verifyUnsubscribeToken(email.unsubscribeSecret, token) : null;
        if (!target) fail(400, "This unsubscribe link isn't valid.");
        await db
          .update(profiles)
          .set(
            target.kind === "new_thread"
              ? { emailNewThreads: false }
              : target.kind === "pick_reminder"
                ? { emailPickReminders: false }
                : { emailLeagueEvents: false },
          )
          .where(eq(profiles.userId, target.userId));
        const result: UnsubscribeResult = { kind: target.kind };
        return c.json(result);
      })
  );
}
