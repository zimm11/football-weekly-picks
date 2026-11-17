import { SUPPORT_EMAIL } from "@picks/shared";
import { Linking, Pressable, Text, View } from "react-native";
import { BackLink } from "../src/components/BackLink";
import { Icon } from "../src/components/Icon";
import { Body, Card, colors, fonts, Screen, Title } from "../src/components/ui";

/** The Terms of use. Works signed out, like How to play. */
const sections: [string, string[]][] = [
  [
    "What POW Pick'em is",
    [
      "A free pick'em game for private leagues of friends: you pick NFL games against the spread and compare results with your league. No money changes hands through the app.",
    ],
  ],
  [
    "League commissioners",
    [
      "Every league is run by one or more commissioners: players in the league, starting with whoever created it, not the people who run POW Pick'em. A commissioner can make another member a commissioner, and a league always keeps at least one.",
      "Commissioners set up the league's weeks and boards, can change spreads, point values and scores, close weeks, enter a survivor pick for a player and give back a square before a board locks. They manage the invite link, can remove a player from the league, and review reports about their league's members: they can remove messages and mute a member in their league. They never see your picks before the rest of the league does.",
      "Reports about a commissioner, and about a league's name, go to the people who run POW Pick'em instead.",
    ],
  ],
  [
    "The message board",
    [
      "Trash talk about teams, picks, results and standings is part of the fun. Keep it about the game.",
      "There is no tolerance for objectionable content or abusive players. Don't post or use names that harass or demean anyone, hate speech or slurs, sexual content, threats of violence, encouragement of self-harm, anyone's private personal information, or spam.",
    ],
  ],
  [
    "How posts are checked",
    [
      "Every new thread, reply, display name and league name is checked automatically before it is saved. What breaks these rules is refused.",
      "Anyone can report a message or a name from its ⋯ menu, and block a player so their messages no longer show. We review reports within 24 hours. League commissioners can remove messages in their league.",
    ],
  ],
  [
    "What happens when the rules are broken",
    [
      "Content that breaks these rules is removed. A player whose messages are removed twice in 30 days is muted for a day, and for a week after a third. The people who run POW Pick'em can turn posting off for an account.",
      "None of this ever affects picking: a muted or suspended player keeps their picks, results and standings.",
      "If you think a removal was a mistake, use Ask for a review on the removed message.",
    ],
  ],
  [
    "Your account",
    [
      "You're responsible for what you post. Picks stay private until the week is final. Email and notifications can be turned off in Settings.",
      "You can delete your account any time from Settings → Delete account. Your email, name, devices and messages are deleted at once; picks from weeks already played stay in the results as Deleted player, so other players' standings don't change.",
    ],
  ],
];

export default function TermsPage() {
  return (
    <Screen narrow>
      <BackLink />
      <Title>Terms of use</Title>
      <Card>
        {sections.map(([heading, paragraphs], index) => (
          <View
            key={heading}
            style={{
              gap: 8,
              paddingTop: index ? 16 : 0,
              borderTopWidth: index ? 1 : 0,
              borderTopColor: colors.border,
            }}
          >
            <Text
              accessibilityRole="header"
              aria-level={2}
              style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 26, color: colors.foreground }}
            >
              {heading}
            </Text>
            {paragraphs.map((text) => (
              <Body key={text} muted>
                {text}
              </Body>
            ))}
          </View>
        ))}
      </Card>
      <Card>
        <Body>Questions, or something we should know about?</Body>
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <Icon name="email" size={18} color={colors.primary} />
          <Text style={{ fontFamily: fonts.medium, fontSize: 16, color: colors.primary }}>
            {SUPPORT_EMAIL}
          </Text>
        </Pressable>
      </Card>
    </Screen>
  );
}
