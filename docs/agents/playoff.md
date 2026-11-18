# Playoff pick'em

A playoff league picks the four postseason rounds (weeks 19–22) on the same week, game and pick routes as weekly pick'em (`docs/agents/weekly.md`). This doc is what differs.

Code: rules in `packages/shared/src/playoff.ts` (`roundPoints`, `guillotineStatus`, `playoffStandings`, `wildCardPollingStarts`), routes in `apps/api/src/playoff.ts`, automation in `apps/api/src/automation/playoff.ts`, reminders in `apps/api/src/reminders/playoff.ts`, screens in `apps/mobile/src/screens/playoff/`. Seed: `supabase/seeds/playoff.sql`.

## Rounds

- A round is created once the feed lists all its games with real teams (`PLAYOFF_ROUND_GAMES`; the Wild Card round only from Week 18's Sunday, `wildCardPollingStarts`; a round already played is skipped). It opens as soon as every game has a line, finalizes once every game has a result, then the next is prepared.
- Manual rounds come from `POST /leagues/:id/playoff/rounds` (the feed-failure fallback). Auto-fill, Open and Finalize stay on `/weeks/:id/manage`.
- The app says "round" where weekly says "week" (`weekUnit` in `weekPresentation.ts`).

## Scoring

- `roundPoints` is 1/2/3/4 for weeks 19–22. The POW bonus is `PLAYOFF_POW_BONUS` (Traditional 3, Guillotine 1), passed to `scoreWeek` through `roundPowBonus`.
- The format (`seasons.settings.format`, Start season) can't change after the first Wild Card kickoff.
- **The Super Bowl round has no POW in either format** (`roundHasPow`): the pick sheet hides it, the week view says `playoff.pow: false`, a save that names one is refused, and scoring ignores one saved before.
- **Champion:** points, wins, then the Super Bowl total guess (the `tiebreaker_guesses` row on week 22; on equal distance the guess that didn't go over), shared when still level. There is no round winner (`isWinner` false) or Low Point Loser. The week view's tiebreaker game is null before the Super Bowl.
- `GET /leagues/:id/standings` is weekly pick'em's alone (404 here); playoff's is `GET /leagues/:id/playoff/standings`.

## Guillotine

- A losing POW, or none once every game of the round has locked, puts a player out from the next round. A push survives; the round's picks still score; the Super Bowl puts nobody out. A late joiner is out by having no POW.
- `PUT /weeks/:id/picks` refuses an eliminated player any change but their guess (**Save guess** in the Super Bowl).
- **Status is never stored.** A player's own (`WeekView.playoff.me`) comes from their own picks, as soon as a POW game ends. Everyone's is in the playoff standings, from final rounds only, so the privacy rule holds.

## Notifications

- Reminders skip eliminated players. On a Guillotine round's last game day, a player who has picked every game but chosen no POW gets "Choose your POW" instead, under the same day's dedupe key, so one reminder either way.
- League events are round open and round final. The recap is per round (round points, place, in or out; the champion after the Super Bowl).
