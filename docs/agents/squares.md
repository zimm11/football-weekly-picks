# Squares

A squares league holds boards (`square_boards`), each a 10 by 10 grid on one NFL game.

Code: rules as pure functions in `packages/shared/src/squares.ts`; routes in `apps/api/src/squares.ts`, every one behind `requireBoard` or `requireLeagueType("squares")`; automation in `apps/api/src/automation/squares.ts`; reminders in `apps/api/src/reminders/squares.ts`; screens in `apps/mobile/src/screens/squares/` (the Boards list in `index.tsx`, `BoardScreen.tsx` for a board and its manage screen, `NewBoard.tsx`, and `BoardFrame.tsx` around all three), with layout helpers in `apps/mobile/src/lib/squaresBoard.ts`. Seed: `supabase/seeds/squares.sql`.

## A board

- Its game is the season's Super Bowl by default once the feed lists it, any feed game (`year`, `week`, `external_id` stored), or teams and a kickoff typed by hand (league time). Rows are the away team's side, columns the home team's.
- Players claim squares up to `max_per_player` (default 10, 1–100; raised before the lock, never lowered) and release their own until the lock.
- An admin can claim under a typed guest name (outside every limit; guests can win but are never notified; the name is screened like a display name, and a suspended admin can't add one) and release any square before the lock.
- **Every claim, release, lock and score write takes the board row lock first.**
- An admin can delete a board at any time (`DELETE /boards/:id`, behind the board row lock; claims, scores and queued pushes cascade).
- `squaresHooks.memberRemoved` gives back a leaving member's squares on boards not yet locked.

## Lock, draw and winners

- The board is locked once drawn, or from kickoff even before the draw has run.
- **Lock and draw** (admin, with a confirm naming the open squares) or automation at kickoff draws two unbiased Fisher–Yates orders of 0–9 (`drawDigits`; the `random` dep is `crypto.getRandomValues` by default) inside the lock's transaction, guarded by `drawn_at is null`, so it happens once.
- Each period (q1, half, q3, final with overtime) is won by the square matching the last digits of the cumulative scores (`squareWinners`). An empty square that hits means no winner, and is shown as a hit, not a win.
- Phases (Open, Locked, Underway, Final) and winners are derived on read, never stored.
- While the game is on, `GET /boards/:id` adds the feed's live score (`ProviderGame.liveScore`) and the square that would win now. The Boards list's `BoardSummary.latestScore` comes from `square_scores` only, never the feed.

## Automation

- Moves an undrawn feed board to the feed's kickoff when the game is rescheduled (on a read, and before a draw).
- Fills `square_scores` from `ProviderGame.periodScores` once settled, never over an admin's (`by_admin`), for a day after kickoff.

## Notifications

- League events: "The numbers are drawn" by email and push; each quarter's result by push only (to spare the email budget). Both carry `boardId` and never name a square or a team.
- The reminder goes to members holding no square on a board still open, at 7pm league time the evening before kickoff, and is rechecked at send time.

## Screens

- `/boards/:id` is one board, `/boards/:id/manage` the admin's screen, and `/boards/new?league=:id` creates one and lands on it. All three sit in `BoardFrame` above the league, not in its tab navigator. The season selector is off, and a squares league has no admin tools on the League tab.
- The board is laid out as a paper one is: the home team across the top, the away team up the left side.
- **All ten columns show on a phone with no sideways scrolling**: `gridLayout` sizes the cells to the screen. The grid is one tab stop that the arrow keys move through.
- A held square shows its holder's board name (`boardNames`: first name, "Chris M" when two share it, the whole name when that still collides), or board-unique initials (`boardInitials`) when the name doesn't fit (`cellName`). Fitting uses Barlow Condensed SemiBold's own widths (`condensedWidth`); **never cut a name short**. Profile pictures stay in the Players card and the square's sheet.
- Only the player's own squares (`primary`) and winning ones (`win`) are solid, each a gradient with a glow; everyone else's fade from their avatar color (`squareTone`). A winner's sweep of light and the "Now" square's breathing ring (`Shine`, `NowRing`) animate transform and opacity only, and stay still under reduced motion.
- Claiming is optimistic and rolls back with `notifyError`.
