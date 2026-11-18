// biome-ignore-all lint/correctness/noReactNativeRawText: Item renders its text inside Body, a native Text.
import { PLAYOFF_POW_BONUS, ROUND_POINTS } from "@picks/shared";
import { Text, View } from "react-native";
import { Icon, type IconName } from "../../components/Icon";
import { Body, Card, colors, fonts, Title } from "../../components/ui";

/*
 * How to play: how a weekly league is run (Automatic or Hands-on) and Playoff pick'em. Rendered from
 * app/how-to-play.tsx in one line; the "playoff" section key points at the Playoff pick'em part.
 */

function Heading({ title, icon }: { title: string; icon: IconName }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
      <Icon name={icon} size={28} color={colors.primary} />
      <Title style={{ fontSize: 30, lineHeight: 34 }}>{title}</Title>
    </View>
  );
}

function Item({ title, children }: { title: string; children: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text
        accessibilityRole="header"
        aria-level={4}
        style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 26, color: colors.foreground }}
      >
        {title}
      </Text>
      <Body muted>{children}</Body>
    </View>
  );
}

/** Weekly pick'em: how a league is run, Automatic or Hands-on. */
export function HowToPlayManagement() {
  return (
    <View style={{ gap: 20 }}>
      <Heading title="Automatic or hands-on" icon="refresh" />
      <Card>
        <Item title="Automatic (the default)">
          The league runs itself from the pro football schedule. The commissioner presses Start season on the
          League tab and picks the start week; the season then runs through Week 18. Each Tuesday at 9 AM
          Eastern the week's games and that morning's lines come in and it opens for picks, all at once, so
          the spreads you pick against are never days old (they freeze then). Final scores fill in as games
          end, and the week finalizes after its last game, usually Monday night. You get a notification when a
          week opens and when it's final.
        </Item>
        <Item title="What the commissioner can still do">
          Edit spreads and points until a week's first kickoff, choose the tiebreaker game, add or remove a
          game, and correct a score at any time: a final week is corrected in place, the standings follow, and
          the recap shows again. A game with no line on Tuesday holds the week back until the line arrives; if
          it is still missing a day before the first kickoff, the commissioners are told, and the week opens
          as soon as they type it in. A game that is rescheduled locks at its new kickoff.
        </Item>
        <Item title="Hands-on">
          Full control of each week for commissioners who want it: they import or build the slate, open it,
          and press Finalize week. A commissioner can switch between the two at any time in the League tab's
          settings; automation picks the weeks up as they stand.
        </Item>
      </Card>
    </View>
  );
}

/** Playoff pick'em: rounds, the two formats and the champion. */
export function HowToPlayPlayoff() {
  return (
    <View style={{ gap: 20 }}>
      <Heading title="Playoff pick'em" icon="trophy" />
      <Body muted>
        The weekly game over the four playoff rounds, with one champion after the Super Bowl. Pick every game
        against the spread; each game locks at kickoff.
      </Body>
      <Card>
        <Item title="Rounds and points">
          {`A win is worth ${ROUND_POINTS[19]} point in the Wild Card round, ${ROUND_POINTS[20]} in the Divisional round, ${ROUND_POINTS[21]} in the Conference round and ${ROUND_POINTS[22]} in the Super Bowl. Each round opens by itself once its games and lines are posted, and is final once every game has a result.`}
        </Item>
        <Item title="Traditional">
          {`A Pick of the Week (POW) is optional each round before the Super Bowl. A winning one adds ${PLAYOFF_POW_BONUS.traditional} points.`}
        </Item>
        <Item title="Guillotine">
          {`A POW is required every round before the Super Bowl, and a winning one adds ${PLAYOFF_POW_BONUS.guillotine} point. If your POW loses, or you have none when the round's last game kicks off, you're out of picking from the next round. A push keeps you in. Your picks that round still count, you keep your points and your place, and you can still guess the Super Bowl's total. You see your own POW result as soon as its game ends; everyone else learns who is out when the round is final. Joining after a round has locked means no POW for it, so you're out of picking. The Super Bowl has one game and no POW, so nobody goes out in it.`}
        </Item>
        <Item title="The champion">
          Most points after the Super Bowl, then most games won, then the closest guess at the Super Bowl's
          combined score (on equal distance, the guess that didn't go over). Players still level share the
          title. If nobody survives the guillotine, points decide it. There is no weekly winner or Low Point
          Loser; perfect round, lone wolf and bullseye awards stay. The commissioner picks the format when
          starting the season, and it can't change after the first Wild Card kickoff.
        </Item>
      </Card>
    </View>
  );
}
