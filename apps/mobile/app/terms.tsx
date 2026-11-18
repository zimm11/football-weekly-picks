import { DELETED_PLAYER_NAME, MINIMUM_AGE } from "@picks/shared";
import { LegalPage, type LegalSection } from "../src/components/LegalPage";
import { usePageTitle } from "../src/lib/pageTitle";

/*
 * The Terms of use. Works signed out, like How to play; the App Store listing links here. It describes what the
 * app does today: when a rule, a limit or the moderation flow changes, change this text and `UPDATED` with it.
 */
const UPDATED = "November 17, 2026";

const sections: LegalSection[] = [
  [
    "What POW Pick'em is",
    [
      "Free NFL games for private leagues of friends: weekly and playoff pick'em against the spread, survivor, and squares. These terms cover the iPhone app and www.pow-pickem.com. By creating an account you agree to them.",
      "It is for fun only. There are no entry fees, no prizes and no betting in the app, and no money changes hands through it. Spreads and win predictions are shown as information about the games, not as an offer to bet. Don't use POW Pick'em for gambling that is illegal where you live.",
    ],
  ],
  [
    "Who can use it",
    [
      `You must be ${MINIMUM_AGE} or older. Sign up with an email address that is yours, keep your password to yourself, and use one account per person. You're responsible for what happens on your account.`,
    ],
  ],
  [
    "Your league and its commissioners",
    [
      "Each league is run by its commissioners: players like you, starting with whoever created the league, not the people who run POW Pick'em. A league can have several, all with the same powers, and always keeps at least one; a commissioner can make another member a commissioner. In a league set to run itself, the app does the weekly chores.",
      "Commissioners can edit spreads, point values and scores, close weeks, enter a survivor pick for a player, put a guest's name on a square, manage the invite link, remove members, and add a league's members to a new league they start. They review reports about their league's members and can remove messages and mute a member in their league. They never see your picks before the rest of the league does. We don't settle disagreements inside a league.",
      "Pick'em picks stay private until the week is final; after that, everyone in the league sees them, with the results and the standings. A survivor pick shows once its game kicks off, and a squares board is open to the whole league.",
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
      "Every new thread, reply, display name, league name and guest name is checked automatically before it is saved. What breaks these rules is refused.",
      "Anyone can report a message or a name from its ⋯ menu, and block a player so their messages no longer show. We review reports within 24 hours. League commissioners can remove messages in their league; reports about a commissioner, or about a league's name, come to us instead.",
    ],
  ],
  [
    "What happens when the rules are broken",
    [
      "Content that breaks these rules is removed. A player whose messages are removed twice in 30 days is muted for a day, and for a week after a third. The people who run POW Pick'em can turn posting off for an account, and can close an account for serious or repeated abuse.",
      "A mute or a posting suspension never affects picking: the player keeps their picks, results and standings.",
      "If you think a removal was a mistake, use Ask for a review on the removed message.",
    ],
  ],
  [
    "What you post",
    [
      "What you write stays yours. By posting it you let us store it, show it to the members of your league, and include it in the emails and notifications the league gets. Only post what you have the right to share.",
    ],
  ],
  [
    "Your account",
    [
      "Email and notifications can be turned off in Settings. The Privacy policy says what we keep and who else handles it.",
      `You can delete your account any time from Settings → Delete account. Your email, name, devices and messages are deleted at once; picks from weeks already played stay in the results as ${DELETED_PLAYER_NAME}, so other players' standings don't change.`,
    ],
  ],
  [
    "Schedules, scores and odds",
    [
      "Schedules, spreads, scores, stats, news and win predictions fill in automatically from an outside sports-data source. They can be late, missing or wrong, and league commissioners can change spreads and scores. Don't rely on them for anything beyond the game.",
      "POW Pick'em is not affiliated with or endorsed by the NFL, its teams or the company whose data it shows. Team names belong to their owners. The team badges in the app are our own drawings, not the teams' logos.",
    ],
  ],
  [
    "No guarantees",
    [
      "POW Pick'em is free and provided as it is. We work to keep it running and the results right, but we don't promise it will always be available or free of mistakes, and we may change it or shut it down.",
      "As far as the law allows, we aren't liable for losses that come from using it or from not being able to use it. Nothing here takes away rights the law gives you that can't be waived.",
    ],
  ],
  [
    "The iPhone app and Apple",
    [
      "These terms are between you and POW Pick'em, not Apple. Apple isn't responsible for the app or what is in it, has no obligation to maintain or support it, and isn't a sponsor of anything in it. Apple's standard license agreement for App Store apps applies to the iPhone app as well, and Apple may enforce these terms as they relate to it.",
    ],
  ],
  [
    "Changes to these terms",
    [
      "When these terms change, we update this page and the date at the top, and tell you in the app or by email if the change matters. Using POW Pick'em after a change means you accept the new terms. You can stop at any time by deleting your account.",
    ],
  ],
];

export default function TermsPage() {
  usePageTitle("Terms of use");
  return (
    <LegalPage
      title="Terms of use"
      updated={UPDATED}
      sections={sections}
      other={{ label: "Privacy policy", href: "/privacy" }}
    />
  );
}
