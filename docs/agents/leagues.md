# Leagues, types and members

Code: `packages/shared/src/leagueTypes.ts` (the type registry), `apps/api/src/leagues.ts` (leagues, members, invites, standings), `apps/api/src/leagueTodos.ts` (what waits for the player in each league), `apps/api/src/typeHooks.ts`, `apps/api/src/context.ts` (access checks); in the app, `apps/mobile/src/screens/NewLeagueScreen.tsx` and `apps/mobile/src/lib/leagueTodo.ts`.

## Structure

- league → seasons (by year) → weeks → games → picks. A league keeps its members across seasons.
- **Week line:** weeks 1–18 are the regular season, 19 Wild Card, 20 Divisional, 21 Conference, 22 Super Bowl (`weekLabel`, `POSTSEASON_ROUNDS` in `seasons.ts`; a CHECK holds `weeks.number` to 1–22).
- Whoever creates a league is its first admin. Others join through its invite link (`/join/<code>`), which an admin can replace so old links stop working. The invite's preview (`GET /invites/:code`, signed in) names the league's type and member count.

## League types

- Every league has a type (`leagues.type`), fixed when it is created: `weekly` (the default, and every league from before types), `playoff`, `squares` or `survivor`. Every type is open to every player.
- The registry (`LEAGUE_TYPE_INFO`) says what each type owns: name, description, icon, settings schema (stored per season in `seasons.settings`, parsed with it on every write and read), the weeks it covers, whether a new league gets its first season when created (`seasonOnCreate`), how it can be run (`management`), its reveal point and its tabs. The API, the app and the cron read it.
- Shared by every type: membership, admins, invites, the message board, email and push, Settings and the size limits.
- Every type-specific route checks the type first (`requireLeagueType`, `requireBoard`) and answers 404 for another type. The week, game and pick routes in `weeks.ts` serve weekly and playoff leagues (the matchup sheet survivor too), and week creation there stops at 18.
- **Management:** a weekly league is run `manual` (Hands-on: the admins run each week; existing leagues and creates without `management`) or `auto` (Automatic: the feed does the chores). The other types are always `auto`; a CHECK keeps manual to weekly. An admin switches in League → League settings at any time.
- **A type's pieces:** its routes are a module mounted in `app.ts` (`<type>Routes(deps, services)` plus `<type>Hooks`); `typeHooks.ts` dispatches shared events to the hooks (`memberRemoved`, inside the membership change's transaction; `startSeason`); its automation handler is in `apps/api/src/automation/`, its reminder handler in `apps/api/src/reminders/`; its screens are a folder under `apps/mobile/src/screens/` registered in `LEAGUE_TYPE_SCREENS`; its seed is a file in `supabase/seeds/`, so types don't edit `seed.sql`.

## Creating a league and starting a season

- **New league** (`/leagues/new`) chooses the type, for weekly how to run it (Automatic preselected), the type's settings, and **Start with members from** (default Nobody). It lands on the new league's League tab.
- **Copying members:** `copyMembersFrom` on `POST /leagues` names a league the creator is an admin of; its current members join the new league as members (not admins) in the create transaction, under the same caps and locks as a join (each player's league-count lock taken in one sorted order). Anyone at `MAX_LEAGUES_PER_USER`, or past a full league, is skipped and named in the response (`skipped`). Each added player gets one league event and can leave from the League tab.
- **Start season:** `POST /leagues/:id/seasons` (admin) takes `{ year, settings?, startWeek? }` (`startWeek` is merged into the settings), parses them with the type's schema and dispatches, inside a transaction holding the league row lock, to the type's `startSeason` hook. A type without one answers 409: squares, and hands-on weekly, which starts a season with its first week. A hook only writes rows and never calls the feed; the route advances the league right after commit.

## Admins (commissioners)

- Players call a league's admins **commissioners**, and everything they read says so ("Make commissioner", "Revoke commissioner", the **Commissioner** pill). Code, the API's fields and the database keep `admin` (`league_members.role = 'admin'`, `requireAdmin`, `AdminTools`, `byAdmin`); don't rename them.
- A league can have several admins, all equal. Any admin can make a member an admin, revoke another admin (or themselves), and remove members, including the creator. A league always keeps at least one admin.

## Members

- **Limits:** at most 100 active members in a league and 25 active leagues per player (`MAX_LEAGUE_MEMBERS`, `MAX_LEAGUES_PER_USER` in `packages/shared`). Creates and joins check them under a lock; rejoining a league you are already in counts against neither.
- **Leaving and removal** mark the membership (`removed_at`) instead of deleting it. The player loses access and can rejoin through an invite link. The only admin can't leave until someone else is one.
- **History:** each closed week is scored for the people who were in the league when it was played: a player removed after the week's last kickoff stays in it, and one who joined after it isn't added. Finalizing records that list in `week_participants` (everyone in the league at the last kickoff, plus anyone who picked); leaving or rejoining later never changes it, and finalizing again after a reopen only adds players. Weeks finalized before the table existed have no rows and are worked out from membership dates. Don't score past weeks from the current member list.

## Your leagues

- `GET /leagues` gives each league `todo` (games still to pick in the Picks tab's week, a survivor pick, or open boards where the player holds no square, each with when it locks; never for a player the guillotine has put out, or a survivor player who is out or watching) and `unread` (the Messages tab's rule, `unreadLeagueIds` in `messages.ts`).
- Both are worked out from the player's own data in a constant number of queries (`leagueTodos.ts`). It calls no feed and runs no automation, so a week just due shows after the next scheduled run; keep it that way.
- The app words the line with `leagueTodoLine`, lock times in the device's time zone.
