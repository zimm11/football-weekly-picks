import { ArrowRightIcon, ListChecksIcon, TrophyIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { LOCK_HOUR, POW_BONUS } from "@picks/shared";
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
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary font-display text-xl font-bold text-primary"
            aria-hidden
          >
            {index + 1}
          </span>
          <div className="grid gap-1">
            <h4 className="text-xl">{title}</h4>
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
        <p className="m-0 font-display text-sm font-bold tracking-[0.2em] text-primary uppercase">
          The league playbook
        </p>
        <h2 className="text-5xl leading-none font-extrabold sm:text-6xl">How to play</h2>
        <p className="m-0 max-w-2xl text-lg text-muted-foreground">
          POW Pick'em brings your crew together for the NFL regular season. Each week, pick games against the
          spread, choose a Pick of the Week (POW), and compete for weekly wins and the season lead.
        </p>
        <Link to="/" className={buttonVariants()}>
          {signedIn ? "Go to your leagues" : "Sign in or create an account"} <ArrowRightIcon aria-hidden />
        </Link>
      </header>

      <nav aria-label="Guide sections" className="grid grid-cols-3 border-y">
        {sections.map(([id, title]) => (
          <a
            key={id}
            href={`#${id}`}
            className="flex min-h-14 items-center justify-center px-2 text-center font-display text-lg font-bold text-foreground uppercase hover:bg-secondary"
          >
            {title}
          </a>
        ))}
      </nav>

      <section id="rules" aria-labelledby="rules-title" className="grid scroll-mt-6 gap-5">
        <div className="flex items-center gap-3">
          <TrophyIcon aria-hidden className="size-7 text-primary" />
          <h3 id="rules-title" className="text-3xl">
            The pick rules
          </h3>
        </div>
        <Card>
          <h4 className="text-2xl">Play the spread</h4>
          <p className="m-0 text-muted-foreground">
            Pick the team you think will cover the displayed spread, rather than simply win the game. A minus
            line means the team is favored; a plus line gives the underdog a head start.
          </p>
          <div className="border-l-4 border-primary bg-primary/10 p-4">
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
            <h4 className="text-2xl">What each game is worth</h4>
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
            <h4 className="text-2xl">One POW. Bigger stakes.</h4>
            <p className="m-0 text-muted-foreground">
              Mark one of your picks as your Pick of the Week. If it covers, you earn the game's points plus{" "}
              <strong className="text-pow">{POW_BONUS} bonus points</strong>. A losing or pushed POW earns no
              bonus.
            </p>
            <p className="m-0 text-sm text-muted-foreground">
              If you leave your POW unchosen, your pick on the tiebreaker game becomes your POW. From{" "}
              {LOCK_HOUR}am on Sunday, that default is enforced when the slate has Sunday games and a later
              tiebreaker game; you can no longer choose a different game. You still need to save a pick on
              that game to earn its points.
            </p>
          </Card>
        </div>

        <Card>
          <h4 className="text-2xl">Know the deadlines</h4>
          <p className="m-0 text-muted-foreground">
            Pick deadlines use <strong className="text-foreground">your league's time zone</strong>, shown in
            the League tab.
          </p>
          <dl className="m-0 grid gap-4 sm:grid-cols-3">
            {[
              [
                `Before ${LOCK_HOUR}am on game day`,
                "Save or change your pick and assign your POW while the game is still open.",
              ],
              [
                `From ${LOCK_HOUR}am until kickoff`,
                "Saved picks freeze. A missing pick can still be added, but it is final once saved. The POW cannot move onto or off that game.",
              ],
              [
                "At kickoff",
                "No new picks or changes. A game also closes as soon as the admin records a result, regardless of the time.",
              ],
            ].map(([title, detail]) => (
              <div key={title} className="border-l-2 border-primary pl-3">
                <dt className="font-semibold">{title}</dt>
                <dd className="mt-1 ml-0 text-sm text-muted-foreground">{detail}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 text-sm text-muted-foreground">
            If kickoff is before {LOCK_HOUR}am, kickoff is the deadline. Your tiebreaker guess follows the
            same timing as its game: a saved guess freezes at {LOCK_HOUR}am, and a missing guess can be added
            until kickoff. A saved guess cannot be removed.
          </p>
        </Card>

        <Card>
          <h4 className="text-2xl">How winners are decided</h4>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid content-start gap-2">
              <h5 className="m-0 font-semibold">Weekly winner</h5>
              <p className="m-0 text-sm text-muted-foreground">
                Most points, then most games won, then the closest guess to the tiebreaker game's combined
                final score. At equal distance, the guess that did not go over wins. An exact remaining tie
                shares the win.
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

      <section id="players" aria-labelledby="players-title" className="grid scroll-mt-6 gap-5">
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
                detail:
                  "Create an account or sign in, then choose your display name. Open the invite link your admin sends and press Join league. Your leagues are always one tap away from the POW Pick'em logo.",
              },
              {
                title: "Open Picks and choose your sides",
                detail:
                  "Select your league, then the Picks tab. The current open week's sheet appears there. Tap a team in each matchup to pick it against the displayed spread. If there is no open week, wait for your admin to open one.",
              },
              {
                title: "Choose your POW and tiebreaker",
                detail:
                  "Tap POW beside one of your selected teams. Enter your guess for the combined total points in the labeled tiebreaker game, usually Monday night.",
              },
              {
                title: "Press Save picks",
                detail: `Tapping a team does not save it. Press Save picks and look for “Picks saved.” You can save a partial sheet and return for the rest. Change and save open picks before their ${LOCK_HOUR}am game-day lock.`,
              },
              {
                title: "Check results and the season race",
                detail:
                  "Once the admin closes the week, open Results to see everyone's picks and the weekly winner. Open Standings to track season points, POW wins, and your progress week by week.",
              },
            ]}
          />
        </Card>
      </section>

      <section id="admins" aria-labelledby="admins-title" className="grid scroll-mt-6 gap-5">
        <div className="flex items-center gap-3">
          <ListChecksIcon aria-hidden className="size-7 text-primary" />
          <h3 id="admins-title" className="text-3xl">
            For admins
          </h3>
        </div>
        <p className="m-0 text-muted-foreground">
          The person who creates a league is its admin. Players make picks; admins also prepare the slate and
          publish results. Each week moves from Draft → Accepting picks → Games underway → Awaiting
          finalization → Final. Finalization is an admin action, so results stay private until then.
        </p>
        <Card>
          <Steps
            steps={[
              {
                title: "Create your league and invite the crew",
                detail:
                  "From Your leagues, enter a League name and press Create league. In the League tab, check the league time zone in settings and copy the invite link to share with players. The league and its members carry over between seasons.",
              },
              {
                title: "Set up a draft week",
                detail:
                  "Choose the Season above the league tabs. To begin another year, select Start a new season and enter its starting year. In the League tab, select a week (1–18) and press Create week; existing weeks open with Manage week instead. The season choice carries across Picks, Results, Standings, and League. Leave Import games and spreads from ESPN checked to load the slate, or add games by hand. You land on Manage week; drafts are visible only to admins.",
              },
              {
                title: "Review the slate, then open picks",
                detail:
                  "Check kickoffs, spreads, and point values. Add or remove games, choose the tiebreaker game if needed, and press Save changes after edits. When the slate is ready, press Open week for picks. Players can now find it on their Picks tab.",
              },
              {
                title: "Make your picks and check submissions",
                detail:
                  "Use Make your own picks to fill out the same sheet as everyone else. Return to Manage week to see who has picked and whether they chose a POW. Other players' picks remain private.",
              },
              {
                title: "Record scores and finalize the week",
                detail:
                  "In Manage week, press Pull results from ESPN once games are final, or enter scores and press Save changes. When every game has a final score, press Finalize week and confirm. This reveals everyone's picks, names the winner, and updates season standings.",
              },
              {
                title: "Correct results when needed",
                detail:
                  "Use Reopen week in Manage week, correct the score or spread, and save. Close the week again to publish the corrected results. While reopened, other players' picks are hidden and the week is excluded from standings.",
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
