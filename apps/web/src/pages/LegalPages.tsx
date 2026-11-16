import type { ReactNode } from "react";
import { Card } from "../components/ui/card";
import { Link } from "../router";

/** Where people send privacy and account requests. Forwarded by Cloudflare Email Routing. */
export const SUPPORT_EMAIL = "support@pow-pickem.com";
/** Change both dates whenever a policy's substance changes. */
const PRIVACY_UPDATED = "November 15, 2026";
const TERMS_UPDATED = "November 15, 2026";

const support = (
  <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium">
    {SUPPORT_EMAIL}
  </a>
);

function LegalDocument({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto grid max-w-2xl gap-6 py-3">
      <header className="grid gap-2">
        <h2 className="text-5xl leading-none font-extrabold">{title}</h2>
        <p className="m-0 text-sm text-muted-foreground">Last updated {updated}</p>
      </header>
      <Card className="grid gap-6 leading-relaxed text-muted-foreground [&_h3]:text-2xl [&_h3]:text-foreground [&_li]:my-1 [&_p]:m-0 [&_section]:grid [&_section]:gap-3 [&_strong]:text-foreground [&_ul]:m-0 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </Card>
      <LegalLinks />
    </article>
  );
}

/** Links to the privacy policy and terms, for the foot of public and account screens. */
export function LegalLinks() {
  const linkClass =
    "flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground no-underline hover:bg-raised hover:text-foreground";
  return (
    <nav aria-label="Legal" className="-mx-3 flex flex-wrap items-center">
      <Link to="/privacy" className={linkClass}>
        Privacy policy
      </Link>
      <Link to="/terms" className={linkClass}>
        Terms of service
      </Link>
      <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
        Contact
      </a>
    </nav>
  );
}

export function PrivacyPage() {
  return (
    <LegalDocument title="Privacy policy" updated={PRIVACY_UPDATED}>
      <p>
        POW Pick'em (<strong>www.pow-pickem.com</strong>) is a free NFL pick'em game for private leagues. This
        policy explains what we collect, why, who can see it, and the choices you have. Questions or requests:{" "}
        {support}.
      </p>

      <section>
        <h3>What we collect</h3>
        <ul>
          <li>
            <strong>Your account.</strong> Your email address and, if you use one, your password, which is
            stored only in scrambled (hashed) form; we can't read it. If you sign in with Google, Google
            shares your name, email address and profile picture link with us. We use your Google name only to
            suggest a leaderboard name.
          </li>
          <li>
            <strong>What you enter in the app.</strong> Your leaderboard name, the leagues you create or join,
            your picks, Pick of the Week and tiebreaker guesses, messages and reactions you post, and feedback
            you send. Feedback also records the screen you sent it from and your browser and device type, to
            help us fix bugs.
          </li>
          <li>
            <strong>Email settings and delivery.</strong> Which emails you want, and a record of the emails we
            send you.
          </li>
          <li>
            <strong>Technical information.</strong> Like most websites, the services that host the app keep
            logs of requests, which include your IP address and browser type, for security and
            troubleshooting.
          </li>
          <li>
            <strong>Storage in your browser.</strong> The app stores your sign-in session and a few
            preferences (the season you're viewing, whether we've suggested adding the app to your home
            screen) in your browser. We use no advertising or analytics cookies and no tracking pixels.
          </li>
        </ul>
      </section>

      <section>
        <h3>How we use it</h3>
        <ul>
          <li>
            To run the game: score picks, build standings, show league messages, and keep you signed in.
          </li>
          <li>
            To send account emails you ask for (password resets, email-change confirmations and notices) and,
            unless you turn them off, notification emails: a new message thread in your league, and a reminder
            the evening before a game day when you still have games to pick. Turn these off under Account
            settings or with the unsubscribe link in any of them.
          </li>
          <li>To answer feedback and requests, fix problems, and keep the app secure.</li>
        </ul>
        <p>We don't sell your information, show ads, or use it for advertising.</p>
      </section>

      <section>
        <h3>Who can see what</h3>
        <ul>
          <li>
            <strong>Members of your leagues</strong> see your leaderboard name, the messages and reactions you
            post, and your standings. They see your picks, Pick of the Week and tiebreaker guess for a week
            only once the league admin has finalized it.
          </li>
          <li>
            <strong>No other player sees your email address.</strong>
          </li>
          <li>
            <strong>The people who run POW Pick'em</strong> can see account and league data when needed to
            operate the app, answer feedback, or fix a problem.
          </li>
        </ul>
      </section>

      <section>
        <h3>Services we rely on</h3>
        <p>We share information with these providers only so they can run parts of the app for us:</p>
        <ul>
          <li>
            <strong>Supabase</strong> stores the app's database and handles sign-in.
          </li>
          <li>
            <strong>Cloudflare</strong> hosts the app and delivers our emails.
          </li>
          <li>
            <strong>Google</strong>, if you choose to sign in with Google.
          </li>
          <li>
            <strong>ESPN.</strong> Team logos load from ESPN's image servers, so your browser connects to ESPN
            when it shows them. Schedules, scores and matchup details come from ESPN and Kalshi; our server
            fetches them and sends them no information about you.
          </li>
        </ul>
        <p>
          We may also disclose information if the law requires it, or to protect the app and its players from
          fraud or abuse. The app and its data are hosted in the United States.
        </p>
        <p>
          POW Pick'em's use of information received from Google APIs adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
      </section>

      <section>
        <h3>How long we keep it</h3>
        <ul>
          <li>Your account and league data stay while your account exists.</li>
          <li>
            If you leave a league or an admin removes you, you keep your place in the results of weeks already
            played, so the league's history stays accurate.
          </li>
          <li>Records of sent emails are deleted after about 30 days.</li>
          <li>
            When your account is deleted, so are your profile, memberships, picks, tiebreaker guesses,
            messages (including threads you started) and reactions, and you no longer appear in past league
            results. Feedback you sent is kept without your name.
          </li>
        </ul>
      </section>

      <section>
        <h3>Your choices</h3>
        <ul>
          <li>Change your leaderboard name, email address, password and email settings in the app.</li>
          <li>Leave a league from its League tab.</li>
          <li>
            To get a copy of your data, correct it, or delete your account, email {support} from the address
            on your account. We'll respond within 30 days.
          </li>
          <li>
            If you signed in with Google, you can also remove POW Pick'em's access from your{" "}
            <a href="https://myaccount.google.com/connections">Google Account settings</a>.
          </li>
        </ul>
      </section>

      <section>
        <h3>Children</h3>
        <p>
          POW Pick'em isn't meant for children under 13, and we don't knowingly collect their information. If
          you believe a child under 13 has an account, contact us and we'll delete it.
        </p>
      </section>

      <section>
        <h3>Security</h3>
        <p>
          Connections to the app are encrypted, and so is the connection from our hosting to the database.
          Passwords are stored hashed, and other players' picks stay private until a week is final. No system
          is perfectly secure, so please use a password you don't use elsewhere.
        </p>
      </section>

      <section>
        <h3>Changes</h3>
        <p>
          If we change this policy, we'll update the date above. For significant changes, we'll also tell you
          in the app or by email.
        </p>
      </section>
    </LegalDocument>
  );
}

export function TermsPage() {
  return (
    <LegalDocument title="Terms of service" updated={TERMS_UPDATED}>
      <p>
        These terms apply when you use POW Pick'em (<strong>www.pow-pickem.com</strong>). By creating an
        account or using the app, you agree to them. If you don't agree, please don't use the app. Questions:{" "}
        {support}.
      </p>

      <section>
        <h3>The game</h3>
        <p>
          POW Pick'em is a free game for picking NFL games against the spread with your friends. It is for fun
          only. The app doesn't take, hold or pay out money, and it isn't a betting service. Don't use it to
          run gambling that's illegal where you live.
        </p>
      </section>

      <section>
        <h3>Your account</h3>
        <ul>
          <li>You must be at least 13 years old to use the app.</li>
          <li>
            Give a real email address you can receive mail at, keep your sign-in details to yourself, and tell
            us if you think someone else is using your account.
          </li>
          <li>One person per account. Don't create accounts to get around league limits or a removal.</li>
        </ul>
      </section>

      <section>
        <h3>Leagues</h3>
        <p>
          Whoever creates a league is its admin. Admins set up weeks, spreads and point values, enter or
          correct results, finalize weeks, manage invites, and can remove players. League results are what the
          admin finalizes; disputes about a league's rules or results are between its members and admins.
        </p>
      </section>

      <section>
        <h3>What you post</h3>
        <p>
          You're responsible for the names, messages and other content you post, and you keep ownership of it.
          You let us store and display it to the members of your league so the app can work. Don't post
          anything unlawful, threatening, harassing or hateful, anyone else's personal information, or spam,
          and don't impersonate anyone.
        </p>
      </section>

      <section>
        <h3>Using the app fairly</h3>
        <p>
          Don't try to see other players' picks before a week is final, get into accounts or data that aren't
          yours, interfere with the app or overload it, or scrape it with automated tools.
        </p>
      </section>

      <section>
        <h3>Game data</h3>
        <p>
          Schedules, scores, spreads, team statistics, news and prediction-market prices come from third
          parties, including ESPN and Kalshi, and may be late or wrong. Check anything important elsewhere.
          POW Pick'em isn't affiliated with or endorsed by the NFL, its teams, ESPN or Kalshi. Team names and
          logos belong to their owners and are shown only to identify the teams.
        </p>
      </section>

      <section>
        <h3>Ending your use</h3>
        <p>
          You can stop using the app at any time, and ask us to delete your account by emailing {support}. We
          may suspend or delete accounts that break these terms. We may change or stop offering the app, and
          will try to give notice first.
        </p>
      </section>

      <section>
        <h3>No warranty</h3>
        <p>
          The app is provided free and "as is", without warranties of any kind. We don't promise it will
          always be available, error-free, or that picks, scores or standings will be accurate.
        </p>
      </section>

      <section>
        <h3>Limit of liability</h3>
        <p>
          To the fullest extent the law allows, the people who run POW Pick'em aren't liable for indirect or
          consequential losses, lost data, or anything arising from bets or arrangements between players, and
          our total liability for any claim about the app is limited to $50.
        </p>
      </section>

      <section>
        <h3>Changes</h3>
        <p>
          We may update these terms. We'll change the date above, and for significant changes we'll also tell
          you in the app or by email. Continuing to use the app after a change means you accept the new terms.
          Our <Link to="/privacy">privacy policy</Link> explains how we handle your information.
        </p>
      </section>
    </LegalDocument>
  );
}
