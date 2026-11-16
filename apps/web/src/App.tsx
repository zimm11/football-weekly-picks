import { CaretDownIcon, FootballIcon } from "@phosphor-icons/react";
import type { Me } from "@picks/shared";
import type { Session } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/sonner";
import { api, getSupabase, messageOf, SESSION_ENDED, takeSessionEnded, unwrap } from "./api";
import { clockOffset, onClockChange } from "./clock";
import { Avatar } from "./components/Avatar";
import { useHomeScreenHelp } from "./components/HomeScreenInstall";
import { LoadError } from "./components/LoadError";
import { NameForm } from "./components/NameForm";
import { NewPasswordForm } from "./components/NewPasswordForm";
import { type Credentials, SignInForm, type SignInMode } from "./components/SignInForm";
import { SimulatedClockBanner } from "./components/SimulatedClockBanner";
import { Splash, StartError } from "./components/Splash";
import { buttonVariants } from "./components/ui/button";
import { notifyDone, notifyError } from "./notify";
import { AccountPage } from "./pages/AccountPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { HowToPlayPage } from "./pages/HowToPlayPage";
import { LandingPage } from "./pages/LandingPage";
import { LeaguePage } from "./pages/LeaguePage";
import { JoinPage, LeaguesPage } from "./pages/LeaguesPage";
import { ManageWeekPage } from "./pages/ManageWeekPage";
import { OperatorPage } from "./pages/OperatorPage";
import { UnsubscribePage } from "./pages/UnsubscribePage";
import { useNow } from "./pages/useNow";
import { WeekPage } from "./pages/WeekPage";
import { disablePush, onPushSubscriptionChange, reconcilePushAccount } from "./push";
import { Link, matchRoute, navigate, requestLeave, takeScrollPosition, usePath } from "./router";

/**
 * Scrolls to `top` once the page is tall enough to: after going back, the screen may still be loading.
 * Gives up after two seconds, or as soon as the player scrolls themselves. Returns a cleanup.
 */
function scrollWhenReady(top: number) {
  const scroll = () => window.scrollTo({ top, left: 0, behavior: "instant" });
  scroll();
  if (top === 0) return undefined;
  let tries = 0;
  const stop = () => {
    clearInterval(timer);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchstart", stop);
  };
  const timer = setInterval(() => {
    scroll();
    if (Math.abs(window.scrollY - top) < 2 || ++tries > 40) stop();
  }, 50);
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("touchstart", stop, { passive: true });
  return stop;
}

/**
 * Supabase sends people back from an expired or already-used email link with the reason in the URL fragment
 * (`#error=access_denied&error_code=otp_expired&error_description=...`). Reads it once and clears it.
 */
function takeAuthLinkError(): string | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!params.has("error")) return undefined;
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return params.get("error_code") === "otp_expired"
    ? "That reset link has expired or was already used. Request a new one below."
    : (params.get("error_description") ?? "That link didn't work. Request a new one below.");
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
  // The app couldn't load its configuration (offline, or the API is down), so nothing else can work yet.
  const [startError, setStartError] = useState<string>();
  const [startAttempt, setStartAttempt] = useState(0);
  const path = usePath();
  const route = matchRoute(path);

  useEffect(() => {
    // New pages start at the top, and going back returns to where the player was; native section anchors
    // keep their own scrolling.
    const top = takeScrollPosition();
    if (path && !window.location.hash) return scrollWhenReady(top);
  }, [path]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `startAttempt` is what asks again after a failure.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let current = true;
    getSupabase().then(
      (sb) => {
        if (!current) return;
        sb.auth.getSession().then(({ data }) => setSession(data.session));
        unsubscribe = sb.auth.onAuthStateChange((event, s) => {
          setSession(s);
          if (event === "SIGNED_OUT" && takeSessionEnded()) notifyError(SESSION_ENDED);
          // A reset link signs the player in. If Auth sent them somewhere other than the reset screen
          // (e.g. a redirect URL it doesn't allow), still ask for the new password.
          if (event === "PASSWORD_RECOVERY" && window.location.pathname !== "/reset-password") {
            navigate("/reset-password");
          }
        }).data.subscription.unsubscribe;
      },
      (err) => current && setStartError(messageOf(err)),
    );
    return () => {
      current = false;
      unsubscribe?.();
    };
  }, [startAttempt]);

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
    return data.session ? undefined : { status: "Check your email to confirm your account, then sign in." };
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
  // Unsubscribe links work without signing in.
  if (route.page === "unsubscribe" && !session) {
    return (
      <Shell>
        <UnsubscribePage signedIn={false} />
      </Shell>
    );
  }
  if (startError && session === undefined) {
    return (
      <StartError
        message={startError}
        onRetry={() => {
          setStartError(undefined);
          setStartAttempt((n) => n + 1);
        }}
      />
    );
  }
  if (session === undefined) return <Splash />;
  if (!session) {
    if (route.page === "leagues") {
      return (
        <Shell>
          <LandingPage onSignIn={signIn} onResetRequest={requestReset} />
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
            />
          </Card>
        </div>
      </Shell>
    );
  }
  // Keyed by user so nothing from a previous account survives a switch.
  return <SignedIn key={session.user.id} userId={session.user.id} email={session.user.email} route={route} />;
}

function SignedIn({
  userId,
  email,
  route,
}: {
  userId: string;
  email?: string;
  route: ReturnType<typeof matchRoute>;
}) {
  const [me, setMe] = useState<Me>();
  const [error, setError] = useState<string>();
  const [editingName, setEditingName] = useState(false);
  const homeScreen = useHomeScreenHelp();

  const [meAttempt, setMeAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `meAttempt` is what asks again after a failure.
  useEffect(() => {
    let current = true;
    unwrap<Me>(api.me.$get()).then(
      (value) => current && setMe(value),
      (err) => current && setError(messageOf(err)),
    );
    return () => {
      current = false;
    };
  }, [meAttempt]);

  // Alongside loading the app, never ahead of it: a push hiccup must not keep the player out.
  useEffect(() => {
    const reconcile = () => {
      reconcilePushAccount(userId).catch((err) => notifyError(messageOf(err)));
    };
    reconcile();
    return onPushSubscriptionChange(reconcile);
  }, [userId]);

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

  // Signing out and the name form both replace the screen, so unsaved work on it gets its say first.
  const signOut = () =>
    requestLeave(async () => {
      try {
        await disablePush();
        await (await getSupabase()).auth.signOut();
      } catch (err) {
        notifyError(messageOf(err));
      }
    });

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
          <DropdownMenuItem onSelect={() => requestLeave(() => setEditingName(true))}>
            Change your name
          </DropdownMenuItem>
        )}
        {/* Notifications and the home-screen app live in Settings too, so they need no items of their own. */}
        <DropdownMenuItem onSelect={() => navigate("/account")}>Settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/reset-password")}>Change password</DropdownMenuItem>
        {me?.displayName && route.page !== "feedback" && (
          // Carries the screen they were on, so a bug report says where it happened.
          <DropdownMenuItem
            onSelect={() => navigate(`/feedback?from=${encodeURIComponent(window.location.pathname)}`)}
          >
            Send feedback
          </DropdownMenuItem>
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
          {error && !me && (
            <LoadError
              message={error}
              onRetry={() => {
                setError(undefined);
                setMeAttempt((n) => n + 1);
              }}
            />
          )}
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
              {(route.page === "leagues" || route.page === "login") && (
                <LeaguesPage playerName={me.displayName} />
              )}
              {route.page === "join" && <JoinPage code={route.code} />}
              {/* `/notifications` is where notification settings used to be; old links land on Settings. */}
              {(route.page === "account" || route.page === "notifications") && (
                <AccountPage
                  userId={userId}
                  email={email}
                  onAddToHomeScreen={homeScreen.available ? homeScreen.open : undefined}
                />
              )}
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
