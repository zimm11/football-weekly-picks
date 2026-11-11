import type { Me } from "@picks/shared";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { api, getSupabase, messageOf, unwrap } from "./api";
import { NameForm } from "./components/NameForm";
import { type Credentials, SignInForm, type SignInMode } from "./components/SignInForm";
import { LeaguePage } from "./pages/LeaguePage";
import { JoinPage, LeaguesPage } from "./pages/LeaguesPage";
import { ManageWeekPage } from "./pages/ManageWeekPage";
import { WeekPage } from "./pages/WeekPage";
import { Link, matchRoute, usePath } from "./router";

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const route = matchRoute(usePath());

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

  if (session === undefined) return <p>Loading…</p>;
  if (!session) {
    return (
      <div className="shell">
        <header className="topbar">
          <h1>Weekly Picks</h1>
        </header>
        <section className="card stack">
          <p style={{ margin: 0 }}>
            {route.page === "join"
              ? "Sign in or create an account to join the league."
              : "Pick NFL winners against the spread with your league."}
          </p>
          <SignInForm onSubmit={signIn} />
        </section>
      </div>
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
      setMe(await unwrap<Me>(api.me.$put({ json: { displayName } })));
      setEditingName(false);
      return undefined;
    } catch (err) {
      return messageOf(err);
    }
  }

  const signOut = async () => (await getSupabase()).auth.signOut();

  return (
    <div className="shell">
      <header className="topbar">
        <h1>
          <Link to="/">Weekly Picks</Link>
        </h1>
        <div className="who">
          {me?.displayName && (
            <button
              type="button"
              className="link"
              onClick={() => setEditingName(true)}
              title="Change your name"
            >
              {me.displayName}
            </button>
          )}
          <button type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main>
        {error && <p role="alert">{error}</p>}
        {!me && !error && <p>Loading…</p>}
        {me && (!me.displayName || editingName) && (
          <section className="card stack">
            <h2>{me.displayName ? "Change your name" : "What should we call you?"}</h2>
            <p className="muted" style={{ margin: 0 }}>
              This is the name your league sees on the leaderboard.
            </p>
            <NameForm
              initialName={me.displayName ?? ""}
              submitLabel={me.displayName ? "Save name" : "Continue"}
              onSubmit={saveName}
            />
          </section>
        )}
        {me?.displayName && !editingName && (
          <>
            {route.page === "leagues" && <LeaguesPage />}
            {route.page === "join" && <JoinPage code={route.code} />}
            {route.page === "league" && <LeaguePage leagueId={route.leagueId} userId={userId} />}
            {route.page === "week" && <WeekPage weekId={route.weekId} userId={userId} />}
            {route.page === "manage-week" && <ManageWeekPage weekId={route.weekId} userId={userId} />}
            {route.page === "not-found" && (
              <p>
                Page not found. <Link to="/">Go to your leagues</Link>
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
