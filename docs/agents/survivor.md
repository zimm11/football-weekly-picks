# Survivor

One pick per player per week, straight up; lose your lives and you're out.

Code: rules in `packages/shared/src/survivor.ts` (`checkSurvivorPick`, `survivorStatus`, `usedTeams`, `survivorEntrants`); routes in `apps/api/src/survivor.ts`; automation in `apps/api/src/automation/survivor.ts`; reminders in `apps/api/src/reminders/survivor.ts`; screens in `apps/mobile/src/screens/survivor/`, with helpers in `apps/mobile/src/lib/survivor.ts`.

## Settings

- Per season: lives 1–3 and the start week (any week with no kickoff yet by the calendar estimate `estimatedWeekStart` in `seasons.ts`, where the one Labor Day calculation lives (`openingThursday`); the next one by default). Both are fixed once the start week's first game kicks off.
- `startSurvivorSeason` (league create, and `survivorHooks.startSeason`) stores them and creates the start week empty. It never calls the feed, so automation imports it on the next read or cron run.

## Picks

- One pick per player per week (`survivor_picks`). No team twice in a season; the used teams reset at the Wild Card round; on a playoff slate with no unused team left to play, any team may be picked.
- A pick changes until its team's kickoff, and only to a team whose game hasn't kicked off.
- Saving (`PUT /weeks/:weekId/survivor-pick`; an admin may name `userId`, which sets `by_admin`) is one transaction holding the week row and the player's advisory lock.
- **Reveal:** another player's pick is returned by no route until its game has kicked off or has a result, not even that it exists; admins included.

## Status

- **Status is never stored.** A loss, a tie, or no pick in a final week is a strike; a player is out when strikes reach the lives.
- A week that would put out everyone still in puts out nobody, and its strikes are cancelled. One left after a final week wins; several still in after Week 22 share the title.
- **Who is in:** everyone in the league at the start week's last kickoff who joined before it, plus anyone who picked in the start week. Later joiners watch (`watching`).
- A player not in the league at a week's last kickoff is out from that week. Every final week, the start week included, records who was in the league at its last kickoff (`recordSurvivorParticipants`, the same `weekParticipants` rule as other types), and status reads that record, never today's membership: a start-week picker missing from it is listed as out ("Left the league"), one who left without picking isn't listed, and rejoining later changes nothing.
- **Don't derive who left from `joined_at`/`removed_at` once a week is recorded:** a rejoin rewrites both.

## Automation

- A week with no games is imported (a postseason week only once the feed lists the whole round, `POSTSEASON_GAME_COUNTS`) and opens at once. A week with games is never imported again, so a removed game stays removed.
- While open, kickoffs follow the feed and finals fill in, never over a typed score.
- When every game has a result (an empty slate never counts) the week finalizes, records its players, and queues one league event (`week-final:<weekId>`, or `pool-over:<seasonId>:<week>` when the pool ended); then the next week is created.
- Admin corrections, survivor-guarded: `DELETE /survivor-games/:gameId` (a cancelled game in an unfinished week; picks on it go; a week keeps one game) and `PATCH /survivor-games/:gameId` (scores at any time).
- Reminders go to alive entrants with no pick, on the 7pm rule.

## Screens

- The Pick tab's status card (`pickBanner`) describes only what is saved and, until the week is final, only what is certain (a strike with a life to spare; on the last life, out unless everyone still in goes out too).
- A player who is out or watching sees the week read-only, with a link to Standings.
- Lives are heart pips (`LivesPips`), never red: red is the POW's color alone.
