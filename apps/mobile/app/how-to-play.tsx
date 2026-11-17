import {
  LEAGUE_TYPE_INFO,
  LEAGUE_TYPES,
  type LeagueType,
  MAX_LEAGUE_MEMBERS,
  MAX_LEAGUES_PER_USER,
} from "@picks/shared";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { BackLink } from "../src/components/BackLink";
import { Icon, type IconName } from "../src/components/Icon";
import { Body, Button, Card, colors, fonts, styles, Title } from "../src/components/ui";
import { useAuth } from "../src/lib/auth";
import { openScreen } from "../src/lib/navigation";
import { HowToPlayManagement, HowToPlayPlayoff } from "../src/screens/playoff/HowToPlayPlayoff";
import { HowToPlaySquares } from "../src/screens/squares/HowToPlaySquares";
import { HowToPlaySurvivor } from "../src/screens/survivor/HowToPlaySurvivor";

/** Weekly pick'em, for players. */
const playerSteps = [
  [
    "Open Picks and choose your sides",
    "Select your league, then the Picks tab. The current open week's sheet appears there. Tap a team in each matchup to pick it against the displayed spread. Stats & news under a game opens team form, injuries, news, and each team's chance of winning. If there is no open week, the next one opens on Tuesday morning in a league that runs itself, or when your admin opens it.",
  ],
  [
    "Choose your POW and tiebreaker",
    "Tap POW beside one of your selected teams. Enter your guess for the combined total points in the labeled tiebreaker game, usually Monday night.",
  ],
  [
    "Press Save picks",
    "Tapping a team does not save it. Press Save picks and look for “Picks saved.” You can save a partial sheet and return for the rest. Change and save a pick any time before its game kicks off.",
  ],
  [
    "Check results and the season race",
    "As each game ends, its result shows on your pick sheet: Won with the points you earned, Lost, or Push. Your week so far adds up your points, record, and POW; it's unofficial until the week is final. Once it is, a recap shows how you finished the next time you open the league. Open Results to see everyone's picks, the weekly winner, and the awards. Open Standings to track season points, POW wins, and your progress week by week.",
  ],
];
/** Weekly pick'em, for admins of a Hands-on league (an Automatic league does all of this by itself). */
const adminSteps = [
  [
    "Set up a draft week",
    "Choose the Season above the league tabs. To begin another year, select Start a new season and enter its starting year. In the League tab, select a week (1–18) and press Create week; existing weeks open with Manage week instead. The season choice carries across Picks, Results, Standings, and League. Leave Auto-fill games and spreads checked to load the slate, or add games by hand. You land on Manage week; drafts are visible only to admins.",
  ],
  [
    "Review the slate, then open picks",
    "Check kickoffs, spreads, and point values. Kickoffs you type are in the league's time zone, and a game moved to a new slot takes that slot's points unless you set them yourself. Add or remove games, choose the tiebreaker game if needed, and press Save changes after edits. When the slate is ready, press Open week for picks. Players can now find it on their Picks tab, and you're offered a league message to announce it.",
  ],
  [
    "Make your picks and check submissions",
    "Use Make your own picks to fill out the same sheet as everyone else. Return to Manage week to see who has picked and whether they chose a POW. Other players' picks remain private.",
  ],
  [
    "Record scores and finalize the week",
    "Results for auto-filled games fill in on their own as each game ends, whenever someone has the week open. To fetch them right away, press Auto-fill results in Manage week; it replaces any score typed in by hand. Or enter scores and press Save changes; a score you type is never overwritten automatically. Score boxes appear once a game kicks off; press Enter score to record one sooner. When every game has a final score, press Finalize week and confirm. This reveals everyone's picks, names the winner and any Low Point Loser, and updates season standings. You can write a league message with the final results shown for reference. Auto-filling results and finalizing never change spreads: the opening lines stay in place unless an admin edits them manually.",
  ],
  [
    "Correct results when needed",
    "Use Reopen week in Manage week, correct the score or spread, and save. Spreads aren't auto-filled again once a week is open; correct one by typing the new line. Close the week again to publish the corrected results. While reopened, other players' picks are hidden and the week is excluded from standings.",
  ],
];
/** What every league shares, whatever its game. */
const everyLeagueSteps = [
  [
    "Get into a league",
    `Create an account or sign in, then choose your display name. Open the invite link your admin sends and press Join league. You can belong to up to ${MAX_LEAGUES_PER_USER} leagues, each playing one game. Your leagues are always one tap away from the POW Pick'em logo.`,
  ],
  [
    "Start a league of your own",
    `From Your leagues, choose the game (Weekly pick'em, Playoff pick'em, Squares, or Survivor; it can't change later), enter a League name, and press Create league. Start with members from adds the players of a league you already run, so the same crew needs no new link. In the League tab, check the time zone and copy the invite link to share. A league can hold up to ${MAX_LEAGUE_MEMBERS} players, and keeps them from season to season.`,
  ],
  [
    "Share the admin work",
    "In the League tab, tap ⋯ beside a member and choose Make admin to give them the same access you have; Revoke admin takes it back and keeps them in the league as a player. Remove from league takes a member out while keeping their results from weeks already played. Make a new link replaces the invite link, so the old one stops working. A league always keeps at least one admin: if you're the only one, make someone else an admin before leaving or stepping down.",
  ],
  [
    "Handle reports",
    "Reports about your league's members appear on the League tab under Reports, with the reported message or name. Remove takes a message down for everyone (it shows as Message removed) or resets a name; Dismiss leaves it up. The ⋯ menu removes and mutes the author in this league for 24 hours or 7 days. You can also remove a single message from its ⋯ menu in the thread, or mute a member from theirs in the League tab. A message two players report, or one reported as a threat, is hidden until someone reviews it. Reports about admins, and about the league's name, go to the people who run POW Pick'em instead.",
  ],
  [
    "Talk it over in Messages",
    "The Messages tab is your league's message board. Start a thread or reply to one; a dot on the tab marks threads with posts you haven't read. Tap the smiley below any message or reply and choose an emoji; the reactions a message has appear beside it with a count of the players who chose each, and yours are highlighted. Tap one to add yours, or tap yours again to remove it. Reactions don't mark threads unread. Admins can permanently delete a thread and all its replies and reactions from its ⋯ menu after confirming. Admins can pin a thread as an announcement to keep it at the top of the board. The board shows the newest 30 threads; Load older threads brings in more. You can start five threads a day in a league (two on your first day), and reply up to ten times a minute. Use Quote reply below a message to include it with your reply; Remove quote keeps your draft text. Posted quotes name the original author and link back to their message.",
  ],
  [
    "Keep the board friendly",
    "Trash talk about teams, picks and standings is welcome; harassment, hate, sexual content, threats and spam aren't (see the Terms of use, which you agree to before your first post). Posts and names are checked automatically: anything that clearly breaks the rules is refused, so edit it and try again. To report a message, tap ⋯ beside it and choose Report; to report a player's name, use ⋯ beside them in the League tab. Reports are reviewed within 24 hours. Block a player from the same menus to hide their threads, replies and reactions from you everywhere; they aren't told, and picks and standings don't change. Unblock them in Settings. A player whose messages are removed twice in 30 days is muted for a day, a week after a third. Muted players can still pick. If one of your messages is removed by mistake, tap ⋯ and choose Ask for a review.",
  ],
  [
    "Get reminders",
    Platform.OS === "web"
      ? "At 7pm in your league's time zone the evening before game day, you get a reminder if you still have a pick to make that day, plus a note when someone starts a thread, and results and updates from leagues that run themselves or that you are added to. Email is on by default. To get them as notifications on this device too, or to turn any kind off, open Settings from the account menu. On iPhone and iPad, add POW Pick'em to your home screen first (iOS 16.4 or later)."
      : "At 7pm in your league's time zone the evening before game day, you get a reminder if you still have a pick to make that day, plus a note when someone starts a thread, and results and updates from leagues that run themselves or that you are added to. Email is on by default. To get them as notifications on this device too, or to turn any kind off, open Settings from the account menu.",
  ],
  [
    "Manage your account",
    "Tap your name in the header to change your name or password, open Settings, or sign out. Forgot your password? Use Forgot password? on the sign-in form to get a reset link by email. To leave a league, open its League tab and press Leave league; your results from weeks already played stay in the standings, and rejoining later doesn't change them. To delete your account, open Settings and choose Delete account: your email, name, devices and messages are deleted at once, and your results from weeks already played stay as Deleted player. If you're a league's only admin, make someone else an admin first.",
  ],
];
function Steps({ items }: { items: string[][] }) {
  return (
    <Card>
      {items.map(([title, detail], index) => (
        <View
          key={title}
          style={{
            flexDirection: "row",
            gap: 16,
            paddingTop: index ? 20 : 0,
            paddingBottom: index === items.length - 1 ? 0 : 4,
            borderTopWidth: index ? 1 : 0,
            borderTopColor: colors.border,
          }}
        >
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.primaryTint,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontFamily: fonts.displayBold, fontSize: 20, color: colors.primary }}>
              {index + 1}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text
              accessibilityRole="header"
              aria-level={4}
              style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 26, color: colors.foreground }}
            >
              {title}
            </Text>
            <Body muted>{detail}</Body>
          </View>
        </View>
      ))}
    </Card>
  );
}
function SectionHeading({ title, icon }: { title: string; icon: IconName }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
      <Icon name={icon} size={28} color={colors.primary} />
      <Title style={{ fontSize: 30, lineHeight: 34 }}>{title}</Title>
    </View>
  );
}
/** The tabs: one per league type, named and iconed from the registry. */
const TABS: { type: LeagueType; label: string }[] = [
  { type: "weekly", label: "Weekly" },
  { type: "playoff", label: "Playoffs" },
  { type: "squares", label: "Squares" },
  { type: "survivor", label: "Survivor" },
];
const isLeagueType = (value: unknown): value is LeagueType =>
  typeof value === "string" && (LEAGUE_TYPES as readonly string[]).includes(value);

function TypeTabs({ value, onChange }: { value: LeagueType; onChange: (type: LeagueType) => void }) {
  return (
    <View
      accessibilityRole="tablist"
      aria-label="Games"
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}
    >
      {TABS.map(({ type, label }) => {
        const selected = type === value;
        return (
          <Pressable
            key={type}
            accessibilityRole="tab"
            accessibilityLabel={LEAGUE_TYPE_INFO[type].name}
            accessibilityState={{ selected }}
            aria-selected={selected}
            onPress={() => onChange(type)}
            style={({ pressed }) => ({
              flexGrow: 1,
              flexBasis: 120,
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingHorizontal: 16,
              borderRadius: 999,
              backgroundColor: selected ? colors.primary : pressed ? colors.card : colors.raised,
            })}
          >
            <Icon
              name={LEAGUE_TYPE_INFO[type].icon}
              size={18}
              color={selected ? colors.primaryForeground : colors.mutedForeground}
            />
            <Text
              style={{
                fontFamily: fonts.semibold,
                fontSize: 15,
                color: selected ? colors.primaryForeground : colors.foreground,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function HowToPlay() {
  const auth = useAuth();
  const router = useRouter();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [positions, setPositions] = useState<Record<string, number>>({});
  // `?section=<league type>` (the "How … works" links on New league and the home page) opens that type's tab.
  const { section } = useLocalSearchParams<{ section?: string }>();
  const [tab, setTab] = useState<LeagueType>(isLeagueType(section) ? section : "weekly");
  useEffect(() => {
    if (isLeagueType(section)) setTab(section);
  }, [section]);
  const choose = (type: LeagueType) => {
    setTab(type);
    // Keep the URL in step, so a shared link or the back button returns to the same tab.
    router.setParams({ section: type });
  };
  const jump = (id: string) => scroll.current?.scrollTo({ y: positions[id] ?? 0, animated: true });
  return (
    <ScrollView
      ref={scroll}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { gap: 32, paddingTop: 32 }]}
    >
      <View style={{ gap: 16 }}>
        <BackLink fallbackLabel={auth.session ? "Your leagues" : "Home"} />
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>
          The league playbook
        </Text>
        <Title style={{ fontSize: 48, lineHeight: 48 }}>How to play</Title>
        <Body muted style={{ fontSize: 18, lineHeight: 28 }}>
          POW Pick'em runs NFL leagues for your crew. Weekly pick'em is the main game: pick every game against
          the spread, choose a Pick of the Week (POW), and chase weekly wins and the season lead. A league can
          play Playoff pick'em, Squares, or Survivor instead.
        </Body>
        <Button
          link
          title={auth.session ? "Go to your leagues" : "Sign in or create an account"}
          style={{ alignSelf: "flex-start" }}
          icon="chevron-right"
          onPress={() => void openScreen("/")}
        />
      </View>
      <TypeTabs value={tab} onChange={choose} />
      {tab === "weekly" ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {[
              ["rules", "The pick rules"],
              ["running", "Automatic or hands-on"],
              ["players", "For players"],
              ["admins", "For admins"],
            ].map(([id = "", title = ""]) => (
              <Button
                link
                key={id}
                title={title}
                variant="secondary"
                style={{ flexGrow: 1 }}
                small
                onPress={() => jump(id)}
              />
            ))}
          </View>
          <View
            onLayout={(event) => setPositions((old) => ({ ...old, rules: event.nativeEvent.layout.y }))}
            style={{ gap: 20 }}
          >
            <SectionHeading title="The pick rules" icon="trophy" />
            <Card>
              <Body style={{ fontSize: 18, fontFamily: fonts.semibold }}>Play the spread</Body>
              <Body muted>
                Pick the team you think will cover the displayed spread, rather than simply win the game. A
                minus line means the team is favored; a plus line gives the underdog a head start.
              </Body>
              <View style={{ backgroundColor: colors.primaryTint, borderRadius: 12, padding: 16, gap: 4 }}>
                <Body style={{ fontFamily: fonts.semibold }}>Example: Buffalo −3.5 vs. Miami +3.5</Body>
                <Body muted>
                  Buffalo covers by winning by 4 or more. Miami covers by winning outright or losing by 3 or
                  fewer. Equal adjusted scores on a whole-number spread are a push.
                </Body>
              </View>
              <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
                A winning pick earns the game’s points. Losing or missing picks earn zero. A push earns zero
                and is neither a win nor a loss. Use the spread shown in the app; it stays fixed unless an
                admin edits it.
              </Body>
            </Card>
            <Card>
              <Body style={{ fontSize: 18, fontFamily: fonts.semibold }}>What each game is worth</Body>
              {[
                ["Sunday daytime", "1 point"],
                ["Sunday night · 7pm ET or later", "2 points"],
                ["Thursday & Monday", "3 points"],
                ["Tuesday, Wednesday, Friday & Saturday", "2 points"],
                ["Thanksgiving & Christmas Day", "4 points"],
              ].map(([slot, points]) => (
                <View
                  key={slot}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    gap: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                    paddingBottom: 12,
                  }}
                >
                  <Body muted style={{ fontSize: 14, flex: 1 }}>
                    {slot}
                  </Body>
                  <Body style={{ fontSize: 14, fontFamily: fonts.semibold }}>{points}</Body>
                </View>
              ))}
              <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
                Default game slots use Eastern time. Holiday values take priority. Admins can change game
                values, so always check the points on your sheet.
              </Body>
            </Card>
            <Card>
              <Body style={{ fontSize: 18, fontFamily: fonts.semibold }}>One POW. Bigger stakes.</Body>
              <Body muted>
                Mark one pick as your Pick of the Week. If it covers, earn the game’s points plus{" "}
                <Text style={{ color: colors.pow, fontFamily: fonts.semibold }}>5 bonus points</Text>. A
                losing or pushed POW earns no bonus.
              </Body>
              <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
                There is no automatic POW. Move it between unlocked games as often as you like. Once its game
                kicks off, it stays there for the week.
              </Body>
            </Card>
            <Card>
              <Body style={{ fontSize: 18, fontFamily: fonts.semibold }}>Know the deadlines</Body>
              <Body muted>Every game locks at its own kickoff, or as soon as a result is entered.</Body>
              {[
                ["Before kickoff", "Save or change your pick and move your POW as often as you like."],
                [
                  "At kickoff",
                  "No new picks or changes on that game. Unsaved changes that lock are undone; the save bar tells you which.",
                ],
                ["Once your POW’s game kicks off", "Your POW cannot be moved or removed."],
              ].map(([title, detail]) => (
                <View
                  key={title}
                  style={{ padding: 12, borderRadius: 12, backgroundColor: colors.raised, gap: 4 }}
                >
                  <Body style={{ fontFamily: fonts.semibold }}>{title}</Body>
                  <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
                    {detail}
                  </Body>
                </View>
              ))}
              <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
                Enter or change your tiebreaker guess until its game locks. A saved guess cannot be removed.
              </Body>
            </Card>
            <Card>
              <Body style={{ fontSize: 18, fontFamily: fonts.semibold }}>How winners are decided</Body>
              <Body style={{ fontFamily: fonts.semibold }}>Weekly winner</Body>
              <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
                Most points, then games won, then closest to the tiebreaker game’s combined score. Equal
                distances favor the guess that did not go over. Remaining ties share the win. The same order
                from the bottom names the Low Point Loser; nobody is LPL if the entire league is tied.
              </Body>
              <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
                A perfect week wins every game. A bullseye is an exact tiebreaker guess. A lone wolf is alone
                on the covering side of a game at least three players picked. The tiebreaker is the admin’s
                chosen game, otherwise the last Monday game, or last game if there is no Monday game.
              </Body>
              <Body style={{ fontFamily: fonts.semibold }}>Season standings</Body>
              <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
                Points from closed weeks, then POWs won, wins, Monday wins, and Sunday night wins. Remaining
                ties share a rank. Picks stay private until the week is final; admins can see submission
                status, never other players’ choices.
              </Body>
            </Card>
          </View>
          <View
            onLayout={(event) => setPositions((old) => ({ ...old, running: event.nativeEvent.layout.y }))}
          >
            <HowToPlayManagement />
          </View>
          <View
            onLayout={(event) => setPositions((old) => ({ ...old, players: event.nativeEvent.layout.y }))}
            style={{ gap: 20 }}
          >
            <SectionHeading title="For players" icon="users" />
            <Steps items={playerSteps} />
          </View>
          <View
            onLayout={(event) => setPositions((old) => ({ ...old, admins: event.nativeEvent.layout.y }))}
            style={{ gap: 20 }}
          >
            <SectionHeading title="For admins" icon="list" />
            <Body muted>
              An Automatic league needs only Start season on the League tab; see Automatic or hands-on above.
              In a Hands-on league the admins run each week: Draft → Accepting picks → Games underway →
              Awaiting finalization → Final. Finalizing is their action, so results stay private until then.
            </Body>
            <Steps items={adminSteps} />
          </View>
        </>
      ) : tab === "playoff" ? (
        <HowToPlayPlayoff />
      ) : tab === "squares" ? (
        <HowToPlaySquares />
      ) : (
        <HowToPlaySurvivor />
      )}
      <View style={{ gap: 20 }}>
        <SectionHeading title="In every league" icon="users" />
        <Body muted>
          Whatever the game, a league shares the same accounts, invites, admins, message board and
          notifications.
        </Body>
        <Steps items={everyLeagueSteps} />
      </View>
      <View style={{ gap: 16, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 24 }}>
        <Body muted>Ready for the next slate?</Body>
        <Button
          link
          title={auth.session ? "Go to your leagues" : "Get started"}
          icon="chevron-right"
          onPress={() => void openScreen("/")}
        />
      </View>
    </ScrollView>
  );
}
