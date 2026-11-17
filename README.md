# Football Weekly Picks

The code behind **[POW Pick'em](https://www.pow-pickem.com)**, an NFL pick'em league app. Players pick
against the spread, choose a Pick of the Week (POW), and compete for weekly wins and the season lead.
A league admin prepares each slate and publishes the results.

The app supports regular-season weeks 1–18, invite-only leagues with shared administration, multiple
seasons, private picks until finalization, and season standings with a week-by-week history. Each game has
a matchup sheet with team stats, injuries, news, and prediction-market prices. Finalized weeks hand out
awards and name a Low Point Loser, and each league has a message board. The interface is phone-first and
dark, and the website can be added to a phone's home screen. One Expo (React Native) app is both the website
and the iPhone app.

- [Local setup](#local-setup)
- [Trying the app locally](#trying-the-app-locally)
- [League rules](#league-rules)
- [Architecture and repository layout](#architecture-and-repository-layout)
- [Development and testing](#development-and-testing)
- [Database workflow](#database-workflow)
- [Deployment](#deployment)
- [Credentials and diagnostics](#credentials-and-diagnostics)
- [Troubleshooting](#troubleshooting)

## Local setup

### Prerequisites

- **Node.js 24 or newer.** CI uses Node 26.
- **pnpm 12.18.0**, pinned in [`package.json`](package.json).
- **A running Docker runtime**, such as Docker Desktop or OrbStack, for local Supabase.

Run these commands from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm db:start    # start local Supabase; first start applies migrations and seed data
pnpm env:local   # generate this checkout's .env from the running stack
pnpm ports      # show this checkout's URLs
pnpm dev        # run the API and the Expo app, with its browser preview
```

`pnpm dev` (the same as `pnpm mobile --web`) opens the app's browser preview, the website in development with
hot reload, at the web URL it prints. The main checkout uses `http://localhost:8081`; linked git worktrees get
their own ports and database. It also prints a QR code for trying the app on an iPhone with Expo Go (see
"Native iPhone app (Expo)" below), so it needs this computer on a network (Wi-Fi or Ethernet), even for the
browser alone. To run the production build instead, as Cloudflare does and as E2E tests it, use
`pnpm worker:dev`. No hosted Supabase project, Cloudflare account, or ESPN API key is needed for local
development. The first Supabase start downloads its container images.

To run all tests, use another terminal after setup:

```sh
pnpm playwright:install  # one-time Chromium and WebKit installation
pnpm test:all           # unit, script, API, and E2E tests
```

### Environment variables

[`.env.example`](.env.example) documents the configuration. Prefer `pnpm env:local` over copying it:
the generated `.env` includes working local credentials and the correct ports for this checkout.
Running it again overwrites `.env`.

| Variable                   | Purpose                                                                  | Main checkout / default                                           |
| -------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| `PORT`                     | API listen port; the local Worker uses `PORT + 1000`                     | `8787`                                                            |
| `DATABASE_URL`             | PostgreSQL connection string used by the API                             | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` locally |
| `SUPABASE_URL`             | Supabase Auth project URL                                                | `http://127.0.0.1:54321` locally                                  |
| `SUPABASE_PUBLISHABLE_KEY` | Public Supabase publishable key, or legacy `anon` key                    | Generated from the local stack                                    |
| `SUPABASE_SECRET_KEY`      | Secret key for account deletion's Auth admin call; never sent to clients | Generated from the local stack                                    |
| `INBOX_URL`                | Local mailer: the stack's test inbox (refused in production)             | `http://127.0.0.1:54324` locally                                  |
| `APP_URL`                  | Web origin that links in emails point at                                 | `http://localhost:8081` (the Expo web preview) locally            |
| `UNSUBSCRIBE_SECRET`       | Signs unsubscribe links (32+ characters); turns email on                 | A fixed local-only value                                          |
| `EMAIL_FROM`               | Sender of notification emails                                            | `POW Pick'em <noreply@pow-pickem.com>`                            |
| `EMAIL_DAILY_LIMIT`        | Most notification emails sent per UTC day                                | `1000` (`10000` locally)                                          |
| `EMAIL_MONTHLY_LIMIT`      | Most notification emails sent per UTC calendar month                     | `10000` (`100000` locally)                                        |
| `VAPID_PUBLIC_KEY`         | Web Push public key; with the next two, turns push on                    | Unset locally                                                     |
| `VAPID_PRIVATE_KEY`        | Web Push private key (secret)                                            | Unset locally                                                     |
| `VAPID_SUBJECT`            | Contact for push services (`mailto:` or `https:`)                        | Unset locally                                                     |

The app fetches its public Auth configuration from `/api/config` at runtime, so its production web build
needs no environment variables, and it calls the API on its own origin. Database credentials stay on the API
server.

#### Simulating a different date and time (local only)

To test pick and POW locks or week phases without waiting for game day, start the API with
`CLOCK_OVERRIDE` set to an ISO 8601 time with an offset:

```sh
CLOCK_OVERRIDE=2026-09-13T12:30:00-04:00 pnpm dev
```

The API's clock starts at that moment and keeps running in real time. The app picks up the same offset
from `/api/config`, so its locks and phases follow the simulated time too. Restart `pnpm dev` to change or
clear it. The API refuses to start with `CLOCK_OVERRIDE` when `NODE_ENV=production`, so it can't reach the
deployed service. Rows the database timestamps itself (such as message times) still use the real clock.

#### Email locally

Every email (Supabase Auth's password resets and email changes, and the API's notification emails) goes to
the local stack's **test inbox**; `pnpm ports` prints its URL. Nothing leaves your machine, under `pnpm dev`
or `pnpm worker:dev`.

- **New-thread emails** go out as soon as a thread is posted.
- **Pick reminders** and retries come from the email job. In production the Worker's Cron Trigger runs it
  every five minutes; `pnpm dev` runs it every minute instead. To see a reminder, start the API with
  `CLOCK_OVERRIDE` set to an evening before a game day (after 7pm league time) with an open week.
  Under `pnpm worker:dev` the cron doesn't fire by itself: run it with
  `curl "http://localhost:<worker port>/cdn-cgi/handler/scheduled?cron=*/5+*+*+*+*"`.

### Ports, worktrees, and stopping the stack

Run `pnpm ports` in each checkout to see its web preview, Worker, API, Supabase, Studio, test inbox, and
PostgreSQL URLs. The main checkout uses slot 0. Each linked worktree gets an isolated Supabase project and the
next free slot `n`: Expo (web preview) port `8081 + n`, API port `8787 + n`, local Worker port `9787 + n`, and
Supabase ports based at `54320 + 10n`.
`PICKS_PORT_SLOT=<n>` can override allocation; use the same override for all commands in that checkout.

Always use `pnpm db:*` or `pnpm sb <args>` for Supabase commands. These wrappers select the checkout's
project and ports; invoking the Supabase CLI directly can target a different local stack. Start Supabase
and run `pnpm env:local` in every new worktree.

```sh
pnpm db:status  # inspect the local stack
pnpm db:stop    # stop Supabase, preserving local data
```

Stop `pnpm dev` with Ctrl+C. Accounts and data persist between runs. **`pnpm db:reset` wipes the local
database and reapplies migrations and seed data.** Before deleting a worktree, run
`pnpm sb stop --no-backup` inside it to remove its containers and database volume.

## Trying the app locally

### Test accounts

[`supabase/seed.sql`](supabase/seed.sql) creates four accounts. All use the password **`password123`**:

| Email               | Name    | Role in Sunday Crew |
| ------------------- | ------- | ------------------- |
| `admin@example.com` | Commish | Admin               |
| `pat@example.com`   | Pat     | Player              |
| `sam@example.com`   | Sam     | Player              |
| `alex@example.com`  | Alex    | Player              |

The **Sunday Crew** league has a 2026 season with **Weeks 6–9 already finalized**. Results, standings,
the week-by-week grid, and rank movement have history to explore. Week 9 uses the matchups and scores
recorded in the seed with made-up spreads; Weeks 6–8 use made-up eight-game slates. The fixtures include
pushes, weeks with no POW, and missed picks, including Alex missing all of Week 7. Later weeks are absent
so you can create them yourself. Each seeded account sees the Week 9 results recap the first time it
opens the league.

Local sign-up needs no email confirmation. You can create an account with a made-up email address and
a password of at least six characters. To join the seeded league, open `/join/local-invite` on your web
URL, sign in, and press **Join league**. In the main checkout, that URL is
`http://localhost:8081/join/local-invite`.

[`supabase/seeds/survivor.sql`](supabase/seeds/survivor.sql) adds **Last One Standing**, a survivor pool for
the same four accounts (invite `/join/local-survivor`): two lives from Week 8, Weeks 8–10 closed with Commish
and Pat still in, Sam and Alex out, and an empty Week 11 that the first read imports from ESPN and opens.

Use a normal browser window for the admin and a private window or different browser profile for a player.
Sessions are stored per browser profile, so both accounts can stay signed in side by side.

### Adding POW Pick'em to your home screen

In a browser, **Settings** (account menu) has a **Home screen app** card whose **Show me how** opens
instructions over the screen, showing only the steps for the player's phone (iPhone/iPad or Android; both
on a computer). In an iPhone browser tab the card is left out, because the notifications card above it
already shows the iPhone steps. On a phone, the first time a player saves picks in that browser, the
same instructions open once on their own with a **Not now** button; they never reappear after that.
None of this shows when running from the home-screen app. To see the one-time prompt again locally,
remove `pow:home-screen-offered` from the site's local storage. Open the new icon after adding it;
you may need to sign in again. The app requires an internet connection.

### Push notifications

Open **Settings** from the account menu, then **Enable notifications** under **On this device** on each
device that should get them, and approve the browser's permission prompt. Until a device has been asked,
Your leagues shows a small **Get pick reminders on this device** suggestion with **Turn on** (to Settings)
and **Not now**, which hides it for good on that browser (`pow:notifications-prompt-dismissed` in local
storage; no storage means no suggestion).
On iPhone and iPad (iOS 16.4+), first add POW Pick'em to the home screen and open it from its icon;
ordinary iPhone browser tabs show those steps instead of asking for permission.

Each device has its own switches for **New league threads**, **Missing-pick reminders** and **Results and
updates**, beside the email switches (**By email**) in the same **Notifications** section of Settings.
Results and updates (a week opening or final in a league that runs itself, being added to a league) are the
`league_event` kind; they name the league and the event, never a pick, a team or whether you're in or out. A new thread notifies the league's other current members who
opted in (replies don't). Reminders start at 7pm league time the evening before a game day, only for games
still to pick, and expire at that day's first kickoff; picks and membership are checked again just before
sending. Notifications show league names and thread titles on the lock screen, never picks or message
bodies. Signing out disconnects the device.

Locally, push is off (no VAPID keys), so the settings screen says it isn't available yet. To try it in a
desktop browser, put a pair from `node scripts/vapid-keys.mjs` and a `VAPID_SUBJECT` in `.env`.

### Feedback and app operator

Signed-in players can choose **Send feedback** from their account menu to report a bug, request a
feature, or send a note. Reports stay in the database; no email service is needed. Each player can send
up to five reports per rolling 24 hours. Reports include the sender, originating app path, and browser
user agent, without URL queries, fragments, or invite codes.

The **Operator** menu opens an app-wide dashboard with account and league growth, active players and
leagues, pick and message counts, eight weeks of activity, and the latest 25 accounts and leagues.
Its feedback inbox supports **Mark done**, **Reopen**, and loading older reports. Usage is derived from
stored picks and messages: it does not measure visits, sessions, or time spent. Private pick choices
and league message bodies are never included.

Operator access is separate from league admin access. Set the Worker secret `OPERATOR_USER_IDS` to your
Supabase Auth user UUID (or a comma-separated list): `pnpm exec wrangler secret put OPERATOR_USER_IDS` from
`apps/api`. Find the UUID under **Authentication → Users** in your Supabase dashboard. A secret change takes
effect within seconds, without a deploy; reload the app. An empty or unset value grants nobody access, and
everyone else gets a 404 on the operator routes; players cannot grant themselves access through their profile
or league role. To revoke access, put the secret again without that UUID.

For local development, `pnpm env:local` makes the seeded `admin@example.com` account an operator.
This local setting is not applied to production.

### Walking through a week

1. Sign in as `admin@example.com` and open **Sunday Crew**. The league has five tabs: **Picks**,
   **Results**, **Standings**, **Messages**, and **League**. The **Season** selector applies to every tab
   except Messages, which is league-wide.
2. Open **League**, select an unused week, and press **Create week**. To prepare another year, choose
   **Start a new season** in the season selector; the season is created with its first week. Existing
   weeks open with **Manage week**. With **Import games and spreads from ESPN** checked, creation
   fetches the slate from ESPN and opens the draft's management screen. Imports need internet access.
3. Review kickoffs, spreads, point values, and the tiebreaker game. Add or remove games as needed and
   press **Save changes** after edits. Kickoffs you type are in the league's time zone, and a game whose
   kickoff moves takes the new slot's points unless you set them by hand. A draft is visible only to admins. Every game needs a spread
   before you can press **Open week for picks**. After the week opens, the app offers to post a league
   message announcing it; you can edit the draft or skip it.
4. Follow **Make your own picks**, or open **Picks**. Select teams, mark one POW, enter a guess for the
   tiebreaker game's combined score, and press **Save picks**. A partial sheet can be saved and completed
   later. **Stats, news & market** on a game opens its matchup sheet. Then try the player account. The
   admin's management screen shows submission counts and whether a POW was chosen; other players'
   choices remain private.
5. As each game ends, its result fills in on its own from ESPN the next time anyone opens the week
   (checked at most once a minute), and each player's sheet marks their pick **Won** (with the points
   earned), **Lost**, or **Push** and keeps a **Your week so far** tally. An open pick sheet refreshes
   itself every minute while games are in progress. To fetch results right away, press **Pull results
   from ESPN** in **Manage week**; it replaces any hand-entered score. Or enter both scores for
   each game and press **Save changes**; automatic results never overwrite a score typed in by hand. Score boxes appear once a game kicks off; before that, press
   **Enter score** on the game to record a result early. Results imports update games originally imported from ESPN;
   manually added games need manually entered scores. Recording a result closes that game to picks
   immediately.
6. When every game has a score, press **Finalize week** and confirm. This reveals everyone's picks,
   names the weekly winner and any Low Point Loser, hands out the week's awards, and includes the week in
   standings. The app again offers to post a league message, with final results shown beside the draft
   for reference. Each other player sees a one-time results recap the next time they open the league.
   **Reopen week** lets you correct a score or spread. While reopened, other players' picks are hidden
   again and the week is
   excluded from standings until finalized again; the corrected week is then recapped again.
7. Open **Messages** to start a thread or reply. A dot on the tab and an **Unread** label mark threads
   with posts you haven't opened. Tap the smiley under a message or reply to add 👍, 😂, 🔥, 🎉, 😮, 🙏 or 🏈; tap a reaction shown on the message to join it, or tap yours again to remove it. Use **Quote reply** to include a message with your reply, or **Remove quote** to drop it while keeping your draft. The reply box stays at the bottom of the thread, and new replies appear on their own. Admins can open a thread's **⋯** menu and choose **Pin announcement** to keep it at the top of the board, or **Delete thread** to permanently remove it after confirming. Deletion returns you to the message board.

### Sharing league administration

Any admin can open **League → Members**, tap **⋯** beside a current player, and choose **Make admin**.
All admins have equal access to weeks, games, scores, settings, invites, and membership management.
Admins can revoke each other's admin access or remove each other, including the league creator.
**Revoke admin** keeps that person in the league as a player with their picks and results. Admins can
also step down themselves, provided at least one active admin remains.

### League types

Every league has a type, fixed when it is created: **Weekly pick'em** (the game described here, and every
league created before types existed), **Playoff pick'em**, **Squares** or **Survivor**. The registry in
[`packages/shared/src/leagueTypes.ts`](packages/shared/src/leagueTypes.ts) says what each owns: its tabs,
settings, weeks (1–18 the regular season; 19 Wild Card, 20 Divisional, 21 Conference, 22 Super Bowl), when picks
show, and whether it runs itself. Every type is open to every player. A weekly league is run **Automatic**
(the feed sets up, opens and closes each week; preselected on New league) or **Hands-on** (the admins run each
week, as before, and every league from before types); an admin can switch in **League → League settings**.
**Start with members from** on New league copies the current members of a league you are an admin of
into the new one as members, each told once (a league event); anyone already in 25 leagues is skipped and named.

### Survivor

A survivor pool runs itself. New league (or **Start season** in the League tab) sets the **lives** (1–3) and the
**start week** (any week with no kickoff yet; the next one by default); both are fixed once the start week's
first game kicks off. Starting the season creates the start week empty, and the next read of the league (or
the next cron run) imports its slate from ESPN and opens it: there are no spreads to wait for.

1. **Pick:** each week a player still in taps one team to win outright and presses **Save pick**. A team picked
   earlier in the season is disabled ("Used in Week 3"); the used teams reset at the Wild Card round, and a
   player with no unused team left on a playoff slate may pick any. A pick can change until its team kicks off,
   and only to a team still to kick off. Above the cards: lives left and teams used.
2. **Reveal:** nobody else, admins included, learns anything about a pick (not even that one exists) until its
   team's game kicks off. Then it shows on **Standings**, the survivor grid.
3. **Strikes:** a loss, a tie, or no pick when the week's last game kicks off is a strike; a player is out when
   their strikes reach the lives, and a player who leaves is out from that week on. A week that would put out
   everyone still in puts out nobody.
4. **The week closes itself:** kickoffs follow flexed games, scores fill in (never over one an admin typed), and
   when every game has a result the week is final, its players are recorded, a "Week 7 is final" league event
   goes out, and the next week is imported. A recap shows each player whether they're in, who went out and how
   many are left.
5. **The end:** one player left after a final week wins (a "pool over" league event). With several still in
   after Week 18 the pool plays on through the playoffs; several still in after the Super Bowl share the title.

Admins, in the League tab, can enter a pick for a player (it records that an admin did), correct a score at any
time (everyone's status is worked out again; nothing is stored), and remove a cancelled game, which deletes the
picks on it so those players can pick again. Reminders at 7pm the evening before a game day go to players still
in with no pick yet.

### Leaving, removal, and limits

Any member can use **League → Leave league**; an admin can remove another member from the **⋯** menu
beside their name. Either way the
person loses access, weeks they already played keep their results, and they can rejoin through an invite
link. A league's only admin must make someone else an admin before leaving. **Make a new link** (beside **Copy link**, and
**Share** on phones) replaces the invite link, so links already shared stop working. A league holds at most 100 players, and one
account can be in at most 25 leagues; removed and departed members don't count toward either limit.

### Accounts and passwords

**Forgot password?** on the sign-in form emails a link that signs the player in and asks for a new
password. Locally, that email arrives in the test inbox listed by `pnpm ports`. A signed-in player can
use **Change password** or **Change your name** from the account menu in the header. **Settings**
(`/account`) holds notifications (by email and on this device: new threads, pick reminders, and results and
updates), the home-screen app help, and the email
address (a change is confirmed from both the old and the new address).

### Deleting an account

Settings → **Delete account** (required by the App Store, guideline 5.1.1(v)) asks for the password and deletes at once
(`DELETE /api/me`, `src/accounts.ts`). Every table points at `auth.users`, so a plain delete would erase the player's
past picks and rewrite everyone's standings. Instead one transaction clears what's personal: devices, queued email,
blocks, reactions, read markers, picks in weeks that aren't final, and the text of their messages (threads they
started keep everyone's replies, titled "Thread from a deleted player"). They leave every league, and a league they
were the only member of is deleted. The profile becomes "Deleted player". Then Supabase Auth soft-deletes the user: the
row stays as an anonymous anchor with a scrambled email and no sign-in, and the same email can sign up again as a new
account. Picks from final weeks stay, so results and standings don't change. The account is refused from the moment
the transaction commits, even with an unexpired token (`refuseDeletedAccounts`); if the Auth call fails, the cron
retries it. A league's only admin must make someone else an admin first.

It needs `SUPABASE_SECRET_KEY` (the project's secret key, for the Auth admin call); without it the app says deletion
isn't available and points to support. `pnpm env:local` writes the local stack's key.

### Testing locks and inspecting data

Locks use the real clock unless `CLOCK_OVERRIDE` is set locally (see
[Simulating a different date and time](#simulating-a-different-date-and-time-local-only)). An imported
historical week may already be locked. To exercise different states, add games manually in a draft and
open the week:

| Game timing                                 | What to expect                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Kickoff a few days away                     | Picks and POW can be saved and changed                                 |
| Today, before kickoff                       | Picks and POW can still be changed                                     |
| Kickoff in the past, or both scores entered | No new picks or changes; a POW on that game cannot be moved or removed |

Use the **Supabase Studio** URL from `pnpm ports` to inspect accounts under Authentication and tables
under Table Editor. The main checkout's Studio URL is `http://127.0.0.1:54323`. The test inbox URL shows
emails sent by the local Auth service.

## League rules

The app's `/how-to-play` page explains the player and admin flows, including reminders by email and notification.
[`packages/shared/src/rules.ts`](packages/shared/src/rules.ts) is the implementation of scoring and locks,
and [`packages/shared/src/awards.ts`](packages/shared/src/awards.ts) of the weekly awards.

### Messages

Active league members can react to any message or reply, once per emoji per player. Counts and your
own selections are visible to members. Reactions do not bump threads or create unread indicators.
Only admins can permanently delete threads, including all replies and reactions, using the thread’s **⋯** menu and a confirmation. Read markers and queued notifications are removed too.
Only admins can pin or unpin threads as announcements; pinned threads appear first without changing
unread status. The board loads the newest 30 threads, with **Load older threads** for the rest. A player can start five
threads a day in a league (two in an account's first 24 hours); a player can post ten replies a minute (twenty a day in
an account's first 24 hours), and not the same reply twice in a row. Quoted replies can reference only messages in the same
thread and show the original author and text with a link back. You can remove a quote before posting without losing your reply.

### Content moderation

Required for the App Store (guideline 1.2), and the same on the website:

- **Terms of use** (`/terms`, works signed out). The first name step has an "I agree" checkbox; players who joined before
  get a one-time sheet before their next post, reply or reaction. Settings links the Terms and `support@pow-pickem.com`.
- **Screening.** Every new thread, reply, display name and league name goes to Cloudflare's Clef-flash model on Workers
  AI before it is saved ([`src/screening.ts`](apps/api/src/screening.ts)). The policy is plain English, so the repository
  holds no list of offensive words. There are two outcomes: block refuses it ("That doesn't meet the league's
  guidelines.", the draft stays) and allow posts it; anything borderline is left to reports. If the model doesn't
  answer within 1.5 s the content is saved `unchecked` and the cron rechecks it, hiding and flagging it if it should
  have been blocked. The threshold is `SCREENING_THRESHOLDS.block` in `packages/shared`.
- **Reports.** ⋯ on any message → **Report**; ⋯ on a member in the League tab → **Report name**; the League tab also
  reports the league's name. At most 20 a day per player. A message two players report, or one reported as a threat
  or self-harm, is hidden until reviewed (and the threat emails the operator at once); the larger Clef model reads the
  thread around a reported message and removes it if it is sure.
- **Review.** League admins see their league's reports on the League tab (**Reports**): Remove, Dismiss, or remove
  and mute the author there for 24 hours or 7 days. Reports about admins and about league names, and appeals, go only to
  the operator, whose **Reports** section on `/operator` covers every league and lists players with three or more
  removals in 30 days, with **Suspend posting**. A daily digest emails operators from 14:00 UTC when anything is open or
  automation acted.
- **Removal** is soft: everyone sees "Message removed" in its place and the text is cleared after 30 days. Removing a
  thread's first message removes the thread. The second removal in 30 days mutes the author everywhere for 24 hours,
  the third for 7 days. The author can **Ask for a review** once.
- **Blocking** (⋯ → **Block**) is one-way and app-wide: the blocked player's threads, replies and reactions are hidden
  from the blocker, and their threads notify the blocker no longer. Undo it in Settings → **Blocked players**.
- **Never picking.** A mute or a suspension stops posting, replying, reacting and name changes, nothing else: picks, the
  POW, tiebreakers, results, standings and joining leagues all keep working.

Locally (`pnpm dev`, tests) nothing is screened, because the Node API has no Workers AI binding; tests use a fake that
blocks the harmless placeholder `forbiddenword`. `pnpm worker:dev` leaves the binding out too
(`WORKER_DEV_SCREENING=1` keeps it, after `wrangler login`). To set or recheck the threshold, run
`pnpm moderation:eval` with `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and `MODERATION_EVAL_FILE`: it runs your
own labeled messages (one JSON object a line: `kind`, `text`, `expect` of `allow` or `block`), fails if any expected
to be allowed is blocked, and prints the range of block thresholds that would sort every line as labeled. The labeled set stays outside this public repository; the script prints line numbers and scores, never text.

### Scoring

Pick the team that will cover the displayed spread. Spreads are stored as the home team's line: `-3.5`
means the home team is favored by 3.5 points. A winning pick earns the game's points. Losing and missing
picks earn zero; a push earns zero and counts as neither a win nor a loss.

Spreads stay fixed after opening unless an admin edits them manually. Pulling results and finalizing
never replace them with new provider lines; scoring uses the spreads currently saved in the app.

Default point values use **Eastern time**, with holidays taking priority. Admins can override each game's value.

| Game slot                               | Points |
| --------------------------------------- | ------ |
| Sunday daytime                          | 1      |
| Sunday night, 7pm ET or later           | 2      |
| Thursday or Monday                      | 3      |
| Tuesday, Wednesday, Friday, or Saturday | 2      |
| Thanksgiving or Christmas Day           | 4      |

A winning **Pick of the Week** earns **5 bonus points** in addition to the game's value. A losing or
pushed POW earns no bonus. There is no automatic POW: a player who doesn't choose one has none that
week. The POW can go on any game that hasn't kicked off, and can be moved or removed until the game
holding it kicks off. After that it stays on that game for the week.

### Deadlines and rankings

- **Before kickoff**, a game's pick can be added or changed, and the POW can be put on it, moved off it,
  or removed.
- **At kickoff**, the game locks: no new picks or changes are accepted, and it can no longer become the
  POW. A POW already on it cannot be moved or removed. A recorded result locks the game regardless of
  the clock. A change the player hadn't saved on a game that locks is undone, and the save bar says so.
- **The tiebreaker guess** follows its game's lock: it can be entered or changed until kickoff. A saved
  guess cannot be removed.
- **The tiebreaker game** is the admin's explicit choice, otherwise the last Monday game, otherwise the
  last game on the slate.
- **Weekly ranking:** most points, then most games won, then the closest guess to the tiebreaker game's
  combined final score. At equal distance, the guess that did not go over wins. Remaining ties share the win.
- **Season ranking:** total points from finalized weeks, then POWs won, total wins, Monday wins, and
  Sunday night wins. Remaining ties share a rank.

### Awards and the Low Point Loser

Each finalized week names its winner and hands out these, all worked out from the final results:

| Award                 | Who gets it                                                                               |
| --------------------- | ----------------------------------------------------------------------------------------- |
| Low Point Loser (LPL) | Last place by the weekly ranking. Shared if still level; nobody if the whole league tied. |
| Perfect week          | Picked every game and won them all                                                        |
| Bullseye              | Guessed the tiebreaker game's combined score exactly                                      |
| Lone wolf             | The only player on the covering side of a game that at least three players picked         |

### Week lifecycle, privacy, and history

The stored week lifecycle is `draft → open → final`; only an admin finalizes a week. The interface derives
additional phases such as **Games underway** and **Awaiting finalization** from kickoffs and scores.
Picks stay private until finalization, including from admins. Removing a member, or a member leaving,
preserves their history. Finalizing a week records who it is scored for (everyone in the league at its last
kickoff, plus anyone who picked), so leaving or rejoining later never changes a closed week; finalizing again
after a reopen only adds players. Weeks closed before that record existed use membership dates instead.

## Architecture and repository layout

This is a TypeScript pnpm workspace with an Expo (React Native) app that is both the website and the iPhone
app, a Hono API, and Supabase Auth + PostgreSQL.

```text
Browser ── /api/* ──> Hono API ── Drizzle ──> PostgreSQL
   │                     │
   ├── Supabase Auth     ├── verifies Supabase access tokens
   └── ESPN image CDN    ├── ESPN scoreboard (imports and results)
       (team logos)      └── ESPN game summary + Kalshi markets (matchup sheet)
```

In development the Expo web preview calls the API directly (CORS limited to this checkout's Metro origin, and
only outside production). In production one Cloudflare Worker serves both: its static assets are the Expo web
build, and `/api/*` runs the API, so browser API requests stay on the same origin. The iPhone app calls the
same API at `www.pow-pickem.com`. Each client signs in through Supabase Auth and sends its access token to the
API as `Authorization: Bearer <access_token>`.
Application data goes through the API; app tables have row-level security enabled without client policies.

| Path                                     | Responsibility                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`apps/mobile`](apps/mobile)             | Expo Router, React Native and react-native-web: the iPhone app and, exported for the web, the website                   |
| [`apps/api`](apps/api)                   | Hono routes for profiles, leagues, invites, weeks, picks, results, and messages; Worker and Node entrypoints, providers |
| [`packages/shared`](packages/shared)     | Shared Zod schemas, types, scoring, locks, awards, season selection, and statistics                                     |
| [`packages/db`](packages/db)             | Drizzle schema, PostgreSQL client, TLS policy, migration generation, and schema documentation generator                 |
| [`supabase`](supabase)                   | Local service configuration, SQL migrations, migration metadata, and development seed                                   |
| [`e2e`](e2e)                             | Playwright full-stack tests for desktop Chromium and mobile WebKit                                                      |
| [`scripts`](scripts)                     | Worktree ports, Supabase wrappers, environment generation, connection diagnostics, app icons, and deploy checks         |
| [`.github/workflows`](.github/workflows) | CI checks and production deployment                                                                                     |
| [`docs/schema.md`](docs/schema.md)       | Generated ER diagram and table/column reference                                                                         |

Useful starting points are [`apps/api/src/app.ts`](apps/api/src/app.ts) for API composition,
[`apps/mobile/src/lib/api.ts`](apps/mobile/src/lib/api.ts) for the client's API requests and Auth configuration, and
[`packages/db/src/schema.ts`](packages/db/src/schema.ts) for the database model. Request and response
contracts live in `packages/shared`. Keep Hono routes chained so the client retains their inferred types.

ESPN imports use a public, unofficial scoreboard feed with no API key. It may omit spreads or change shape;
the admin can enter games, spreads, and scores manually. Imports and score pulls are explicit admin actions.

The matchup sheet loads on demand from `GET /api/games/:gameId/insights`. Team form, injuries, leaders, and
news come from ESPN's game summary; win and cover prices come from Kalshi's public market API. Neither needs
a key, both are cached in memory, and either can fail on its own: the sheet shows whatever arrived. A game
added by hand has no ESPN stats. The sheet contains public background only, never this league's picks.
Team logos are loaded by the browser from ESPN's image CDN (`a.espncdn.com`).

The website has a manifest and icons so it can be installed to a home screen. A push-only service worker
(`apps/mobile/public/push-sw.js`, served with `Cache-Control: no-cache` from `_headers`) shows notifications
and caches no pages or responses, so nothing works offline.

## Development and testing

### Commands

Run workspace commands from the repository root:

| Command              | Purpose                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`           | Start Supabase, the API and Expo with its browser preview (`pnpm mobile --web`)           |
| `pnpm mobile`        | The same without opening the browser, for testing on an iPhone                            |
| `pnpm worker:dev`    | Run the production build in the Workers runtime against local Supabase                    |
| `pnpm build`         | Expo web build to `apps/mobile/dist-web`, then a dry-run Worker bundle to `apps/api/dist` |
| `pnpm lint`          | Check formatting and lint rules with Biome                                                |
| `pnpm format`        | Apply Biome formatting and fixes                                                          |
| `pnpm typecheck`     | Type-check workspace packages                                                             |
| `pnpm test`          | Run unit, API, app, and Node script tests                                                 |
| `pnpm check`         | Run lint, type checking, and `pnpm test`                                                  |
| `pnpm test:e2e`      | Run full-stack Playwright tests against the local Worker                                  |
| `pnpm test:e2e:ui`   | Open Playwright's interactive test runner                                                 |
| `pnpm test:all`      | Run `pnpm test` followed by E2E tests                                                     |
| `pnpm test:contract` | Check ESPN's and Kalshi's live feeds against what the app reads                           |
| `pnpm mobile:check`  | Type-check and test the Expo app                                                          |
| `pnpm mobile:export` | Export the iOS JavaScript bundle (catches native-only bundling errors)                    |
| `pnpm icons`         | Redraw the app icons in `apps/mobile/public` after changing `scripts/icons.mjs`           |

`pnpm check` does not include E2E tests or production builds. `pnpm test:all` does not include lint or
type checking. For a full local verification, run `pnpm check`, `pnpm test:e2e`, and `pnpm build` after
starting Supabase, generating `.env`, and installing the browsers.

### Test layers

| Layer                               | Tool and location                                         | Requirements                                                                        |
| ----------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Rules, schemas, and statistics      | Vitest in `packages/shared/src/**/*.test.ts`              | No running services                                                                 |
| Database tooling and safety scripts | Node test runner in `packages/db/scripts/` and `scripts/` | No running services                                                                 |
| API                                 | Vitest + `app.request()` in `apps/api/test/`              | Database suites require local Supabase and `DATABASE_URL`; they skip if it is unset |
| App logic                           | Vitest (Node) in `apps/mobile/src/**/*.test.ts`           | No running services                                                                 |
| End-to-end                          | Playwright in `e2e/tests/`                                | Local Supabase, generated `.env`, Chromium, and WebKit                              |
| Feed contracts                      | Vitest in `apps/api/test/contract/`                       | Network access to ESPN and Kalshi; run daily by `.github/workflows/contract.yml`    |

ESPN's scoreboard, game summary, news and logo feeds are unofficial. The app reads them leniently, so a
change empties part of the matchup sheet rather than breaking it, which also means nothing in the app
notices. `pnpm test:contract` runs the app's own URLs, schemas and parsers against today's responses and
fails on anything that would quietly empty or misread what players see: a missing field, an unknown team
abbreviation, a spread with the wrong sign, an empty week. Kalshi's API is documented, but the app relies on
conventions it doesn't promise (event tickers built from the kickoff date and team codes, spread strikes on
the half point), and a ticker it doesn't list comes back as an empty list rather than an error. So the same
checks look up the games kicking off in the next three days on Kalshi exactly as the app does, and check
that its prices agree with ESPN about who is favored. The daily workflow opens a GitHub issue (label
`feed-contract`) when a check fails and closes it when they pass again.

E2E always tests the production build in the Workers runtime, as CI does: it starts `pnpm worker:dev` (the
Expo web build and the API on one origin), or reuses one already running outside CI. It refuses remote
database and Auth services, and its browsers can reach only this machine (every other host goes to a proxy
that isn't there), so a link to the live site fails the test instead of signing up a real account. Tests
create their own data rather than depending on the seed. Traces and
screenshots are disabled to keep credentials and invite links out of artifacts.

For focused runs, use workspace filters such as `pnpm --filter @picks/shared test` or
`pnpm --filter @picks/api test`. Add tests at the lowest layer that catches a change; UI, route, Auth,
and schema changes also need E2E verification. Time-dependent rules accept a `now` argument so tests
can use fixed dates.

Pull request CI runs a Git history secret scan, lint, type checking, migration and schema documentation
drift checks, unit/app/script tests, the iOS JavaScript bundle, the Expo web build, and a Worker bundle. A
separate job starts
local Supabase, runs database-backed API tests, and runs E2E against the Worker. Playwright reports are retained for three days.

## Database workflow

[`packages/db/src/schema.ts`](packages/db/src/schema.ts) is the database source of truth. Drizzle generates
SQL; the Supabase CLI applies it. [`docs/schema.md`](docs/schema.md) is generated from the schema and its
comments, and CI checks that it is current.

For a schema change:

1. Edit `packages/db/src/schema.ts`, including table and column descriptions.
2. Run `pnpm db:generate --name <short_description>` to generate SQL and refresh the schema reference.
3. Review the SQL, then run `pnpm db:reset` to rebuild the **local** database from migrations and seed.
   This deletes existing local data. Update `supabase/seed.sql` if the schema change requires it.
4. Run the relevant tests, including E2E for schema changes.
5. Commit the schema, SQL migration, `supabase/migrations/meta/`, and `docs/schema.md` together.

For triggers, functions, grants, or other SQL Drizzle cannot express, run
`pnpm db:migrate:custom --name <short_description>` and fill in the generated file. For documentation-only
schema comment changes, run `pnpm db:erd`. Edit descriptions in the schema rather than editing the
generated Markdown by hand.

Table and column renames can prompt interactively during generation; run the generator in a terminal
and select the intended rename. Never edit a migration already merged to `main`; add a new migration.
Production migrations run before the new app deploys, so they must remain compatible with the currently
running version. Use separate expand and contract changes when removing or replacing fields.

## Deployment

The app is one [Cloudflare Worker](https://developers.cloudflare.com/workers/), `pow-pickem`, configured in
[`apps/api/wrangler.jsonc`](apps/api/wrangler.jsonc):

| Piece                         | Role                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Static Assets                 | Serves the Expo web build (`apps/mobile/dist-web`) from Cloudflare's edge, falls back to `index.html`; never sleeps      |
| `src/worker.ts`               | Runs the Hono API for `/api/*` only, placed in AWS us-east-1 beside the Supabase project                                 |
| Hyperdrive                    | Pools database connections and verifies Supabase's certificate (`verify-full` with the Supabase CA)                      |
| `apps/mobile/public/_headers` | Caches hashed files under `/_expo/static/` and `/assets/` forever; sets the site's security headers (CSP, HSTS, framing) |

Workers start in milliseconds, so there is no cold-start wait. The app runs on **Workers Paid** ($5 a month),
which email requires: on the free plan Cloudflare Email Sending can only send to your own verified addresses
(see "Email" below). The plan includes 10 million API requests and 30 million CPU milliseconds a month, and
Hyperdrive queries are unlimited; static asset requests are always free. API requests use about 10–130 ms of
CPU each (time waiting on the database or ESPN doesn't count), so the app stays well inside the included
usage. `wrangler.jsonc` caps each invocation at 2 s of CPU to stop a runaway loop; Workers Logs show each
request's CPU time. A rate limiting rule on the zone (dashboard, Security → Security rules) blocks an IP for
10 s once it sends more than 50 requests to `/api/*` in 10 s, before the Worker runs, so a flood from one
source can't run up the bill or trip the account's spend limit. That rule only guards the custom domain, so
`wrangler.jsonc` turns off the Worker's `workers.dev` and preview URLs (`workers_dev`, `preview_urls`): the app
is reachable only at `www.pow-pickem.com`. The zone forces HTTPS (Always Use HTTPS, minimum TLS 1.2), and the
apex `pow-pickem.com` redirects to `www`.

`pnpm worker:dev` runs the same Worker locally against local Supabase. Day-to-day development stays on
`pnpm dev`, where `src/index.ts` serves the API on Node and Expo's dev server serves the app.

### Initial configuration

Run these once from `apps/api` (`pnpm exec wrangler login` first):

1. Save the [Supabase root CA](https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt)
   (also in `packages/db/src/connection.ts`) and upload it:
   `pnpm exec wrangler cert upload certificate-authority --ca-cert prod-ca-2021.crt --name supabase-root-2021`.
2. Create the Hyperdrive config with the Supabase **direct** connection string (Hyperdrive does its own
   pooling), and put the printed id in `wrangler.jsonc`:
   `pnpm exec wrangler hyperdrive create pow-pickem-db --connection-string="$(pbpaste)" --ca-certificate-id <id> --sslmode verify-full --caching-disabled`.
   If the direct host isn't reachable over IPv4, use the **session pooler** string instead. Keep query
   caching off: Hyperdrive's cache isn't cleared by writes, so membership checks and reads after a save
   would be up to a minute stale. If the database password changes, update the config with
   `pnpm exec wrangler hyperdrive update <id> --origin-password` as well as `SUPABASE_DB_URL`.
3. Set the Worker's secrets: `pnpm exec wrangler secret put SUPABASE_URL`, then `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY` (the project's secret key, which account deletion needs) and, optionally,
   `OPERATOR_USER_IDS`.
4. Add the domain to Cloudflare and point the registrar's nameservers at it, then attach `www.pow-pickem.com`
   to the Worker as a custom domain (Workers → `pow-pickem` → Settings → Domains & Routes).
5. Configure Supabase Auth's Site URL and redirect URLs for the public web URL. The redirect URLs must cover
   `/reset-password` (password reset emails), `/auth/callback` (sign-up confirmation) and `/account` (email
   change), or Supabase silently sends people to the Site URL instead. The iPhone app's `pow-pickem://` links
   are listed in [`apps/mobile/README.md`](apps/mobile/README.md).
6. In the GitHub **`production` environment**, add these secrets, and the variable `APP_URL` (the public URL,
   which the deploy checks afterwards):

   | Secret                  | Purpose                                                                                    |
   | ----------------------- | ------------------------------------------------------------------------------------------ |
   | `SUPABASE_DB_URL`       | Supabase session pooler URL for migrations; used for IPv4 connectivity from GitHub runners |
   | `CLOUDFLARE_API_TOKEN`  | A token from the **Edit Cloudflare Workers** template, scoped to this account              |
   | `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account that owns the Worker                                                |

7. Verify the database TLS configuration described below before deploying.

### Email

Two kinds of email, both sent through [Cloudflare Email Sending](https://developers.cloudflare.com/email-service/)
from `noreply@pow-pickem.com`:

- **Sign-in emails** (sign-up confirmation, password reset, email-change confirmation, and notices after a
  password or email change) are sent by Supabase Auth over Cloudflare's SMTP relay. Branded templates live in
  `supabase/templates/` and are wired up in `supabase/config.toml`.
- **Notification emails** (a new message thread; a pick reminder at 7pm league time the evening before a game
  day, to players with games still to pick; results and updates, the `league_event` kind) are sent by the Worker through its `send_email` binding (`EMAIL`
  in `wrangler.jsonc`; no API key). They are queued in the `email_outbox` table, so each is sent once
  (per-email dedupe keys) and retried with backoff if Cloudflare can't take it. Players turn each kind off
  under **Settings** or with the link in each email, which also carries one-click
  `List-Unsubscribe` headers.

The Worker's **Cron Trigger** (`*/5 * * * *` in `wrangler.jsonc`) first advances leagues that run themselves
(`advanceLeagues`, logged as `automation_jobs`), then runs the email job: it queues the pick
reminders that are due and sends or retries whatever is waiting. A new thread's emails go out straight after
the post, in the same request's `waitUntil`; anything left over is picked up by the next run. The job is
idempotent. Runs that did something log an `email_jobs` line with counts; failures log Cloudflare's error code
(for example `E_SENDER_NOT_VERIFIED` or `E_RECIPIENT_SUPPRESSED`), never the provider's message.

**Budget.** Workers Paid includes 3,000 emails a month across the account, then $0.35 per 1,000. Before every
notification email the API takes a slot from a per-day counter (`email_usage`) and stops at
`EMAIL_DAILY_LIMIT` (1,000) or `EMAIL_MONTHLY_LIMIT` (10,000, per UTC calendar month). These are a safety cap
against runaway sending, well above what the leagues use; a month at the cap would cost about $2.45 beyond
the included 3,000. Over budget, emails wait in the outbox until the next UTC day, and
ones that expire meanwhile (a reminder after its game day's first kickoff) are skipped with
`last_error = 'OVER_BUDGET'`. Cloudflare also sets a daily quota of its own that starts low on new accounts
and grows with use; if it refuses a send with `E_DAILY_LIMIT_EXCEEDED`, what is due waits for the next UTC
day, and nothing is counted against the caps above. The log shows `email_budget_reached` or the error code when either happens.

One-time setup:

1. **Workers Paid:** upgrade the account (Workers & Pages → Plans). Without it, sends to players fail with
   `E_RECIPIENT_NOT_ALLOWED` and are marked failed.
2. **Email Sending:** onboard the domain, from `apps/api`:
   `pnpm exec wrangler email sending enable pow-pickem.com` (or Compute & AI → Email Service → Email Sending →
   Onboard Domain). Cloudflare adds the SPF and DKIM records itself, since the zone is on Cloudflare; check
   them with `pnpm exec wrangler email sending dns get pow-pickem.com`. Add a DMARC record too, starting with
   `_dmarc.pow-pickem.com TXT "v=DMARC1; p=none;"`.
3. **Supabase Auth** (dashboard, Authentication): under **SMTP Settings**, enable custom SMTP with host
   `smtp.mx.cloudflare.net`, port `465`, user `api_token`, a Cloudflare API token with the **Email Sending:
   Edit** permission (and nothing else) as password, and sender `noreply@pow-pickem.com` / `POW Pick'em`.
   Under **Rate Limits**, set emails per hour to about **10**: Auth's emails bypass the API's budget, and this
   keeps them inside the room it leaves. Under **Emails**, copy each template's subject and HTML from
   `supabase/config.toml` and `supabase/templates/`. (Don't use `supabase config push`: it would also push
   local settings such as the localhost site URL.) Make sure the redirect URLs include
   `https://www.pow-pickem.com/reset-password`, `https://www.pow-pickem.com/auth/callback` and
   `https://www.pow-pickem.com/account`. Production has **Confirm email** on: a new player opens the
   confirmation link (`/auth/callback`) before they can sign in. (Locally it is off, so made-up addresses
   work.) Every sign-up therefore sends an email, which is why the hook below matters. Under **Hooks**, add a **Before User Created** hook of type
   **Postgres** with the function `public.hook_reject_test_signups` (installed by the migrations): it refuses
   sign-ups on domains reserved for testing (`example.com`, `.test`, `.invalid` and the like), so a test that
   reaches production by mistake creates no account and bounces no email. It stays off locally, where E2E
   signs up `@example.com` users.
4. **Turn notification email on:** generate a secret and set it on the Worker, from `apps/api`:
   `openssl rand -base64 32 | pnpm exec wrangler secret put UNSUBSCRIBE_SECRET`. Until it is set the Worker
   queues and sends nothing (the cron runs and returns at once). Changing it later breaks the unsubscribe
   links in emails already sent. `APP_URL` is a var in `wrangler.jsonc`; `EMAIL_FROM`, `EMAIL_DAILY_LIMIT` and
   `EMAIL_MONTHLY_LIMIT` can be overridden the same way, if the plan changes.

### Push notifications

Web Push needs no vendor: the Worker encrypts and signs each notification itself (`src/webPush.ts`, RFC 8291
and RFC 8292 on WebCrypto) and posts it to the browser's push service (Apple, Google, Mozilla, Microsoft).
Push is off until all three VAPID secrets are set; until then the settings screen says it isn't available
yet. Nothing is sent to a device that hasn't opted in.

One-time setup, from `apps/api`:

```sh
umask 077; keys="$(mktemp)"                  # readable only by you, removed below
node ../../scripts/vapid-keys.mjs > "$keys"  # keep this pair; a new one orphans every device
key() { node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$keys','utf8'))['$1'])"; }
key publicKey  | pnpm exec wrangler secret put VAPID_PUBLIC_KEY
key privateKey | pnpm exec wrangler secret put VAPID_PRIVATE_KEY
echo "mailto:<a contact address>" | pnpm exec wrangler secret put VAPID_SUBJECT
rm "$keys"
```

The same Cron Trigger as email (`*/5 * * * *`) queues due reminders and sends up to 100 pending deliveries
per run with five concurrent senders; larger backlogs carry over to the next run. A new thread's
notifications are queued inside its transaction and sent in the request's `waitUntil` after it commits.
Runs that did something log a `push_jobs` line with counts. Transient failures retry after 5, 10, 20 and
40 minutes, then stop after five attempts. A 404 or 410 from a push service removes that device and its
queue. Delivery rows are kept 30 days. Delivery is at least once: the notification tag and the `Topic`
header replace a duplicate after an ambiguous send.

Subscription endpoints and keys are private capabilities: never logged, and sends go only to known HTTPS
push services. Before relying on it, smoke-test an installed iPhone app and an Android browser: subscribe,
get a thread alert with the app closed, open its link, change preferences, and turn notifications off.
Desktop WebKit emulation can't establish real iPhone delivery.

### Content moderation in production

Screening uses the Worker's `AI` binding (Workers AI; no key, billed per input token: about $0.04 a million for
Clef-flash, so cents a month). It is on by default. `MODERATION_MODE=off` (a Worker variable or secret) is the
emergency switch for a Workers AI outage or a run of wrong blocks: content then saves `skipped` and nothing is refused.
Reports and blocks keep working either way. Set `OPERATOR_USER_IDS` so someone gets the threat alerts and the daily
digest, and act on reports within 24 hours (Apple checks). Before the first App Store submission, run
`pnpm moderation:eval` and set `support@pow-pickem.com` up in Cloudflare Email Routing.

### Release sequence

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on pushes to `main` and manual dispatch:

```text
CI → verified database connection → migrations → build → wrangler deploy → live health check
```

The Expo web build and the API go live together. A tab that was already open keeps its old web build (one
bundle, loaded with the page), and installed iPhone apps keep theirs until updated, so keep
API changes compatible with it, and migrations compatible with the old API. The health endpoint checks
database connectivity and returns HTTP 503 if that check fails. A failed live check doesn't undo the deploy:
`pnpm --filter @picks/api exec wrangler rollback` returns to the previous version. Local seed data is not
applied in production.

The Node entrypoint (`src/index.ts`) still listens on `PORT` with a `DATABASE_URL`, so the API can move to
another host; only `wrangler.jsonc`, `src/worker.ts` and the deploy job are Cloudflare-specific.

### Monitoring and recovery

What alerts you:

| Signal                                    | Where                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| The live API or database stops answering  | [`uptime.yml`](.github/workflows/uptime.yml) checks `/api/health` every 15 minutes and opens an `uptime` issue |
| Worker errors and exceptions              | Cloudflare Notifications, "POW Pick'em: Worker issues" (Workers Observability real-time issues)                |
| HTTP DDoS mitigations, certificate events | Cloudflare Notifications, "POW Pick'em: HTTP DDoS" and "POW Pick'em: certificate"                              |
| Spend reaching $10 (then error 1103)      | Cloudflare's budget alert; the Workers spend limit blocks `/api/*` and the cron at $10                         |
| ESPN or Kalshi changing shape             | [`contract.yml`](.github/workflows/contract.yml) opens a `feed-contract` issue                                 |
| Vulnerable dependencies                   | Dependabot alerts and security-update PRs ([`dependabot.yml`](.github/dependabot.yml))                         |

Cloudflare Notifications email the account address; manage them under **Manage account → Notifications**.

When something breaks:

- **A bad deploy.** `pnpm --filter @picks/api exec wrangler rollback` from the repo root returns to the
  previous Worker version within seconds. It does **not** undo migrations, which is why they must stay
  compatible with the previous code (expand, then contract). Undo a migration with a new one.
- **Error 1103 on `/api/*`.** The Workers spend limit was reached. Check Workers Logs and the zone's
  analytics for the source, block it, then raise or reset the limit under **Billing**.
- **A bad migration or deleted data.** The Supabase project is on the Free plan, which keeps **no backups**
  and no point-in-time recovery. Before a risky migration, take a dump yourself (it holds every player's
  data; keep it off the repo and delete it when done):
  `pg_dump "$(pbpaste)" --no-owner --format=custom --file=pow-$(date +%F).dump`, using the session pooler
  URL; `pg_restore --clean --no-owner -d <url> pow-<date>.dump` puts it back.

Rotating credentials:

| Credential             | Rotate by                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Database password      | Reset it in Supabase, then `wrangler hyperdrive update <id> --origin-password` and the `SUPABASE_DB_URL` secret |
| `CLOUDFLARE_API_TOKEN` | Roll it in the Cloudflare dashboard and replace the GitHub secret                                               |
| `UNSUBSCRIBE_SECRET`   | `wrangler secret put`; links in emails already sent stop working                                                |
| VAPID key pair         | Don't, unless it leaked: every subscribed device must turn notifications on again                               |
| Supabase SMTP token    | Roll the Cloudflare Email Sending SMTP credential and update Supabase Auth → SMTP settings                      |

## Credentials and diagnostics

Remote database connections require TLS with certificate and hostname verification. The API and the
connection-check script share this policy in [`packages/db/src/connection.ts`](packages/db/src/connection.ts).
Supabase database hosts use the bundled public Supabase CA certificate. In production the Worker connects
through Hyperdrive, which does the verification itself (`--sslmode verify-full` with the same CA). Loopback connections support the
local stack without TLS; URL parameters cannot disable TLS for a remote connection. Startup and health
checks also verify that the database connection behind a pooler is encrypted.

When rolling out this TLS policy to an existing Supabase project, coordinate enabling **Enforce SSL on
incoming connections** in Supabase Database Settings with the API deployment. That setting restarts the
database and can interrupt older builds that do not request TLS. The migration connection check blocks
deployment until the pooler-to-database connection is encrypted; application code alone does not enable
that setting.

Use a publishable key or legacy `anon` key for `SUPABASE_PUBLISHABLE_KEY`. Privileged keys are rejected
before API startup because `/api/config` exposes the public key to browsers. `SUPABASE_SECRET_KEY` is the one
privileged key, used only for the Auth admin call that deletes an account and never exposed. Environment files are ignored
except for `.env.example`. `pnpm env:local` intentionally writes local credentials to `.env`; keep it private.

API logs include route templates, request IDs, fixed explanations for known failures, vetted error codes,
and safe source locations. They omit raw URLs, request data, SQL parameters, arbitrary exception messages,
and nested errors. Use a response's **`X-Request-ID`** to correlate a failure with its log entry. CLI wrappers
redact credentials before printing output. Hosting access logs are separate; avoid raw request-URL logging
for invite links.

[`scripts/check-db-url.mjs`](scripts/check-db-url.mjs) checks a database connection without printing its
password. On macOS, pass a copied connection string through stdin:

```sh
pbpaste | node scripts/check-db-url.mjs
```

## Troubleshooting

| Symptom                                                 | What to check                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The deployed API returns 500 or 503                     | Check Workers Logs for the request's `X-Request-ID`. A startup error names the missing secret; a 503 is the database. |
| Supabase will not start                                 | Start Docker Desktop or OrbStack, then retry `pnpm db:start`. Inspect the stack with `pnpm db:status`.                |
| API reports invalid configuration, or `.env` is missing | Run `pnpm db:start`, then `pnpm env:local`, and restart `pnpm dev`. Use `.env.example` to check variable names.       |
| The app or tests use the wrong checkout                 | Compare `.env` with `pnpm ports`, regenerate it with `pnpm env:local`, and use `pnpm sb` for CLI commands.            |
| `pnpm dev` reports a port already in use                | Stop the other `pnpm dev` or `pnpm mobile` in this checkout. The launcher refuses a busy port instead of switching.   |
| `pnpm dev` finds no LAN address                         | Connect to a network, or pick one with `MOBILE_DEV_INTERFACE=en0`. Offline, use `pnpm worker:dev` for the browser.    |
| Playwright cannot find a browser                        | Run `pnpm playwright:install`. E2E needs Chromium and WebKit.                                                         |
| API database tests skip                                 | Start the local stack and generate `.env` so `DATABASE_URL` is available.                                             |
| E2E rejects the environment                             | It requires loopback database and Auth URLs. Regenerate `.env` from local Supabase.                                   |
| Seeded accounts or weeks are missing                    | For a disposable local database, `pnpm db:reset` reapplies migrations and seed, deleting existing local data.         |
| A new week has no import or a missing spread            | ESPN may have no schedule or odds for that week. Retry the import while still in draft, or add/edit games manually.   |
| Picks are locked in an imported week                    | Locks follow actual kickoffs. Use manually added future games to test picking.                                        |
| Finalize week is unavailable                            | Every game needs both final scores. Enter scores for manually added games; ESPN results only update imported games.   |
| The matchup sheet is empty or missing a section         | ESPN or Kalshi had nothing for the game or didn't answer. Manually added games have no ESPN stats.                    |
| A password reset email never arrives locally            | Local Auth doesn't send real email. Open the test inbox URL from `pnpm ports`.                                        |
| Production health or migration connection check fails   | Check the session pooler URL, verified TLS, and Supabase SSL enforcement. Use the connection diagnostic above.        |

See [`AGENTS.md`](AGENTS.md) for additional contributor guidance on UI conventions, API structure, and
repository tooling.

## Native iPhone app (Expo)

The app lives in [`apps/mobile`](apps/mobile/README.md). It uses Expo Router and React Native with the same Hono API, Supabase accounts and shared TypeScript rules, and the same code, exported for the web, is the website.

To try it on your iPhone against local data, install Expo Go, start Docker, and run `pnpm mobile` (or `pnpm dev`), then scan the QR code. It starts Supabase, the API and Expo with this worktree's ports and your LAN address; nothing to configure. `pnpm mobile:prod` runs the app against production instead. See the mobile README for the options, development builds, auth redirects, native push setup and release steps.
