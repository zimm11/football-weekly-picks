import { DELETED_PLAYER_NAME, MINIMUM_AGE, SUPPORT_EMAIL } from "@picks/shared";
import { LegalPage, type LegalSection } from "../src/components/LegalPage";

/*
 * The Privacy policy. Works signed out; the App Store listing links here, and its App Privacy answers
 * (apps/mobile/README.md, "App Store privacy answers") must say the same thing. It describes what the code does
 * today, so change this text and `UPDATED` whenever that changes: a new column holding something about a player,
 * a new provider or external host, a new kind of email or notification, a retention period, or what account
 * deletion clears (`apps/api/src/accounts.ts`).
 *
 * The sports-data company is ESPN. Players' copy never names the data provider (AGENTS.md, "Copy"), so this page
 * describes it instead; the companies that hold players' data for us are named.
 */
const UPDATED = "November 17, 2026";

const sections: LegalSection[] = [
  [
    "The short version",
    [
      "POW Pick'em is a free set of NFL games for private leagues (pick'em, survivor and squares), on the iPhone app and at www.pow-pickem.com. This page says what we keep about you, why, who else handles it, and how to delete it.",
      [
        "We keep what the games need: your email, your display name, your picks and squares, and your messages.",
        "There are no ads and no analytics or tracking tools. We don't sell your information or share it for advertising.",
        "You can delete your account in Settings at any time.",
      ],
    ],
  ],
  [
    "What we collect",
    [
      [
        "Your account: your email address and a password. The password is stored only in scrambled form, which we can't read.",
        "Your profile: the display name you choose, when you agreed to the Terms of use, and your notification choices.",
        "Your play: the leagues you create or join, your role in each, when you joined or left, your picks, Pick of the Week and tiebreaker guesses, your survivor picks, and the squares you claim.",
        "The message board: the threads and replies you write, your reactions, which threads you have read, players you have blocked, reports you send (the reason and any note), and reviews you ask for.",
        "Moderation records: the automatic check's result for each message, whether a message or name of yours was reported or removed, and any mute or posting suspension.",
        "Feedback you send: your message, the screen you were on, and your browser or device type.",
        "Guest names: a league commissioner can put a square in the name of someone without an account. We keep that name with the board, and nothing else about them.",
        "Notification devices: if you turn notifications on for a device, the address its push service gives us for it, and your choices for that device.",
        "Sign-in records: when you sign in, the time, your IP address and your browser or device type are recorded with that session.",
        "Request logs: our host keeps short-lived logs of requests, which can include your IP address, browser type, the address requested and the time, for about a week.",
      ],
      "We don't ask for your location, contacts, photos, camera or microphone, and we don't collect payment details: there is nothing to buy.",
    ],
  ],
  [
    "On your device",
    [
      "The app keeps you signed in by storing your session on your device (in the iPhone's secure storage, or your browser's local storage), along with a few preferences such as a prompt you dismissed. We don't use advertising or tracking cookies.",
    ],
  ],
  [
    "How we use it",
    [
      [
        "To run the game: sign you in, show your name to your leagues, score picks and keep the standings.",
        "To send email: sign-in emails (confirming your address, password resets, email changes), and, unless you turn them off, an email when someone starts a thread in your league, a reminder when you still have a pick to make, and results and updates from your leagues.",
        "To send notifications to devices where you turned them on.",
        "To keep the message board safe: posts, display names, league names and guest names are checked automatically before they are saved, and reports are reviewed by league commissioners or by us.",
        "To fix problems, answer you, and stop abuse of the service.",
      ],
      "The automatic check can refuse a post or a name, and can remove a reported message when it clearly breaks the rules. You can edit a refused post and try again, and if a message of yours is removed you can ask for a review.",
    ],
  ],
  [
    "Who can see what",
    [
      [
        "Members of your leagues see your display name, your messages and reactions, and your results. They never see your email address.",
        "In pick'em leagues, nobody else sees your picks until the week is final, including league commissioners, who can see only whether you have picked. After that the whole league sees them.",
        "In a survivor league, your pick shows to the league once its game kicks off. A squares board is open to the whole league, so a square shows your name as soon as you claim it.",
        "A commissioner of a league you are in can add you to a new league they start. You are told, and you can leave it.",
        "When you start a thread, its title and the start of your message are emailed to the league's members who have those emails on.",
        "League commissioners review reports about their league's members, and see who sent each report and its note. Reports about commissioners and league names come to us instead.",
        "A player you block isn't told.",
        "The people who run POW Pick'em can see account email addresses, names, leagues, feedback and reports, and can look at stored data when that is needed to run the service, handle a report or fix a problem.",
      ],
    ],
  ],
  [
    "Companies that handle data for us",
    [
      "We use a few companies to run POW Pick'em. They handle your information only to provide their service to us.",
      [
        "Supabase stores the database and runs sign-in, in the United States.",
        "Cloudflare hosts the app and its network, delivers our email, and runs the automatic check on posts and names. The check receives the text being checked, with a few earlier messages from the same thread for context; Cloudflare says it doesn't keep that text after answering or use it to train AI models.",
        "Push services deliver notifications: Apple, Google, Mozilla or Microsoft for browsers, and Expo and Apple for the iPhone app. A notification carries a league name and a thread title, a reminder or a league update, never your picks or the text of a message.",
        "The sports-data company we use serves the team logos straight to your device, so it receives your IP address and browser type, as any site does when it sends you an image.",
      ],
      "Schedules, scores, stats, news and win predictions come from the same company. Our server fetches them; nothing about you is sent with those requests.",
      "We don't sell personal information and don't share it for advertising. We would disclose information only if the law required it, or to protect someone's safety.",
    ],
  ],
  [
    "How long we keep it",
    [
      [
        "Your account, picks and messages: for as long as you have an account.",
        "A removed message: its text is cleared 30 days after removal.",
        "Records of emails and notifications we sent you: 30 days.",
        "Request logs: about a week. A sign-in record: until you sign out or delete your account.",
        "Feedback and reports: for as long as they are useful for running the service.",
      ],
    ],
  ],
  [
    "Deleting your account",
    [
      "Settings → Delete account deletes your account at once, from the app or the website. If you can't sign in, use Forgot password? on the sign-in screen first; if that doesn't work, write to us.",
      [
        "Deleted: your email address and password, your display name, your devices, the text of your messages and the titles of your threads, your reactions, read markers and blocks, your picks in weeks that aren't final, your squares on boards that haven't locked, and any email waiting to be sent to you.",
        `Kept, without your name or email: your picks and results from weeks already played and your squares on locked boards, shown as ${DELETED_PLAYER_NAME} so other players' results don't change; replies other players wrote in your threads; reports and feedback you sent; and moderation records.`,
        "A league you were the only member of is deleted with you.",
      ],
      "Emails and notifications already delivered to other players can't be recalled. The same email address can sign up again later as a new account.",
    ],
  ],
  [
    "Your choices",
    [
      [
        "Turn notification emails off in Settings, or with the unsubscribe link in any of them.",
        "Turn notifications on or off for each device in Settings.",
        "Change your display name, email address or password from the account menu and Settings.",
        `Ask for a copy of what we hold about you, or for a correction, at ${SUPPORT_EMAIL}. We answer within 30 days.`,
      ],
      "Depending on where you live, the law may give you further rights over your information, such as objecting to a use of it. Write to us and we will honor them.",
    ],
  ],
  [
    "Age",
    [
      `POW Pick'em is for adults. You must be ${MINIMUM_AGE} or older to have an account, and we don't knowingly collect information from anyone younger. If you believe someone under ${MINIMUM_AGE} has an account, tell us and we will delete it.`,
    ],
  ],
  [
    "Where it is kept, and how it is protected",
    [
      "Your information is stored in the United States, and passes through Cloudflare's network on the way. If you use POW Pick'em from another country, your information is handled in the United States.",
      "Everything travels over encrypted connections, passwords are never stored in readable form, and access to the database is limited to the people who run POW Pick'em. No service can promise perfect security; if something goes wrong that affects you, we will tell you.",
    ],
  ],
  [
    "Changes to this policy",
    [
      "When this policy changes, we update this page and the date at the top, and tell you in the app or by email if the change matters.",
    ],
  ],
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated={UPDATED}
      sections={sections}
      other={{ label: "Terms of use", href: "/terms" }}
    />
  );
}
