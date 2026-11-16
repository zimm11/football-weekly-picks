import { CaretDownIcon, FootballIcon } from "@phosphor-icons/react";
import type { AuthProvider, Me } from "@picks/shared";
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
import { api, getConfig, getSupabase, messageOf, unwrap } from "./api";
import { readAuthError } from "./authError";
import { clockOffset, onClockChange } from "./clock";
import { Avatar } from "./components/Avatar";
import { useHomeScreenHelp } from "./components/HomeScreenInstall";
import { NameForm } from "./components/NameForm";
import { NewPasswordForm } from "./components/NewPasswordForm";
import { type Credentials, SignInForm, type SignInMode } from "./components/SignInForm";
import { SimulatedClockBanner } from "./components/SimulatedClockBanner";
import { Splash } from "./components/Splash";
import { buttonVariants } from "./components/ui/button";
import { notifyDone } from "./notify";
import { AccountPage } from "./pages/AccountPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { HowToPlayPage } from "./pages/HowToPlayPage";
import { LandingPage } from "./pages/LandingPage";
import { LeaguePage } from "./pages/LeaguePage";
import { JoinPage, LeaguesPage } from "./pages/LeaguesPage";
import { PrivacyPage, TermsPage } from "./pages/LegalPages";
import { ManageWeekPage } from "./pages/ManageWeekPage";
import { OperatorPage } from "./pages/OperatorPage";
import { UnsubscribePage } from "./pages/UnsubscribePage";
import { useNow } from "./pages/useNow";
import { WeekPage } from "./pages/WeekPage";
import { Link, matchRoute, navigate, usePath } from "./router";

/** Reads a failed sign-in's reason from the URL once (`readAuthError`), and clears it from the address bar. */
function takeAuthLinkError(): string | undefined {
  const found = readAuthError(window.location.hash, window.location.search);
  if (!found) return undefined;
  window.history.replaceState(window.history.state, "", window.location.pathname + found.search);
  return found.message;
}

/** Renders nothing (and runs no timer) unless the local API reports a `CLOCK_OVERRIDE`. */
function SimulatedClock() {
  const [offsetMs, setOffsetMs] = useState(clockOffset);
  useEffect(() => {
    // The offset may have arrived between the first render and this effect.
    setOffsetMs(clockOffset());
    return onClockChange(() => setOffsetMs(clockOffset()));
  }, []);
  return offsetMs === 0 ? null : <SimulatedClockTicker offsetMs={offsetMs} />;
}

function SimulatedClockTicker({ offsetMs }: { offsetMs: number }) {
  return <SimulatedClockBanner now={useNow()} offsetMs={offsetMs} />;
}

/** The bar across the top of every screen, and the column the screen sits in. */
function Shell({ account, children }: { account?: ReactNode; children: ReactNode }) {
  const path = usePath();
  const signInClass = buttonVariants({ size: "sm" });
  const brand = (
    <span className="flex items-center gap-2 text-foreground">
      <FootballIcon aria-hidden weight="fill" className="size-6 text-pow" />
      POW Pick'em
    </span>
  );
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b bg-chrome/85 backdrop-blur-md">
        <div className="mx-auto flex min-h-14 max-w-4xl items-center justify-between gap-x-3 px-4 py-1">
          <h1 className="shrink-0 text-xl font-extrabold">
            <Link to="/" className="no-underline">
              {brand}
            </Link>
          </h1>
          <nav aria-label="Main navigation" className="flex min-w-0 items-center gap-1 sm:gap-3">
            <Link
              to="/how-to-play"
              aria-current={path === "/how-to-play" ? "page" : undefined}
              className="flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium text-muted-foreground no-underline hover:bg-raised hover:text-foreground aria-[current=page]:text-foreground"
            >
              How to play
            </Link>
            {account ??
              // Only the sign-in screens have a form to jump to; elsewhere, go to one.
              (["/", "/how-to-play", "/privacy", "/terms"].includes(path) ? (
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
      <SimulatedClock />
      {/* On a phone the league tab bar is pinned to the bottom edge, so leave room to scroll past it. */}
      <main className="mx-auto max-w-4xl px-4 pt-5 pb-28 md:pb-12">{children}</main>
      <Toaster />
    </div>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [linkError] = useState(takeAuthLinkError);
  const [providers, setProviders] = useState<AuthProvider[]>([]);
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
      unsubscribe = sb.auth.onAuthStateChange((event, s) => {
        setSession(s);
        // A reset link signs the player in. If Auth sent them somewhere other than the reset screen
        // (e.g. a redirect URL it doesn't allow), still ask for the new password.
        if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/reset-password") {
          navigate("/reset-password");
        }
      }).data.subscription.unsubscribe;
    });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    // Without the config there is no sign-in at all, and getSupabase reports that; here, just offer no buttons.
    getConfig().then(
      (config) => setProviders(config.authProviders ?? []),
      () => {},
    );
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

  async function signInWithProvider(provider: AuthProvider) {
    const sb = await getSupabase();
    // Come back to this exact page (e.g. /join/<code>). The URL must match a redirect URL allowed in Supabase Auth,
    // otherwise Supabase falls back to the Site URL and an invite link is lost (docs/auth-providers.md).
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href.split("#")[0] },
    });
    return error?.message;
  }

  async function requestReset(email: string) {
    const sb = await getSupabase();
    // The link signs the user in and lands on the screen that asks for a new password.
    const redirectTo = `${window.location.origin}/reset-password`;
    return (await sb.auth.resetPasswordForEmail(email, { redirectTo })).error?.message;
  }

  // The guide is public and can be read even while authentication is still loading.
  if (route.page === "how-to-play" && !session) {
    return (
      <Shell>
        <HowToPlayPage signedIn={false} />
      </Shell>
    );
  }
  // The privacy policy and terms are public (Google's sign-in setup links to them).
  if ((route.page === "privacy" || route.page === "terms") && !session) {
    return <Shell>{route.page === "privacy" ? <PrivacyPage /> : <TermsPage />}</Shell>;
  }
  // Unsubscribe links work without signing in.
  if (route.page === "unsubscribe" && !session) {
    return (
      <Shell>
        <UnsubscribePage signedIn={false} />
      </Shell>
    );
  }
  if (session === undefined) return <Splash />;
  if (!session) {
    if (route.page === "leagues") {
      return (
        <Shell>
          <LandingPage
            onSignIn={signIn}
            onResetRequest={requestReset}
            providers={providers}
            onProviderSignIn={signInWithProvider}
            initialError={linkError}
          />
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
                  : route.page === "reset-password"
                    ? "Reset your password"
                    : "Beat the spread"}
            </h2>
            {route.page !== "reset-password" && (
              <p className="m-0 text-muted-foreground">
                {route.page === "join"
                  ? "Sign in or create an account to join the league."
                  : "Pick NFL winners against the spread with your league."}
              </p>
            )}
          </div>
          <Card id="sign-in" className="scroll-mt-20">
            <SignInForm
              onSubmit={signIn}
              onResetRequest={requestReset}
              startForgot={route.page === "reset-password"}
              initialError={linkError}
              providers={route.page === "reset-password" ? [] : providers}
              onProviderSignIn={signInWithProvider}
            />
          </Card>
        </div>
      </Shell>
    );
  }
  // Keyed by user so nothing from a previous account survives a switch.
  const { full_name, name } = session.user.user_metadata ?? {};
  const suggestedName =
    typeof full_name === "string" ? full_name : typeof name === "string" ? name : undefined;
  return (
    <SignedIn
      key={session.user.id}
      userId={session.user.id}
      email={session.user.email}
      suggestedName={suggestedName?.trim().slice(0, 40)}
      route={route}
    />
  );
}

function SignedIn({
  userId,
  email,
  suggestedName,
  route,
}: {
  userId: string;
  email?: string;
  /** A name Google supplied (`full_name` / `name`), to pre-fill the leaderboard name on first sign-in. */
  suggestedName?: string;
  route: ReturnType<typeof matchRoute>;
}) {
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState<string>();
  const [editingName, setEditingName] = useState(false);
  const homeScreen = useHomeScreenHelp();

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

  async function savePassword(password: string) {
    const { error } = await (await getSupabase()).auth.updateUser({ password });
    if (error) return error.message;
    notifyDone("Password updated.");
    navigate("/");
    return undefined;
  }

  const account = (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 min-w-0 max-w-44 items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm font-medium text-foreground hover:bg-raised">
        {me?.displayName && <Avatar name={me.displayName} />}
        {/* On a phone the avatar stands in for the name, which stays as the button's accessible name. */}
        <span className={me?.displayName ? "truncate max-sm:sr-only" : "truncate"}>
          {me?.displayName ?? "Account"}
        </span>
        <CaretDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {me?.displayName && (
          <DropdownMenuItem onSelect={() => setEditingName(true)}>Change your name</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => navigate("/account")}>Account settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/reset-password")}>Change password</DropdownMenuItem>
        {me?.displayName && route.page !== "feedback" && (
          // Carries the screen they were on, so a bug report says where it happened.
          <DropdownMenuItem
            onSelect={() => navigate(`/feedback?from=${encodeURIComponent(window.location.pathname)}`)}
          >
            Send feedback
          </DropdownMenuItem>
        )}
        {homeScreen.available && (
          <DropdownMenuItem onSelect={homeScreen.open}>Add to home screen</DropdownMenuItem>
        )}
        {me?.isOperator && (
          <DropdownMenuItem onSelect={() => navigate("/operator")}>Operator</DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Shell account={account}>
      {homeScreen.sheet}
      {route.page === "how-to-play" && !editingName ? (
        <HowToPlayPage signedIn />
      ) : route.page === "privacy" && !editingName ? (
        <PrivacyPage />
      ) : route.page === "terms" && !editingName ? (
        <TermsPage />
      ) : route.page === "reset-password" ? (
        // Reached from a reset email (which signs the user in) or the account menu.
        <div className="mx-auto grid max-w-sm gap-5 pt-6">
          <div className="grid gap-2">
            <h2 className="text-4xl leading-none font-extrabold">Choose a new password</h2>
            <p className="m-0 text-muted-foreground">You'll use it the next time you sign in.</p>
          </div>
          <Card>
            <NewPasswordForm onSubmit={savePassword} onCancel={() => navigate("/")} />
          </Card>
        </div>
      ) : (
        <>
          {error && <Notice kind="alert">{error}</Notice>}
          {!me && !error && <Splash />}
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
                  initialName={me.displayName ?? suggestedName ?? ""}
                  submitLabel={me.displayName ? "Save name" : "Continue"}
                  onSubmit={saveName}
                  onCancel={me.displayName ? () => setEditingName(false) : undefined}
                />
              </Card>
            </div>
          )}
          {me?.displayName && !editingName && (
            <>
              {(route.page === "leagues" || route.page === "login") && (
                <LeaguesPage playerName={me.displayName} />
              )}
              {route.page === "join" && <JoinPage code={route.code} />}
              {route.page === "account" && <AccountPage email={email} />}
              {route.page === "unsubscribe" && <UnsubscribePage signedIn />}
              {route.page === "league" && (
                <LeaguePage
                  key={route.leagueId}
                  leagueId={route.leagueId}
                  userId={userId}
                  tab={route.tab}
                  threadId={route.threadId}
                />
              )}
              {route.page === "week" && <WeekPage weekId={route.weekId} userId={userId} />}
              {route.page === "manage-week" && <ManageWeekPage weekId={route.weekId} userId={userId} />}
              {route.page === "feedback" && <FeedbackPage />}
              {route.page === "operator" && me.isOperator && <OperatorPage />}
              {(route.page === "not-found" || (route.page === "operator" && !me.isOperator)) && (
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
