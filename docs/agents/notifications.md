# Email, push, league events and reminders

Code, all under `apps/api/src/`: `email.ts` (mailers: Cloudflare's `send_email` binding in production, the local test inbox in development; signed unsubscribe tokens), `templates.ts`, `outbox.ts` (queueing, sending and retrying through `email_outbox`; `runEmailJobs`), `unsubscribe.ts`, `push.ts` (device subscription routes), `pushQueue.ts` (queueing and sending through `push_deliveries`), `pushSender.ts` and `webPush.ts` (Web Push on WebCrypto and fetch, with no `web-push` package, so the Worker can send), `leagueEvents.ts`, `reminderTargets.ts` and `reminders/`. Shared: `packages/shared/src/reminders.ts` (when a reminder is due), `packages/shared/src/push.ts`.

## Rules for every notification

- **Queue, then send.** A notification is queued with a dedupe key inside the transaction that made the change and sent after the request commits, never inside it. Don't add a send path that skips the queue.
- **Recheck at send time:** membership, the player's switch, blocks, and whether it still applies.
- **Payloads carry league names and thread titles, never picks, message bodies, a team, a square or whether the reader is in or out.**
- Each kind can be turned off per player (`profiles.email_*`, per device for push), and every email carries a signed unsubscribe link. `POST /unsubscribe` is one click; nothing changes on a GET, since mail scanners open links.
- In each scheduled job a failure to queue (caught per week) never stops sending what's waiting.

## Email

- Supabase Auth sends the sign-in emails (sign-up confirmation, which production requires; password reset, email change, change notices) through Cloudflare Email Sending's SMTP relay. The Worker sends notification emails through its `send_email` binding: a new message thread (to the league's other current members), league events, and pick reminders.
- Addresses are read from `auth.users` at send time and never copied.
- Just before sending, a thread email is skipped if the recipient has left the league; a reminder is skipped if it no longer applies, or re-rendered with only the games still unpicked.
- **Budget:** every send first reserves a slot in `email_usage` against `EMAIL_DAILY_LIMIT` / `EMAIL_MONTHLY_LIMIT` (a safety cap against runaway sending; defaults 1,000 a day and 10,000 a month). Over budget, emails wait for the next UTC day. The count holds real sends only: when Cloudflare's own daily quota refuses a send, what's due waits for tomorrow and nothing is counted.
- `waitUntil` has a time limit, so the outbox claims rows in small batches; whatever is cut off is retried by the cron.
- Email is off until `UNSUBSCRIBE_SECRET` is set. Setup is in the README under "Email".

## Push

- Opt-in per device in Settings → **On this device** (`push_subscriptions`). Your leagues suggests it once per browser; keep it a suggestion, not a permanent row. Signing out disconnects the device.
- The website uses Web Push (`apps/mobile/src/lib/notifications.web.ts`); the iPhone app uses Expo's push service (`apps/mobile/src/lib/notifications.ts`, `EXPO_PUSH_ENABLED`). Both share the same queue and rules.
- When a browser replaces its subscription, the service worker reports the change and the app re-registers it for the same player (`oldEndpoint` on `PUT /push/device`).
- **A device is removed only when its push service says the subscription is gone (404/410).** Other failures are logged by a fixed code and never remove it, since a 401/403 or an outage may be our side's fault.
- **A tap opens the notification's path only if it is on the allowlist, kept in two places:** `safePath` in `apps/mobile/public/push-sw.js` (the website) and `internalPath` in `apps/mobile/src/lib/links.ts` (the iPhone app). A new kind of notification path must be added to both (`scripts/push-worker.test.mjs`, `links.test.ts`), or the tap lands on Your leagues.
- Push is off until the three `VAPID_*` secrets are set, and stays off if they don't form a matching pair (README, "Push notifications").

## League events

- One notification kind, `league_event` (Settings → **Results and updates**; `profiles.email_league_events`, `push_subscriptions.league_events`; its own unsubscribe link), for results and updates in a league: being added through Start with members from, and each type's events (week open/final in leagues that run themselves, numbers drawn, quarter results, pool won).
- Queue it with `queueLeagueEvent` inside the transaction that made the change, then `deliverLeagueEventsSoon` after commit.
- The dedupe key is per event and player (`league_event:<leagueId>:<userId>:<event>`, push event key `<leagueId>:<event>`), so a repeated run queues nothing twice.
- `pushOnly` skips email (squares quarter results, to spare the email budget).

## Pick reminders

- Sent at 7pm league time the evening before a game day (`dueReminderDay`, shared by every type and by email and push), expiring at the day's first kickoff.
- `reminderTargets.ts` asks each type's `ReminderHandler` (`due`, `stillDue`; `REMINDERS` dispatches by league type) who is due. Weekly: members with games still unpicked that day. Playoff skips eliminated players. Survivor reminds alive entrants with no pick. Squares reminds members holding no square on an undrawn board the evening before kickoff.
- A reminder's dedupe key names its week or board (`reminder:<weekOrBoardId>:<date>:<userId>`), and the send-time recheck finds the type from it.
- A `text` reminder's push title is its own heading ("Claim your squares", "Make your Week 5 pick", "Choose your POW"); only weekly's game list is titled "Make your picks".
