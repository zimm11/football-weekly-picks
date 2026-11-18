# Message board and content moderation

Code: `apps/api/src/messages.ts` (the board), `apps/api/src/moderation.ts` (who may post, reports, blocks, removals, strikes, mutes, suspensions, appeals and the review queues), `apps/api/src/screening.ts` (content screening with Cloudflare's models on the Worker's `AI` binding; the policy in plain words), `apps/api/src/moderationJobs.ts` (rechecking unchecked posts, clearing removed text, the operator's digest), `apps/api/src/operator.ts`; schemas in `packages/shared/src/messages.ts`; app helpers in `apps/mobile/src/lib/messagePresentation.ts`. The README's "Content moderation" has the operator's side.

## The board

- Each league has one board: threads with replies and per-player unread indicators. It loads 30 threads at a time, pinned ones always on the first page.
- Only league admins can pin, unpin or permanently delete threads. Deletion removes all replies, reactions, read markers and queued notifications. Pinning doesn't change unread status.
- **Rate limits:** a player can start at most five threads a day in one league (`THREAD_DAILY_LIMIT`, since each one emails and notifies everybody; two in an account's first 24 hours), and post at most ten replies a minute (`REPLY_MINUTE_LIMIT`; twenty a day for a new account), never the same reply twice in a row.
- Members can quote any message in the same thread when replying; a posted quote attributes the original author and links back to the message.
- A thread opens on the reader's first unread reply (the thread's optional `readVersion`; `threadArrival`). `?post=<id>` on a thread's URL lands on one message.
- Web addresses in a message are links (`linkParts`): http and https only, opened in a new tab.
- **Reactions:** active members can add or remove 👍, 😂, 🔥, 🎉, 😮, 🙏 and 🏈 on any message or reply, once per emoji per player. Reactions do not bump threads or mark them unread.

## Content moderation

This exists for App Store guideline 1.2.

- **Terms first:** posting, replying and reacting need agreed Terms of use (`profiles.terms_accepted_at`: the first name step's checkbox, which also confirms the player is `MINIMUM_AGE` or older, else a one-time sheet).
- **Screening:** every thread, reply, display name, league name and squares guest name is screened before it is saved (`screen` in `moderation.ts`). Two outcomes only: block refuses it with `MODERATION_MESSAGES`, allow saves it; no answer saves it `unchecked` for the cron's recheck, which hides and flags it in `content_reports` if it should have been blocked. Borderline content is left to reports; don't add a review verdict. Without a screener (`MODERATION_MODE=off`, Node, tests) content saves `skipped`.
- **Never write offensive words into the repo:** the policy is plain words in `screening.ts`, tests use the placeholder `forbiddenword`, and labeled abusive examples stay outside the repo (`MODERATION_EVAL_FILE`; `pnpm moderation:eval` checks `SCREENING_THRESHOLDS.block` against them and costs a little).
- **Reports:** players report messages, names and the league name (`POST /reports`, 20 a day). Two reporters or a threat report hide a message (`hidden_at`), and the larger model can remove it. League admins review their league's reports, except those about admins, league names and appeals, which only the operator sees (`GET /operator/reports`). A report's link to its thread is left out when the reviewer can't open that league (`canOpen`).
- **Removal is soft** (`removed_at`). The API replaces the body with `REMOVED_TEXT`/`HIDDEN_TEXT` for readers who may not see it, so old clients show the placeholder. Removing a thread's first message removes the thread. Text is cleared after 30 days.
- **Strikes:** removals in 30 days are strikes; the second mutes the author app-wide for 24 hours, the third for 7 days. Admins mute members per league (`league_members.muted_until`); the operator mutes and suspends app-wide. A muted or suspended member sees a notice in place of the composer (`postingBlocked`).
- **A mute or suspension never touches picking:** don't add moderation checks to pick, week or standings routes.
- **Blocks** (`user_blocks`) are one-way and app-wide: the blocker doesn't see the blocked player's threads (board and unread count), sees their replies collapsed (`state: "blocked"`), doesn't count their reactions, and isn't emailed or notified about their threads (checked when queued and when sent).
- Every action is logged in `moderation_actions`. Operators get an immediate email for threat reports and a daily digest (`email_outbox` kind `moderation`).
