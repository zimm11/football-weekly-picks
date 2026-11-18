// biome-ignore-all lint/correctness/noReactNativeRawText: the Guide parts (GuideTitle, GuideNote, GuideItem) render their children inside native Text.
import { DEFAULT_SQUARES_PER_PLAYER, MAX_SQUARES_PER_PLAYER } from "@picks/shared";
import { View } from "react-native";
import { GuideHeading, GuideNote, GuideTitle } from "../../components/Guide";
import { space } from "../../components/theme";
import { Body, Card } from "../../components/ui";

/** How to play's Squares section (`/how-to-play?section=squares`). */
export function HowToPlaySquares() {
  return (
    <View style={{ gap: space.xl }}>
      <GuideHeading title="Squares" icon="grid" />
      <Card>
        <GuideTitle>A 10 by 10 board on one game</GuideTitle>
        <Body muted>
          A squares league holds boards, each on one pro football game: the Super Bowl by default, or any
          game. The Boards tab lists them; tap one to open it. The home team runs across the top and the away
          team down the side. Tap an open square to claim it, and tap yours to give it back, until the board
          locks. Claim a random square picks one for you. Each player can hold {DEFAULT_SQUARES_PER_PLAYER}{" "}
          squares unless the commissioner sets another limit (up to {MAX_SQUARES_PER_PLAYER}).
        </Body>
      </Card>
      <Card>
        <GuideTitle>The draw</GuideTitle>
        <Body muted>
          The numbers read ? until the board locks: when a commissioner presses Lock and draw, or at kickoff
          if nobody has. Then each row and column gets a random number from 0 to 9, drawn once and never
          again. After the lock nobody can claim or give back a square.
        </Body>
      </Card>
      <Card>
        <GuideTitle>Four winners</GuideTitle>
        <Body muted>
          At the end of Q1, at halftime, at the end of Q3 and at the final (overtime included), the winning
          square is the one whose numbers match the last digit of each team's score so far. If nobody holds
          that square, nobody wins that quarter. While the game is on, the board marks the square that would
          win if the quarter ended now. Scores fill in automatically; a commissioner can correct one, and a
          corrected score stays.
        </Body>
        <GuideNote>
          Everyone in the league sees the whole board. Tap a taken square to see whose it is, its numbers and
          what it has won. Tap a name under Players to find their squares.
        </GuideNote>
      </Card>
      <Card>
        <GuideTitle>For commissioners</GuideTitle>
        <Body muted>
          Set up a board with New board on the Boards tab, then open Manage board from the board: change the
          game or raise the limit before the lock (it is never lowered), claim squares for a guest without an
          account (guest squares count against nobody's limit), give back any square, Lock and draw, correct
          scores, and delete a board. A board on a scheduled game follows the schedule: if the game is moved,
          the board locks at the new kickoff. A player who leaves before the lock gives their squares back;
          after it, they stay.
        </Body>
        <GuideNote>
          Players without a square get a reminder at 7pm the evening before kickoff. Everyone hears when the
          numbers are drawn, and each quarter's result comes as a notification on their devices.
        </GuideNote>
      </Card>
    </View>
  );
}
