import { expect } from "@playwright/test";

/*
 * The local Supabase stack's test inbox (Mailpit). Auth's emails and the API's notification emails both land
 * here. INBOX_URL comes from the repo-root .env (`pnpm env:local`), and local-env.ts insists it is local.
 */

type Summary = { ID: string; Subject: string };
export type Email = { subject: string; html: string; text: string; links: string[] };

function inboxUrl(path: string) {
  const base = process.env.INBOX_URL;
  if (!base) throw new Error("INBOX_URL is not set. Run pnpm env:local.");
  return new URL(path, base);
}

/** Waits for an email to `to` whose subject matches, and returns it with the links in its HTML. */
export async function waitForEmail(to: string, subject: RegExp): Promise<Email> {
  let found: Summary | undefined;
  await expect
    .poll(
      async () => {
        const url = inboxUrl("/api/v1/search");
        url.searchParams.set("query", `to:"${to}"`);
        const { messages } = (await (await fetch(url)).json()) as { messages: Summary[] };
        found = messages.find((m) => subject.test(m.Subject));
        return found?.Subject;
      },
      { message: `email to ${to} matching ${subject}`, timeout: 20_000 },
    )
    .toMatch(subject);
  const message = (await (await fetch(inboxUrl(`/api/v1/message/${found?.ID}`))).json()) as {
    Subject: string;
    HTML: string;
    Text: string;
  };
  const links = [...message.HTML.matchAll(/href="([^"]+)"/g)].map((m) =>
    (m[1] ?? "").replaceAll("&amp;", "&"),
  );
  return { subject: message.Subject, html: message.HTML, text: message.Text, links };
}

/** How many emails `to` has received. */
export async function emailCount(to: string): Promise<number> {
  const url = inboxUrl("/api/v1/search");
  url.searchParams.set("query", `to:"${to}"`);
  return ((await (await fetch(url)).json()) as { messages_count: number }).messages_count;
}
