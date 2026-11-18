import { MAX_SURVIVOR_LIVES } from "@picks/shared";
import { Text, View } from "react-native";
import { Icon } from "../../components/Icon";
import { Body, Card, colors, fonts, Title } from "../../components/ui";

const rules: [string, string][] = [
  [
    "One team a week, straight up",
    "Each week, pick one team to win its game outright. There are no spreads and no points. Open the Pick tab, tap a team, and press Save pick. Your pick can change until your team kicks off, and only to a team whose game hasn't kicked off either. Stats & news under a game shows each team's chance of winning.",
  ],
  [
    "Never the same team twice",
    "A team you've picked can't be picked again this season; the Pick tab shows where it went (“Used in Week 3”). The playoffs start afresh: the used teams reset at the Wild Card round. If every team still to play on a playoff slate is one you've used, you may pick any of them.",
  ],
  [
    "Strikes and lives",
    `A loss is a strike. So is a tie, and so is having no pick when the week's last game kicks off. The commissioner gives the pool 1 to ${MAX_SURVIVOR_LIVES} lives when it starts; you're out when your strikes reach them. A player who leaves the league is out from that week on. If a week would put out everyone still in, it puts out nobody and their strikes for it don't count.`,
  ],
  [
    "Who's in",
    "Everyone in the league for the start week's games, including anyone who joins in time to pick in it. A player who leaves during the start week is out (and isn't listed at all if they never picked); rejoining later doesn't bring them back. Players who join later watch this season and play the next.",
  ],
  [
    "When picks show",
    "Your pick is hidden from everyone, commissioners included, until your team's game kicks off. Then it shows on Standings, the survivor grid: players down the side, weeks across, each pick with a check if it won and struck through if it lost.",
  ],
  [
    "How it ends",
    "The last player standing after a week wins. With more than one still in after Week 18, the pool carries on through the playoffs; anyone still in after the Super Bowl shares the title.",
  ],
  [
    "For commissioners",
    "Choose the lives and the start week (any week with no kickoff yet; the next one by default) when you create the league or start a season. They're fixed once the start week's first game kicks off. Each week is imported from the schedule and opens by itself, kickoffs follow flexed games, scores fill in, and the week closes when its last game ends. In the League tab you can enter a pick for a player, correct a score at any time (everyone's status is worked out again), or remove a cancelled game; picks on it are deleted, and those players can pick again.",
  ],
];

/** How to play: the Survivor section. */
export function HowToPlaySurvivor() {
  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Icon name="heart" size={28} color={colors.primary} />
        <Title level={2} style={{ fontSize: 30, lineHeight: 34 }}>
          Survivor
        </Title>
      </View>
      <Body muted>Pick one team to win each week, never the same team twice. Last player standing wins.</Body>
      <Card>
        {rules.map(([title, detail], index) => (
          <View
            key={title}
            style={{
              gap: 4,
              paddingTop: index ? 16 : 0,
              borderTopWidth: index ? 1 : 0,
              borderTopColor: colors.border,
            }}
          >
            <Text
              accessibilityRole="header"
              aria-level={3}
              style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 26, color: colors.foreground }}
            >
              {title}
            </Text>
            <Body muted>{detail}</Body>
          </View>
        ))}
      </Card>
    </View>
  );
}
