import { ArrowRightIcon, CheckCircleIcon, LockIcon, TrophyIcon } from "@phosphor-icons/react";
import { LOCK_HOUR, POW_BONUS } from "@picks/shared";
import { type Credentials, SignInForm, type SignInMode } from "../components/SignInForm";
import { buttonVariants } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Link } from "../router";

export function LandingPage({
  onSignIn,
}: {
  onSignIn: (mode: SignInMode, credentials: Credentials) => Promise<string | undefined>;
}) {
  return (
    <div className="grid gap-10 py-4 sm:gap-14 sm:py-8">
      <section className="grid items-center gap-8 md:grid-cols-[1.15fr_1fr]" aria-labelledby="welcome-title">
        <div className="grid justify-items-start gap-5">
          <p className="m-0 font-display text-sm font-bold tracking-[0.2em] text-primary uppercase">
            Your league. Every week. All season.
          </p>
          <h2 id="welcome-title" className="text-6xl leading-[0.9] font-extrabold sm:text-7xl">
            Beat the spread.
            <br />
            <span className="text-primary">Own the week.</span>
          </h2>
          <p className="m-0 max-w-md text-lg text-muted-foreground">
            An NFL pick'em built for your crew. Pick every game against the spread, call your Pick of the
            Week, and chase the top spot in your league.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="#get-started" className={buttonVariants({ size: "lg" })}>
              Get started <ArrowRightIcon aria-hidden />
            </a>
            <Link to="/how-to-play" className={buttonVariants({ variant: "outline", size: "lg" })}>
              How to play
            </Link>
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            Have an invite? Open your admin's link to join their league.
          </p>
        </div>

        <Card aria-label="Example pick" className="gap-0 overflow-hidden p-0">
          <div className="flex items-center justify-between gap-2 border-b bg-chrome px-5 py-3">
            <span className="font-display font-bold tracking-widest uppercase">The weekly game plan</span>
            <span className="text-xs text-muted-foreground">Example</span>
          </div>
          <div className="grid gap-5 p-5">
            <div className="flex items-end justify-between gap-2">
              <div>
                <p className="m-0 text-sm text-muted-foreground">Monday night</p>
                <h3 className="text-3xl">Buffalo at Miami</h3>
              </div>
              <span className="shrink-0 font-display text-lg font-bold text-muted-foreground">3 PTS</span>
            </div>
            <div className="grid grid-cols-2 gap-2 font-display text-xl font-bold uppercase">
              <div className="flex min-h-20 items-center justify-center gap-2 rounded-md border-2 border-primary bg-primary text-primary-foreground">
                <CheckCircleIcon aria-hidden weight="fill" className="size-5" /> Buffalo −3.5
              </div>
              <div className="flex min-h-20 items-center justify-center rounded-md border-2 border-input">
                Miami +3.5
              </div>
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              Buffalo needs to win by 4 or more for this pick to win.
            </p>
            <div className="flex items-center gap-3 border-y py-4">
              <span className="rounded-md bg-pow px-3 py-2 font-display text-xl font-extrabold text-pow-foreground">
                POW
              </span>
              <div>
                <p className="m-0 font-semibold">Your strongest call of the week</p>
                <p className="m-0 text-sm text-muted-foreground">Win it for +{POW_BONUS} bonus points.</p>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">A winning Monday POW</span>
              <span className="font-display text-3xl font-bold text-win">{3 + POW_BONUS} points</span>
            </div>
          </div>
        </Card>
      </section>

      <section aria-label="The basics" className="grid gap-5 border-y py-6 sm:grid-cols-3 sm:gap-6">
        {[
          ["01", "Pick the slate", "Choose a side in every game. The spread is the score to beat."],
          ["02", "Call your POW", `Back one pick for ${POW_BONUS} extra points if it wins.`],
          [
            "03",
            "Chase first place",
            "See everyone's picks and the standings after the admin closes the week.",
          ],
        ].map(([number, title, detail]) => (
          <div key={number} className="flex gap-3">
            <span className="font-display text-3xl font-bold text-primary">{number}</span>
            <div className="grid content-start gap-1">
              <h3 className="text-xl">{title}</h3>
              <p className="m-0 text-sm text-muted-foreground">{detail}</p>
            </div>
          </div>
        ))}
      </section>

      <section
        id="get-started"
        aria-labelledby="get-started-title"
        className="grid scroll-mt-6 gap-6 md:grid-cols-2 md:gap-10"
      >
        <div className="grid content-start gap-5">
          <div className="grid gap-2">
            <h2 id="get-started-title" className="text-4xl leading-none">
              Your next game starts here
            </h2>
            <p className="m-0 text-muted-foreground">
              Sign in to your leagues or create an account to get going. Set your display name, then follow an
              invite link or start a league of your own.
            </p>
          </div>
          <p className="m-0 flex items-start gap-3 text-sm text-muted-foreground">
            <LockIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <span>
              Saved picks freeze at {LOCK_HOUR}am on game day in your league's time zone. Pick early.
            </span>
          </p>
          <p className="m-0 flex items-start gap-3 text-sm text-muted-foreground">
            <TrophyIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
            <span>Running the league? The guide walks you through invites, week setup, and results.</span>
          </p>
          <Link to="/how-to-play" className="flex min-h-11 items-center gap-2 font-medium">
            Read the rules &amp; app guide <ArrowRightIcon aria-hidden className="size-4" />
          </Link>
        </div>
        <Card aria-label="Sign in or create an account">
          <h3 className="text-2xl">Welcome to POW Pick'em</h3>
          <SignInForm onSubmit={onSignIn} />
        </Card>
      </section>
    </div>
  );
}
