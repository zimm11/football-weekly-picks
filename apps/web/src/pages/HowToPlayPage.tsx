import { ArrowRightIcon, ListChecksIcon, TrophyIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { MAX_LEAGUE_MEMBERS, MAX_LEAGUES_PER_USER, POW_BONUS } from "@picks/shared";
import type { ReactNode } from "react";
import { buttonVariants } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Link } from "../router";

const sections = [
  ["rules", "The pick rules"],
  ["players", "For players"],
  ["admins", "For admins"],
] as const;

function Steps({ steps }: { steps: { title: string; detail: ReactNode }[] }) {
  return (
    <ol className="m-0 grid list-none p-0">
      {steps.map(({ title, detail }, index) => (
        <li key={title} className="flex gap-4 border-t py-5 first:border-0 first:pt-0 last:pb-0">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-xl font-bold text-primary"
            aria-hidden
          >
            {index + 1}
          </span>
          <div className="grid gap-1">
            <h4 className="text-lg text-foreground">{title}</h4>
            <p className="m-0 text-muted-foreground">{detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function HowToPlayPage({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="grid gap-8 py-3 sm:gap-10">
      <header className="grid justify-items-start gap-4">
        <p className="m-0 text-sm font-semibold text-primary">The league playbook</p>
        <h2 className="text-5xl leading-none font-extrabold sm:text-6xl">How to play</h2>
        <p className="m-0 max-w-2xl text-lg text-muted-foreground">
          POW Pick'em brings your crew together for the NFL regular season. Each week, pick games against the
          spread, choose a Pick of the Week (POW), and compete for weekly wins and the season lead.
        </p>
        <Link to="/" className={buttonVariants()}>
          {signedIn ? "Go to your leagues" : "Sign in or create an account"} <ArrowRightIcon aria-hidden />
        </Link>
      </header>

      <nav aria-label="Guide sections" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {sections.map(([id, title]) => (
          <a
            key={id}
            href={`#${id}`}
            className="flex min-h-12 items-center justify-center rounded-xl bg-card px-2 text-center text-sm font-semibold text-foreground no-underline transition-colors hover:bg-raised"
          >
            {title}
          </a>
        ))}
      </nav>

      <section id="rules" aria-labelledby="rules-title" className="grid scroll-mt-20 gap-5">
        <div className="flex items-center gap-3">
          <TrophyIcon aria-hidden className="size-7 text-primary" />
          <h3 id="rules-title" className="text-3xl">
            The pick rules
          </h3>
        </div>
        <Card>
          <h4 className="text-lg text-foreground">Play the spread</h4>
          <p className="m-0 text-muted-foreground">
            Pick the team you think will cover the displayed spread, rather than simply win the game. A minus
            line means the team is favored; a plus line gives the underdog a head start.
          </p>
          <div className="rounded-lg bg-primary/10 p-4">
            <p className="m-0 font-semibold">Example: Buffalo −3.5 vs. Miami +3.5</p>
            <p className="mt-1 mb-0 text-muted-foreground">
              Buffalo covers by winning by 4 or more. Miami covers by winning outright or losing by 3 or
              fewer. If the adjusted scores are equal on a whole-number spread, it is a push.
            </p>
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            A winning pick earns the game's points. A losing or missing pick earns zero. A push earns zero and
            counts as neither a win nor a loss. Use the spread shown in the app; it stays fixed unless the
            admin edits it.
          </p>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="content-start">
            <h4 className="text-lg text-foreground">What each game is worth</h4>
            <dl className="m-0 grid gap-0 text-sm">
              {[
                ["Sunday daytime", "1 point"],
                ["Sunday night · 7pm ET or later", "2 points"],
                ["Thursday & Monday", "3 points"],
                ["Tuesday, Wednesday, Friday & Saturday", "2 points"],
                ["Thanksgiving & Christmas Day", "4 points"],
              ].map(([slot, points]) => (
                <div key={slot} className="flex justify-between gap-4 border-b py-3 first:pt-0">
                  <dt className="text-muted-foreground">{slot}</dt>
                  <dd className="m-0 shrink-0 font-semibold">{points}</dd>
                </div>
              ))}
            </dl>
            <p className="m-0 text-sm text-muted-foreground">
              Default game slots use Eastern time. Holiday values take priority. Admins can change game
              values, so always check the points on your pick sheet.
            </p>
          </Card>
          <Card className="content-start border-t-4 border-t-pow">
            <h4 className="text-lg text-foreground">One POW. Bigger stakes.</h4>
            <p className="m-0 text-muted-foreground">
              Mark one of your picks as your Pick of the Week. If it covers, you earn the game's points plus{" "}
              <strong className="text-pow">{POW_BONUS} bonus points</strong>. A losing or pushed POW earns no
              bonus.
            </p>
            <p className="m-0 text-sm text-muted-foreground">
              There is no automatic POW: if you don't choose one, you don't get one that week. You can put
              your POW on any game that hasn't kicked off, and move it as often as you like. Once the game
              holding your POW kicks off, it stays there for the week.
            </p>
          </Card>
        </div>

        <Card>
          <h4 className="text-lg text-foreground">Know the deadlines</h4>
          <p className="m-0 text-muted-foreground">
            Every game locks at <strong className="text-foreground">its own kickoff</strong>.
          </p>
          <dl className="m-0 grid gap-4 sm:grid-cols-3">
            {[
              [
                "Before kickoff",
                "Save or change your pick, and put your POW on the game or take it off, as often as you like.",
              ],
              [
                "At kickoff",
                "No new picks or changes on that game. A game also locks as soon as the admin records a result, regardless of the time. A change you hadn't saved yet is undone, and the save bar tells you which.",
              ],
              [
                "Once your POW's game kicks off",
                "Your POW is set for the week. It cannot be moved to a later game or removed.",
              ],
            ].map(([title, detail]) => (
              <div key={title} className="rounded-lg bg-raised p-3">
                <dt className="font-semibold">{title}</dt>
                <dd className="mt-1 ml-0 text-sm text-muted-foreground">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 text-sm text-muted-foreground">
            Your tiebreaker guess follows the same timing as its game: enter or change it until kickoff. A
            saved guess cannot be removed.
          </p>
        </Card>

        <Card>
          <h4 className="text-lg text-foreground">How winners are decided</h4>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <h5 className="m-0 font-semibold">Weekly winner</h5>
              <p className="m-0 text-sm text-muted-foreground">
                Most points, then most games won, then the closest guess to the tiebreaker game's combined
                final score. At equal distance, the guess that did not go over wins. An exact remaining tie
                shares the win.
              </p>
              <p className="m-0 text-sm text-muted-foreground">
                The same order, read from the bottom, names the week's Low Point Loser (LPL): whoever finishes
                last. Players still tied for last share it; nobody is the LPL if the whole league is tied.
              </p>
              <p className="m-0 text-sm text-muted-foreground">
                A perfect week means picking every game and winning them all. A bullseye is an exact
                tiebreaker guess. A lone wolf is the only player on the covering side of a game at least three
                players picked.
              </p>
              <p className="m-0 text-sm text-muted-foreground">
                The tiebreaker is the admin's chosen game, otherwise the last Monday game (or the last game if
                there is no Monday game). Look for “Tiebreaker game” on the sheet.
              </p>
            </div>
            <div className="grid content-start gap-2">
              <h5 className="m-0 font-semibold">Season standings</h5>
              <p className="m-0 text-sm text-muted-foreground">
                Total points from closed weeks, then POWs won, total wins, Monday wins, and Sunday night wins,
                in that order. Players still tied share a rank.
              </p>
              <p className="m-0 text-sm text-muted-foreground">
                Everyone's picks stay private until the admin closes the week. Admins can see who has
                submitted while it is open, but cannot see other players' choices.
              </p>
            </div>
          </div>
        </Card>
      </section>

      <section id="players" aria-labelledby="players-title" className="grid scroll-mt-20 gap-5">
        <div className="flex items-center gap-3">
          <UsersThreeIcon aria-hidden className="size-7 text-primary" />
          <h3 id="players-title" className="text-3xl">
            For players
          </h3>
        </div>
        <Card>
          <Steps
            steps={[
              {
                title: "Get into your league",
                detail: `Create an account or sign in, then choose your display name. Open the invite link your admin sends and press Join league. You can belong to up to ${MAX_LEAGUES_PER_USER} leagues. Your leagues are always one tap away from the POW Pick'em logo.`,
              },
              {
                title: "Open Picks and choose your sides",
                detail:
                  "Select your league, then the Picks tab. The current open week's sheet appears there. Tap a team in each matchup to pick it against the displayed spread. Stats, news & market under a game opens team form, injuries, news, and prediction-market prices for it. If there is no open week, wait for your admin to open one.",
              },
              {
                title: "Choose your POW and tiebreaker",
                detail:
                  "Tap POW beside one of your selected teams. Enter your guess for the combined total points in the labeled tiebreaker game, usually Monday night.",
              },
              {
                title: "Press Save picks",
                detail: `Tapping a team does not save it. Press Save picks and look for “Picks saved.” You can save a partial sheet and return for the rest. Change and save a pick any time before its game kicks off.`,
              },
              {
                title: "Check results and the season race",
                detail:
                  "As each game ends, its result shows on your pick sheet: Won with the points you earned, Lost, or Push. Your week so far adds up your points, record, and POW; it's unofficial until the admin finalizes the week. Once the admin closes the week, a recap shows how you finished the next time you open the league. Open Results to see everyone's picks, the weekly winner, and the awards. Open Standings to track season points, POW wins, and your progress week by week.",
              },
              {
                title: "Talk it over in Messages",
                detail:
                  "The Messages tab is your league's message board. Start a thread or reply to one; a dot on the tab marks threads with posts you haven't read. Tap the smiley below any message or reply and choose an emoji; the reactions a message has appear beside it with a count of the players who chose each, and yours are highlighted. Tap one to add yours, or tap yours again to remove it. Reactions don't mark threads unread. Admins can permanently delete a thread and all its replies and reactions from its ⋯ menu after confirming. Admins can pin a thread as an announcement to keep it at the top of the board. The board shows the newest 30 threads; Load older threads brings in more. You can start five threads a day in a league, and reply as often as you like. Use Quote reply below a message to include it with your reply; Remove quote keeps your draft text. Posted quotes name the original author and link back to their message.",
              },
              {
                title: "Get reminders",
                detail:
                  "At 7pm in your league's time zone the evening before game day, you get a reminder if you still have games to pick that day, plus a note when someone starts a thread. Email is on by default. To get them as notifications on this device too, or to turn either kind off, open Settings from the account menu. On iPhone and iPad, add POW Pick'em to your home screen first (iOS 16.4 or later).",
              },
              {
                title: "Manage your account",
                detail:
                  "Tap your name in the header to change your name or password, open Settings, or sign out. Forgot your password? Use Forgot password? on the sign-in form to get a reset link by email. To leave a league, open its League tab and press Leave league; your results from weeks already played stay in the standings, and rejoining later doesn't change them.",
              },
            ]}
          />
        </Card>
      </section>

      <section id="admins" aria-labelledby="admins-title" className="grid scroll-mt-20 gap-5">
        <div className="flex items-center gap-3">
          <ListChecksIcon aria-hidden className="size-7 text-primary" />
          <h3 id="admins-title" className="text-3xl">
            For admins
          </h3>
        </div>
        <p className="m-0 text-muted-foreground">
          The person who creates a league is its first admin and can make other members admins too. Players
          make picks; admins also prepare the slate and publish results. Each week moves from Draft →
          Accepting picks → Games underway → Awaiting finalization → Final. Finalization is an admin action,
          so results stay private until then.
        </p>
        <Card>
          <Steps
            steps={[
              {
                title: "Create your league and invite the crew",
                detail: `From Your leagues, enter a League name and press Create league. In the League tab, check the league time zone (used to show game days and times) in settings and copy the invite link to share with players. The league and its members carry over between seasons. A league can hold up to ${MAX_LEAGUE_MEMBERS} players.`,
              },
              {
                title: "Share the admin work",
                detail:
                  "In the League tab, tap ⋯ beside a member and choose Make admin to give them the same access you have; Revoke admin takes it back and keeps them in the league as a player. Remove from league takes a member out while keeping their results from weeks already played. Make a new link replaces the invite link, so the old one stops working. A league always keeps at least one admin: if you're the only one, make someone else an admin before leaving or stepping down.",
              },
              {
                title: "Set up a draft week",
                detail:
                  "Choose the Season above the league tabs. To begin another year, select Start a new season and enter its starting year. In the League tab, select a week (1–18) and press Create week; existing weeks open with Manage week instead. The season choice carries across Picks, Results, Standings, and League. Leave Import games and spreads from ESPN checked to load the slate, or add games by hand. You land on Manage week; drafts are visible only to admins.",
              },
              {
                title: "Review the slate, then open picks",
                detail:
                  "Check kickoffs, spreads, and point values. Kickoffs you type are in the league's time zone, and a game moved to a new slot takes that slot's points unless you set them yourself. Add or remove games, choose the tiebreaker game if needed, and press Save changes after edits. When the slate is ready, press Open week for picks. Players can now find it on their Picks tab, and you're offered a league message to announce it.",
              },
              {
                title: "Make your picks and check submissions",
                detail:
                  "Use Make your own picks to fill out the same sheet as everyone else. Return to Manage week to see who has picked and whether they chose a POW. Other players' picks remain private.",
              },
              {
                title: "Record scores and finalize the week",
                detail:
                  "Results for games imported from ESPN fill in on their own as each game ends, whenever someone has the week open. To fetch them right away, press Pull results from ESPN in Manage week; it replaces any score typed in by hand. Or enter scores and press Save changes; a score you type is never overwritten automatically. Score boxes appear once a game kicks off; press Enter score to record one sooner. When every game has a final score, press Finalize week and confirm. This reveals everyone's picks, names the winner and any Low Point Loser, and updates season standings. You can write a league message with the final results shown for reference. Pulling results and finalizing never change spreads: the opening lines stay in place unless an admin edits them manually.",
              },
              {
                title: "Correct results when needed",
                detail:
                  "Use Reopen week in Manage week, correct the score or spread, and save. Spreads aren't pulled from ESPN again once a week is open; correct one by typing the new line. Close the week again to publish the corrected results. While reopened, other players' picks are hidden and the week is excluded from standings.",
              },
            ]}
          />
        </Card>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t pt-6">
        <p className="m-0 text-muted-foreground">Ready for the next slate?</p>
        <Link to="/" className={buttonVariants()}>
          {signedIn ? "Go to your leagues" : "Get started"} <ArrowRightIcon aria-hidden />
        </Link>
      </footer>
    </div>
  );
}
