import type { Example } from "@picks/shared";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { api, getSupabase } from "./api";
import { ExampleList } from "./components/ExampleList";
import { type Credentials, SignInForm, type SignInMode } from "./components/SignInForm";

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

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
    const { data, error } = await sb.auth.signUp(credentials);
    if (error) return error.message;
    // Hosted Supabase requires email confirmation by default, so sign-up returns no session.
    return data.session ? undefined : "Check your email to confirm your account, then sign in.";
  }

  if (session === undefined) return <p>Loading…</p>;
  return (
    <main style={{ maxWidth: 640, margin: "2rem auto", fontFamily: "system-ui", padding: "0 1rem" }}>
      <h1>Weekly Picks</h1>
      {session ? <Home email={session.user.email} /> : <SignInForm onSubmit={signIn} />}
    </main>
  );
}

function Home({ email }: { email?: string }) {
  const [items, setItems] = useState<Example[]>([]);

  useEffect(() => {
    api.examples.$get().then(async (res) => res.ok && setItems(await res.json()));
  }, []);

  async function add(title: string) {
    const res = await api.examples.$post({ json: { title } });
    if (!res.ok) return "Could not add item";
    const created = await res.json();
    setItems((prev) => [created, ...prev]);
    return undefined;
  }

  return (
    <>
      <p>
        Signed in as {email}{" "}
        <button type="button" onClick={async () => (await getSupabase()).auth.signOut()}>
          Sign out
        </button>
      </p>
      <ExampleList items={items} onAdd={add} />
    </>
  );
}
