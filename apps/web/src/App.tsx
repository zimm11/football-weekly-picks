import { CaretDownIcon, FootballIcon } from "@phosphor-icons/react";
import type { Me } from "@picks/shared";
import type { Session } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useState } from "react";
import { Card, Notice } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { api, getSupabase, messageOf, unwrap } from "./api";
import { NameForm } from "./components/NameForm";
import { type Credentials, SignInForm, type SignInMode } from "./components/SignInForm";
import { buttonVariants } from "./components/ui/button";
import { notifyDone } from "./notify";
import { HowToPlayPage } from "./pages/HowToPlayPage";
import { LandingPage } from "./pages/LandingPage";
import { LeaguePage } from "./pages/LeaguePage";
import { JoinPage, LeaguesPage } from "./pages/LeaguesPage";
import { ManageWeekPage } from "./pages/ManageWeekPage";
import { WeekPage } from "./pages/WeekPage";
import { Link, matchRoute, usePath } from "./router";

/** The bar across the top of every screen, and the column the screen sits in. */
function Shell({ account, children }: { account?: ReactNode; children: ReactNode }) {
  const path = usePath();
  const signInClass = buttonVariants();
  const brand = (
    <span className="flex items-center gap-2 text-foreground">
      <FootballIcon aria-hidden weight="fill" className="size-6 text-pow" />
      POW Pick'em
    </span>
  );
  return (
    <div className="min-h-dvh">
      <header className="border-b-[3px] border-pow bg-chrome">
        <div className="mx-auto flex min-h-14 max-w-4xl flex-wrap items-center justify-between gap-x-3 px-4 py-1">
          <h1 className="shrink-0 text-2xl font-extrabold">
            <Link to="/" className="no-underline">
              {brand}
            </Link>
          </h1>
          <nav aria-label="Main navigation" className="flex min-w-0 items-center gap-1 sm:gap-3">
            <Link
              to="/how-to-play"
              aria-current={path === "/how-to-play" ? "page" : undefined}
              className="flex min-h-11 shrink-0 items-center px-2 font-display font-bold text-foreground uppercase hover:bg-secondary"
            >
              How to play
            </Link>
            {account ??
              (path === "/" || path === "/how-to-play" ? (
                <Link to="/login" className={signInClass}>
                  Sign in
                </Link>
              ) : (
                <a href="#sign-in" className={signInClass}>
                  Sign in
                </a>
              ))}
          </nav>
        </div>
      </header>
      {/* On a phone the league tab bar is pinned to the bottom edge, so leave room to scroll past it. */}
      <main className="mx-auto max-w-4xl px-4 pt-5 pb-28 md:pb-12">{children}</main>
      <Toaster />
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const path = usePath();
  const route = matchRoute(path);

  useEffect(() => {
    // New pages start at the top; native section anchors retain their own scrolling.
    if (path && !window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [path]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    getSupabase().then((sb) => {
      sb.auth.getSession().then(({ data }) => setSession(data.session));
      unsubscribe = sb.auth.onAuthStateChange((_e, s) => setSession(s)).data.subscription.unsubscribe;
    });
    return () => unsubscribe?.();
  }, []);

  async function signIn(mode: SignInMode, credentials: Credentials) {
    const sb = await getSupabase();
    if (mode === "sign-in") return (await sb.auth.signInWithPassword(credentials)).error?.message;
    // Come back to this page after confirming, so an invite link survives the email round trip.
    const { data, error } = await sb.auth.signUp({
      ...credentials,
      options: { emailRedirectTo: window.location.href },
    });
    if (error) return error.message;
    // Hosted Supabase requires email confirmation by default, so sign-up returns no session.
    return data.session ? undefined : "Check your email to confirm your account, then sign in.";
  }

  // The guide is public and can be read even while authentication is still loading.
  if (route.page === "how-to-play" && !session) {
    return (
      <Shell>
        <HowToPlayPage signedIn={false} />
      </Shell>
    );
  }
  if (session === undefined) return <p className="p-4 text-muted-foreground">Loading…</p>;
  if (!session) {
    if (route.page === "leagues") {
      return (
        <Shell>
          <LandingPage onSignIn={signIn} />
        </Shell>
      );
    }
    return (
      <Shell>
        <div className="mx-auto grid max-w-sm gap-5 pt-6">
          <div className="grid gap-2">
            <h2 className="text-4xl leading-none font-extrabold">
              {route.page === "join"
                ? "Join the league"
                : route.page === "login"
                  ? "Welcome back"
                  : "Beat the spread"}
            </h2>
            <p className="m-0 text-muted-foreground">
              {route.page === "join"
                ? "Sign in or create an account to join the league."
                : "Pick NFL winners against the spread with your league."}
            </p>
          </div>
          <Card id="sign-in" className="scroll-mt-6">
            <SignInForm onSubmit={signIn} />
          </Card>
        </div>
      </Shell>
    );
  }
  // Keyed by user so nothing from a previous account survives a switch.
  return <SignedIn key={session.user.id} userId={session.user.id} route={route} />;
}

function SignedIn({ userId, route }: { userId: string; route: ReturnType<typeof matchRoute> }) {
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState<string>();
  const [editingName, setEditingName] = useState(false);

  useEffect(() => {
    unwrap<Me>(api.me.$get()).then(setMe, (err) => setError(messageOf(err)));
  }, []);

  async function saveName(displayName: string) {
    try {
      const changing = !!me?.displayName;
      setMe(await unwrap<Me>(api.me.$put({ json: { displayName } })));
      setEditingName(false);
      if (changing) notifyDone("Name saved.");
      return undefined;
    } catch (err) {
      return messageOf(err);
    }
  }

  const signOut = async () => (await getSupabase()).auth.signOut();

  const account = (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 min-w-0 max-w-36 items-center gap-1.5 rounded-md px-2 font-medium text-foreground hover:bg-secondary">
        <span className="truncate">{me?.displayName ?? "Account"}</span>
        <CaretDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {me?.displayName && (
          <DropdownMenuItem onSelect={() => setEditingName(true)}>Change your name</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Shell account={account}>
      {route.page === "how-to-play" && !editingName ? (
        <HowToPlayPage signedIn />
      ) : (
        <>
          {error && <Notice kind="alert">{error}</Notice>}
          {!me && !error && <p className="text-muted-foreground">Loading…</p>}
          {me && (!me.displayName || editingName) && (
            <div className="mx-auto grid max-w-sm gap-5 pt-6">
              <div className="grid gap-2">
                <h2 className="text-4xl leading-none font-extrabold">
                  {me.displayName ? "Change your name" : "What should we call you?"}
                </h2>
                <p className="m-0 text-muted-foreground">
                  This is the name your league sees on the leaderboard.
                </p>
              </div>
              <Card>
                <NameForm
                  initialName={me.displayName ?? ""}
                  submitLabel={me.displayName ? "Save name" : "Continue"}
                  onSubmit={saveName}
                  onCancel={me.displayName ? () => setEditingName(false) : undefined}
                />
              </Card>
            </div>
          )}
          {me?.displayName && !editingName && (
            <>
              {(route.page === "leagues" || route.page === "login") && <LeaguesPage />}
              {route.page === "join" && <JoinPage code={route.code} />}
              {route.page === "league" && (
                <LeaguePage key={route.leagueId} leagueId={route.leagueId} userId={userId} tab={route.tab} />
              )}
              {route.page === "week" && <WeekPage weekId={route.weekId} userId={userId} />}
              {route.page === "manage-week" && <ManageWeekPage weekId={route.weekId} userId={userId} />}
              {route.page === "not-found" && (
                <p>
                  Page not found. <Link to="/">Go to your leagues</Link>
                </p>
              )}
            </>
          )}
        </>
      )}
    </Shell>
  );
}
