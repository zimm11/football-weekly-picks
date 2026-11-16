import {
  ArrowRightIcon,
  CheckCircleIcon,
  FireIcon,
  FootballIcon,
  LockIcon,
  TrophyIcon,
} from "@phosphor-icons/react";
import { type AuthProvider, POW_BONUS } from "@picks/shared";
import { type Credentials, SignInForm, type SignInMode } from "../components/SignInForm";
import { TeamLogo } from "../components/TeamLogo";
import { Badge } from "../components/ui/badge";
import { buttonVariants } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Link } from "../router";
import { LegalLinks } from "./LegalPages";

export function LandingPage({
  onSignIn,
  onResetRequest,
  providers,
  onProviderSignIn,
  initialError,
}: {
  onSignIn: (mode: SignInMode, credentials: Credentials) => Promise<string | undefined>;
  onResetRequest: (email: string) => Promise<string | undefined>;
  providers?: readonly AuthProvider[];
  onProviderSignIn?: (provider: AuthProvider) => Promise<string | undefined>;
  /** A failed Google sign-in that sent the player back here. */
  initialError?: string;
}) {
  return (
    <div className="grid gap-10 py-4 sm:gap-14 sm:py-8">
      <section className="grid items-center gap-8 md:grid-cols-[1.15fr_1fr]" aria-labelledby="welcome-title">
        <div className="grid justify-items-start gap-5">
          <p className="m-0 text-sm font-semibold text-primary">Your league. Every week. All season.</p>
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

        {/* The same card players pick from, filled in as an example. */}
        <Card aria-label="Example pick" className="gap-4 p-4 shadow-2xl shadow-primary/10">
          <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>Monday night · 8:15 PM</span>
            <span className="flex gap-1.5">
              <Badge variant="outline">Example</Badge>
              <Badge>3 pts</Badge>
            </span>
          </div>
          <div aria-hidden className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <div className="relative flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg bg-primary text-primary-foreground shadow-md shadow-primary/25">
              <CheckCircleIcon weight="fill" className="absolute top-1.5 right-1.5 size-4 opacity-90" />
              <TeamLogo abbr="BUF" size={36} />
              <span className="font-display text-xl leading-tight font-bold uppercase">Bills</span>
              <span className="text-sm font-medium opacity-75">−3.5</span>
            </div>
            <div className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-lg bg-raised">
              <TeamLogo abbr="MIA" size={36} />
              <span className="font-display text-xl leading-tight font-bold uppercase">Dolphins</span>
              <span className="text-sm font-medium opacity-75">+3.5 · home</span>
            </div>
            <div className="flex w-14 items-center justify-center rounded-lg bg-pow font-display text-base font-extrabold tracking-wider text-pow-foreground shadow-md shadow-pow/30">
              POW
            </div>
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            Buffalo at Miami: the Bills need to win by 4 or more. Make it your POW and a win is worth{" "}
            <strong className="text-win">{3 + POW_BONUS} points</strong>.
          </p>
        </Card>
      </section>

      <section aria-label="The basics" className="grid gap-4 sm:grid-cols-3">
        {[
          {
            icon: FootballIcon,
            title: "Pick the slate",
            detail: "Choose a side in every game. The spread is the score to beat.",
          },
          {
            icon: FireIcon,
            title: "Call your POW",
            detail: `Back one pick for ${POW_BONUS} extra points if it wins.`,
          },
          {
            icon: TrophyIcon,
            title: "Chase first place",
            detail: "See everyone's picks and the standings after the admin closes the week.",
          },
        ].map(({ icon: Icon, title, detail }) => (
          <div key={title} className="grid content-start gap-2 rounded-xl bg-card p-4">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Icon aria-hidden weight="fill" className="size-5" />
            </span>
            <h3 className="text-xl">{title}</h3>
            <p className="m-0 text-sm text-muted-foreground">{detail}</p>
          </div>
        ))}
      </section>

      <section
        id="get-started"
        aria-labelledby="get-started-title"
        className="grid scroll-mt-20 gap-6 md:grid-cols-2 md:gap-10"
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
            <span>Each game locks at kickoff. Change your picks and your POW any time before then.</span>
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
          <SignInForm
            onSubmit={onSignIn}
            onResetRequest={onResetRequest}
            providers={providers}
            onProviderSignIn={onProviderSignIn}
            initialError={initialError}
          />
        </Card>
      </section>
      <footer className="border-t pt-2">
        <LegalLinks />
      </footer>
    </div>
  );
}
