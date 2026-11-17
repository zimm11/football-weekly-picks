import { DEFAULT_SQUARES_PER_PLAYER, MAX_SQUARES_PER_PLAYER } from "@picks/shared";
import { View } from "react-native";
import { Icon } from "../../components/Icon";
import { Body, Card, colors, fonts, Title } from "../../components/ui";

/** How to play's Squares section (`/how-to-play?section=squares`). */
export function HowToPlaySquares() {
  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Icon name="grid" size={28} color={colors.primary} />
        <Title style={{ fontSize: 30, lineHeight: 34 }}>Squares</Title>
      </View>
      <Card>
        <Body style={{ fontSize: 18, fontFamily: fonts.semibold }}>A 10 by 10 board on one game</Body>
        <Body muted>
          A squares league holds boards, each on one NFL game: the Super Bowl by default, or any game. The
          home team runs across the top and the away team down the side. Tap an open square to claim it, and
          tap yours to give it back, until the board locks. Claim a random square picks one for you. Each
          player can hold {DEFAULT_SQUARES_PER_PLAYER} squares unless the commissioner sets another limit (up
          to {MAX_SQUARES_PER_PLAYER}).
        </Body>
      </Card>
      <Card>
        <Body style={{ fontSize: 18, fontFamily: fonts.semibold }}>The draw</Body>
        <Body muted>
          The numbers read ? until the board locks: when a commissioner presses Lock and draw, or at kickoff
          if nobody has. Then each row and column gets a random number from 0 to 9, drawn once and never
          again. After the lock nobody can claim or give back a square.
        </Body>
      </Card>
      <Card>
        <Body style={{ fontSize: 18, fontFamily: fonts.semibold }}>Four winners</Body>
        <Body muted>
          At the end of Q1, at halftime, at the end of Q3 and at the final (overtime included), the winning
          square is the one whose numbers match the last digit of each team's score so far. If nobody holds
          that square, nobody wins that quarter. While the game is on, the board marks the square that would
          win if the quarter ended now. Scores fill in automatically; a commissioner can correct one, and a
          corrected score stays.
        </Body>
        <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
          Everyone in the league sees the whole board. Tap a taken square to see whose it is, its numbers and
          what it has won.
        </Body>
      </Card>
      <Card>
        <Body style={{ fontSize: 18, fontFamily: fonts.semibold }}>For commissioners</Body>
        <Body muted>
          Set up a board under New board in the League tab, then open Manage board from the board: change the
          game or raise the limit before the lock (it is never lowered), claim squares for a guest without an
          account (guest squares count against nobody's limit), give back any square, Lock and draw, correct
          scores, and delete a board. A board on a scheduled game follows the schedule: if the game is moved,
          the board locks at the new kickoff. A player who leaves before the lock gives their squares back;
          after it, they stay.
        </Body>
        <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
          Players without a square get a reminder at 7pm the evening before kickoff. Everyone hears when the
          numbers are drawn, and each quarter's result comes as a notification on their devices.
        </Body>
      </Card>
    </View>
  );
}
