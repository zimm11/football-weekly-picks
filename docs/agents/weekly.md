# Weeks, picks and scoring

These are weekly pick'em's rules. Playoff pick'em shares the week, game and pick routes and differs where `docs/agents/playoff.md` says.

Code: the rules engine is pure functions in `packages/shared/src/rules.ts` (point values, locks, scoring, tiebreakers; change league rules there), with `awards.ts`, `stats.ts` and `seasons.ts` beside it. Routes are `apps/api/src/weeks.ts`; the week chores every type and automation share are `apps/api/src/weekOps.ts`. Screens are `apps/mobile/src/screens/weekly/`, with pure helpers in `apps/mobile/src/lib/weekPresentation.ts`, `resultsPresentation.ts` and `pickDraft.ts`.

## A week

- **Lifecycle:** `draft` (admin only: import games and spreads from the provider, then add or remove games, edit spreads and point values) → `open` (players pick; spreads are fixed unless the admin edits them; admins see the results so far, below) → `final` (scored; everyone's picks revealed). A closed week can be reopened to correct it. Only an admin finalizes a week in a Hands-on league.
- A kickoff typed in by hand is in the league's time zone. A game whose kickoff moves, by re-import or edit, takes the new slot's default points unless the admin had set them by hand.
- The database stores only draft/open/final. **Display phases** are derived from kickoffs and scores: Draft → Accepting picks → Games underway → Awaiting finalization → Final.
- **Results arrive three ways:** automatically (next), the admin's "Auto-fill results" (which replaces typed scores), or typed in by hand.
- **Live results:** `GET /weeks/:id` on an open week fills in the provider's final scores for games that came from it, have been under way at least 2.5 hours, and have no result. It never overwrites a score already entered and never touches spreads. The provider is asked at most once a minute per season week (`RESULTS_REFRESH_MS`), shared across leagues, and a failure is remembered for the same minute. It runs on read, not on a timer, so nothing runs while nobody is looking. The pick sheet shows the player's own running tally (`scoreSoFar` in `rules.ts`); that is the player's own data only, so the privacy rule holds.
- **The tiebreaker game** is the admin's explicit choice if they made one, otherwise the last Monday game (else the last game), worked out from the slate on every read.
- The league's time zone (a canonical IANA Area/City name, or UTC) only decides how game days and times are shown.

## Picks

- **Private until final:** no endpoint returns another player's picks, points or standings contribution for a week that isn't `final`, except the results so far to the league's admins.
- **Results so far:** on an `open` week (a reopened one too), `GET /weeks/:id` gives an admin `WeekView.resultsSoFar`: each player's pick on a game that has locked (kicked off or has a result, `isLocked`), a POW only once its game has locked, a guess only once the tiebreaker game has, and the points and ranks as they stand from those picks, with nobody the winner. Before a game locks, an admin sees only `submissions` (pick count, whether there is a POW). It is null for members, drafts and final weeks. The app shows it at `/weeks/:id/progress`, reached from the Results tab and from Manage week's "Who has picked".
- **Why `resultsSoFar` isn't `results`:** installed apps and open tabs read `results` as final without checking the week's status (the manage screen's "Post a league message?" preview after Open, for one). Keep `results` null until the week is final.
- `resultsSoFar.lockedGameIds` names the games it covers, as the server judged them. The app tells a held-back pick from no pick by that list, never by the device's clock: a clock that runs ahead, or a remembered copy of the week, would otherwise show "no pick" for a pick the server withheld.
- **By subtraction** `submissions` says a little more than it used to: `pickCount` less a player's shown picks is how many of their picks are on games still to lock, and `hasPow` with no POW shown means the POW is on one of them. Never the side.
- **A reveal is not one-way.** The rule is judged on every read, and a locked game can unlock: a score cleared before kickoff, a kickoff moved later (by the admin, or by automation following a delayed game, `followKickoffs`), or the tiebreaker pointed at another game. Picks an admin has seen can then change again. There is no guard; an admin could already read a whole week by finalizing and reopening it.
- Season standings, the recap, awards, league events and notifications still count only final weeks; nothing is announced or pushed from the results so far.
- An admin's read of an open week loads every player's guess, so `myTiebreakerTotal` must still pick the caller's own.
- **Points:** Thursday and Monday 3; Sunday night, Tuesday, Wednesday, Friday, Saturday 2; other Sunday games 1; Thanksgiving and Christmas Day 4. A winning POW adds 5. A push scores nothing and is neither a win nor a loss. Spreads are stored as the home team's line.
- **Locks:** each game locks at its kickoff. Until then its pick can be added or changed, and the POW can be put on it, moved off it, or removed. Once the game holding a player's POW has kicked off, the POW can't be moved or removed. A game with a result entered is locked whatever the clock says. The tiebreaker guess can be changed until the tiebreaker game locks. There is no automatic POW: a player who doesn't choose one has none that week.
- **Pick submissions** run in one transaction that locks the week row and takes a per-player advisory lock, so the lock rules can't be raced. Keep reads, validation and writes inside it.

## Ranking

- **Weekly winner:** most points, then most games won, then closest guess at the tiebreaker game's total (on equal distance, the guess that didn't go over).
- **Season standings:** total points, then POWs won, wins, Monday night wins, Sunday night wins. `GET /leagues/:id/standings` is weekly pick'em's alone.
- **Awards** (`awards.ts`, from a final week's results): the Low Point Loser (LPL) is last place by the weekly ranking (shared if still level; nobody when the whole league is level). The others are perfect week, bullseye (exact tiebreaker total) and lone wolf (alone on the covering side of a game at least three players picked).
- A closed week is scored for who was in the league when it was played; see "History" in `docs/agents/leagues.md`.

## The pick sheet

- `/leagues/:id` (Picks) shows the current open week: prioritize missing picks that can still be submitted, then editable picks, then any available games, else the latest open week. Keep the displayed sheet stable during background refreshes.
- A game the player can no longer change is one compact row (`lockedGameRow`) that opens in place to its read-only card. Games already locked when the sheet opens fold behind one control while a game can still be picked, so the games to pick start on the first screen.
- The status card describes only what is saved; an unsaved change is said once, in the save bar. **Save picks** is offered only once something has changed, and the bar goes away when no game and no guess can change any more (`sheetEditable`). An unsaved change on a game that locks (or was removed) is undone before saving, and the save bar says which change didn't make it. Saving stays on the sheet.
- Between weeks the tab shows the latest final week and the player's place in the season (`standingLine`). An admin of a weekly league with nothing open sees a card for a draft they have something to do with (any draft in a Hands-on league; a draft with games in an Automatic one), from `draftCards` and `noWeekOpen`.
- **Keep picking and managing on separate screens.** `/weeks/:id/manage` is admin-only (games, spreads, results, open/close); on an open week its "Who has picked" card links to the results so far. After opening or finalizing a week in a Hands-on league it offers to post a message-board thread announcing it; a league that runs itself announces with league events instead.

## Seasons and setting up a week

- New seasons are staged explicitly and created with their first week. Future drafts do not displace the default published season.
- The admin chooses from weeks 1–18 with existing states shown; weeks not created that the calendar says are over read "Already played" (`weekPlayedByCalendar`). In the current season before any week exists, the suggestion is the coming week by the calendar (`suggestedWeekNumber` in `seasons.ts`). An existing week opens its management instead of creating a duplicate.

## Results recap

- The first time a player opens a league after a week is finalized, a bottom sheet shows how they finished and the awards, once (the type's `Recap` in `LEAGUE_TYPE_SCREENS`; weekly's and playoff's share their pieces in `WeeklyTabs.tsx`).
- `weeks.finalized_at` is set on finalize and cleared on reopen; `week_recap_views` records who has seen it, and a view older than `finalized_at` doesn't count, so a corrected week is recapped again. The league endpoint's `recapWeekId` names the latest such week closed since the player joined. The admin who finalizes is marked as having seen it.
- Weeks closed before the feature have no `finalized_at` and never get one.

## Matchup sheet

- Each pick card's "Stats & news" row opens `MatchupSheet` for that game, loaded on demand from `GET /api/games/:gameId/insights`.
- Everything in it is public background from ESPN (team form, injuries, leaders, news, the Matchup Predictor's chance of each team winning), never this league's picks, so it doesn't touch the privacy rule.
- ESPN can fail or change without notice: each summary section is parsed on its own and a changed one drops out, and a failed lookup returns `matchup: null`.
- No sportsbook or prediction-market prices, branding or betting links.
