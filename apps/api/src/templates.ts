import type { OutboxMessage } from "@picks/db";
import { teamName, weekLabel } from "@picks/shared";

/*
 * Notification emails. Every value from a player (names, titles, message text) is escaped. Styles are inline,
 * because many email clients drop <style> blocks. Colors follow the app's tokens (navy, electric blue, POW red),
 * on a light card that reads well in both light- and dark-mode mail clients.
 */

const NAVY = "#070d1f";
// A shade darker than the app's primary, so white button text keeps its contrast on a light card.
const BLUE = "#2f5fe0";
const RED = "#ff3d5e";
const MUTED = "#55607a";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Shortens text to about `max` characters, at a word boundary. */
export function excerpt(text: string, max = 400): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : max)}…`;
}

type Links = {
  /** The button's destination. */
  action: { label: string; url: string };
  /** The web page that confirms turning this kind of email off. */
  unsubscribeUrl: string;
  /** The one-click endpoint for mail clients' own unsubscribe button. */
  listUnsubscribeUrl: string;
  settingsUrl: string;
};

function layout(input: {
  heading: string;
  bodyHtml: string;
  links: Links;
  why: string;
  stop: string;
}): string {
  const { heading, bodyHtml, links, why, stop } = input;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#eef1f7;font-family:Arial,Helvetica,sans-serif;color:${NAVY};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:2px;overflow:hidden;">
<tr><td style="background:${NAVY};border-bottom:3px solid ${RED};padding:14px 24px;color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;">POW Pick'em</td></tr>
<tr><td style="padding:24px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:${NAVY};">${escapeHtml(heading)}</h1>
${bodyHtml}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr><td style="background:${BLUE};border-radius:2px;">
<a href="${escapeHtml(links.action.url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:bold;text-decoration:none;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(links.action.label)}</a>
</td></tr></table>
</td></tr>
<tr><td style="padding:16px 24px 24px;border-top:1px solid #e3e7ef;font-size:13px;line-height:1.5;color:${MUTED};">
${escapeHtml(why)}<br>
<a href="${escapeHtml(links.unsubscribeUrl)}" style="color:${MUTED};">${escapeHtml(stop)}</a> · <a href="${escapeHtml(links.settingsUrl)}" style="color:${MUTED};">Email settings</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function footerText(links: Links, why: string, stop: string) {
  return `\n\n--\n${why}\n${stop}: ${links.unsubscribeUrl}\nEmail settings: ${links.settingsUrl}\n`;
}

export function newThreadEmail(input: {
  leagueName: string;
  authorName: string;
  title: string;
  body: string;
  links: Links;
}): OutboxMessage {
  const { leagueName, authorName, title, body, links } = input;
  const preview = excerpt(body);
  const why = `You're getting this because you're in ${leagueName} on POW Pick'em.`;
  const stop = "Turn off new-thread emails";
  const heading = title;
  const bodyHtml = `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${MUTED};">${escapeHtml(authorName)} started a new thread on the ${escapeHtml(leagueName)} message board.</p>
<blockquote style="margin:0;padding:12px 16px;border-left:3px solid ${BLUE};background:#f5f7fb;font-size:15px;line-height:1.5;color:${NAVY};white-space:pre-line;">${escapeHtml(preview)}</blockquote>`;
  return {
    subject: `${leagueName}: ${title}`,
    html: layout({ heading, bodyHtml, links, why, stop }),
    text: `${authorName} started a new thread on the ${leagueName} message board.\n\n${title}\n\n${preview}\n\n${links.action.label}: ${links.action.url}${footerText(links, why, stop)}`,
    listUnsubscribeUrl: links.listUnsubscribeUrl,
  };
}

export type ReminderGame = { homeTeam: string; awayTeam: string; kickoff: Date };

export function pickReminderEmail(input: {
  leagueName: string;
  displayName: string | null;
  weekNumber: number;
  timeZone: string;
  games: ReminderGame[];
  links: Links;
}): OutboxMessage {
  const { leagueName, displayName, weekNumber, timeZone, games, links } = input;
  const first = games[0];
  if (!first) throw new Error("Reminder has no games");
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(first.kickoff);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  const count = games.length === 1 ? "1 game" : `${games.length} games`;
  const lines = games.map(
    (g) => `${teamName(g.awayTeam)} at ${teamName(g.homeTeam)}, ${time.format(g.kickoff)}`,
  );
  const why = `You're getting this because you're in ${leagueName} on POW Pick'em and haven't picked these games.`;
  const stop = "Turn off pick reminders";
  const heading = `${count} to pick for ${day}`;
  const greeting = displayName ? `Hi ${displayName}, you` : "You";
  const intro = `${greeting} haven't picked ${games.length === 1 ? "this game" : "these games"} in ${leagueName} (${weekLabel(weekNumber)}) yet. You can add a missing pick until its game kicks off.`;
  const bodyHtml = `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:${MUTED};">${escapeHtml(intro)}</p>
<ul style="margin:0;padding:0 0 0 20px;font-size:15px;line-height:1.7;color:${NAVY};">${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
  return {
    subject: `${leagueName}: ${count} to pick for ${day}`,
    html: layout({ heading, bodyHtml, links, why, stop }),
    text: `${intro}\n\n${lines.map((l) => `- ${l}`).join("\n")}\n\n${links.action.label}: ${links.action.url}${footerText(links, why, stop)}`,
    listUnsubscribeUrl: links.listUnsubscribeUrl,
  };
}
