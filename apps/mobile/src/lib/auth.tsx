import type { Me } from "@picks/shared";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import { type Href, useRouter } from "expo-router";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform } from "react-native";
import { getSupabase, request } from "./api";
import { AUTH_MESSAGES, authMessage } from "./authErrors";
import { type AuthCallback, authCallback, withNext } from "./links";
import { clearLoadCache } from "./loadCache";
import { clearMessageUnread } from "./messageUnread";
import { openScreen } from "./navigation";
import {
  disableNativePush,
  forgetNativePush,
  reconcileNativePush,
  subscribeNativeNotifications,
} from "./notifications";
import { notifyDone, notifyError } from "./notify";
import { createProfileLoader, type ProfileLoader, type ProfileState } from "./profileLoad";

type Auth = {
  session: Session | null;
  me: Me | null;
  loading: boolean;
  error?: string;
  /** Why an emailed link (sign-in, password reset) didn't work, shown on the sign-in form beside a fresh start. */
  linkError?: string;
  refreshProfile: () => Promise<void>;
  retry: () => void;
  /** `accountDeleted`: the account is gone, so nothing is asked of the API or Auth server; only this device forgets it. */
  signOut: (options?: { accountDeleted?: boolean }) => Promise<void>;
};
const Context = createContext<Auth | null>(null);
/** Empties what the app keeps in memory about the signed-in player: loaded screens and unread counts. */
function forgetPlayerData() {
  clearLoadCache();
  clearMessageUnread();
}

/**
 * How an emailed link went, said once the app has settled: a banner, or (signed out) on the sign-in form.
 * `signIn`: what's left is to sign in, so the link opens the form.
 */
type LinkNotice = { kind: "done" | "error"; message: string; signIn?: boolean };
const OTHER_ADDRESS =
  "One more step: open the link we sent to your other email address to finish the change.";

/**
 * Verifies an emailed link and says how it went. A token-hash link works in any browser; an older `?code=` link
 * only where it was asked for, but by then Auth has already confirmed the address, so for a sign-up or an email
 * change that is good news, not a failure.
 */
async function verifyLink(sb: SupabaseClient, link: AuthCallback): Promise<LinkNotice | undefined> {
  if (link.error) return { kind: "error", message: link.error };
  if (link.otherAddress) return { kind: "done", message: OTHER_ADDRESS };
  let session: Session | null = null;
  let user: User | null = null;
  try {
    if (link.tokenHash && link.type) {
      const { data, error } = await sb.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
      if (error) throw error;
      session = data.session;
      user = data.user;
    } else if (link.code) {
      const { data, error } = await sb.auth.exchangeCodeForSession(link.code);
      if (error) throw error;
      session = data.session;
      user = data.user;
    } else if (link.accessToken && link.refreshToken) {
      const { error } = await sb.auth.setSession({
        access_token: link.accessToken,
        refresh_token: link.refreshToken,
      });
      if (error) throw error;
      return undefined;
    }
  } catch (error) {
    const message = authMessage(error);
    if (message === AUTH_MESSAGES.otherBrowser && !link.recovery) {
      if (link.path === "/account") {
        // Signed in here already: pick up the new address.
        if ((await sb.auth.getSession()).data.session) await sb.auth.refreshSession().catch(() => undefined);
        return { kind: "done", message: "Your new email address is confirmed." };
      }
      return { kind: "done", message: "Your email is confirmed. Sign in to continue.", signIn: true };
    }
    return { kind: "error", message: message === AUTH_MESSAGES.generic ? AUTH_MESSAGES.expired : message };
  }
  if (link.recovery) return undefined;
  if (link.type === "email_change" || (link.path === "/account" && link.code)) {
    // After the first of an email change's two confirmations Auth may answer without a session, or with the
    // new address still pending.
    if (!session || session.user.new_email) return { kind: "done", message: OTHER_ADDRESS };
    const email = session.user.email ?? user?.email;
    return {
      kind: "done",
      message: email ? `Your email is now ${email}.` : "Your email address is changed.",
    };
  }
  return { kind: "done", message: "Your email is confirmed. Welcome to POW Pick'em." };
}

/** Where an emailed link leaves the player, without its code or token in the address bar. */
function linkDestination(link: AuthCallback, notice: LinkNotice | undefined) {
  if (link.recovery) return "/reset-password";
  if (link.path === "/account") return "/account";
  // A sign-up link that failed, or that needs a sign-in to finish, opens the form at the top of the page.
  if (notice?.kind === "error" || notice?.signIn) return withNext("/login", link.next);
  return link.next ?? "/";
}

/** What an emailed link adds to an address: credentials, or Auth's verdict. */
const LINK_PARAMS =
  /^(code|token_hash|type|access_token|refresh_token|expires_at|expires_in|token_type|provider_token|error|error_code|error_description|message)$/;

/**
 * Takes what an emailed link added out of the browser's address bar (and so its history), once the app has moved
 * on. Needed when the link landed on the page it was going to: the router keeps that address, fragment included.
 */
function forgetLinkInAddress() {
  const url = new URL(window.location.href);
  const keep = (params: URLSearchParams) => [...params.entries()].filter(([name]) => !LINK_PARAMS.test(name));
  const query = new URLSearchParams(keep(url.searchParams)).toString();
  const hash = new URLSearchParams(keep(new URLSearchParams(url.hash.slice(1)))).toString();
  const clean = `${url.pathname}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
  if (clean !== `${url.pathname}${url.search}${url.hash}`)
    window.history.replaceState(window.history.state, "", clean);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileState<Me>>({ profile: null, loading: true });
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState<string>();
  const [linkNotice, setLinkNotice] = useState<LinkNotice>();
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const loaderRef = useRef<ProfileLoader<Me>>(null);
  const mounted = useRef(true);
  const handledLinks = useRef(new Set<string>());
  const router = useRouter();
  // Declared first, so the loader exists before the effects below run.
  useEffect(() => {
    mounted.current = true;
    const loader = createProfileLoader<Me>({
      fetch: () => request<Me>("/me"),
      publish: setProfile,
      messageOf: authMessage,
    });
    loaderRef.current = loader;
    return () => {
      mounted.current = false;
      loader.dispose();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    await loaderRef.current?.refresh();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries initialization.
  useEffect(() => {
    const loader = loaderRef.current;
    if (!loader) return;
    let active = true;
    let stop: (() => void) | undefined;
    let authGeneration = 0;
    loader.reset();
    getSupabase()
      .then(async (sb) => {
        if (!active) return;
        const update = async (next: Session | null) => {
          const sameUser = next?.user.id === sessionRef.current?.user.id;
          // Signed out, or another account on this browser or phone: nothing loaded for the last player stays.
          if (!sameUser) forgetPlayerData();
          if (next && !sameUser) setLinkError(undefined);
          sessionRef.current = next;
          setSession(next);
          // The same player again (token refresh, a repeated SIGNED_IN) keeps the profile, so screens holding
          // edits stay mounted.
          await loader.setUser(next?.user.id ?? null);
        };
        stop = sb.auth.onAuthStateChange((event, next) => {
          if (!active) return;
          const generation = ++authGeneration;
          // Supabase callbacks must not await another auth operation under its lock.
          setTimeout(() => {
            if (active && generation === authGeneration) void update(next);
          }, 0);
          if (event === "PASSWORD_RECOVERY")
            setTimeout(() => {
              if (active) router.replace("/reset-password");
            }, 0);
        }).data.subscription.unsubscribe;
        const generation = authGeneration;
        const initial = await sb.auth.getSession();
        if (initial.error) throw initial.error;
        // A later auth event wins over an older getSession snapshot.
        if (active && generation === authGeneration) await update(initial.data.session);
        if (active && AppState.currentState === "active") sb.auth.startAutoRefresh();
      })
      .catch((err) => {
        if (active) loader.fail(err);
      });
    const appState = AppState.addEventListener("change", (state) => {
      getSupabase()
        .then((sb) => {
          if (active) {
            if (state === "active") sb.auth.startAutoRefresh();
            else sb.auth.stopAutoRefresh();
          }
        })
        .catch(() => {});
    });
    return () => {
      active = false;
      ++authGeneration;
      stop?.();
      appState.remove();
    };
  }, [attempt, router]);

  useEffect(() => {
    // Runs to the end even if this effect is cleaned up meanwhile: a link is verified once (`handledLinks`), so
    // abandoning it halfway would leave the splash up with nobody left to finish.
    const handle = async (url: string) => {
      const link = authCallback(url);
      if (!link || handledLinks.current.has(url)) return;
      const tokens = link.accessToken && link.refreshToken;
      if (!link.code && !link.tokenHash && !link.error && !link.otherAddress && !tokens) return;
      handledLinks.current.add(url);
      setLinkLoading(true);
      setLinkError(undefined);
      let notice: LinkNotice | undefined;
      try {
        notice = await verifyLink(await getSupabase(), link);
      } catch (err) {
        notice = { kind: "error", message: authMessage(err) };
      }
      if (!mounted.current) return;
      setLinkNotice(notice);
      // Leaves the landing page for where the link was going, and takes its code or token out of the address.
      router.replace(linkDestination(link, notice) as Href);
      // After the navigation, so /auth/callback's own redirect never runs first.
      setTimeout(() => {
        if (Platform.OS === "web") forgetLinkInAddress();
        if (mounted.current) setLinkLoading(false);
      }, 0);
    };
    Linking.getInitialURL()
      .then((url) => {
        if (url) void handle(url);
      })
      .catch(() => {});
    const subscription = Linking.addEventListener("url", (event) => void handle(event.url));
    return () => subscription.remove();
  }, [router]);

  const loading = profile.loading || linkLoading;
  // Said once the app has settled on its screen: a banner, or for a signed-out player whose link failed, on the
  // sign-in form beside a fresh start (the banner would vanish while they read it).
  useEffect(() => {
    if (!linkNotice || loading) return;
    if (linkNotice.kind === "done") notifyDone(linkNotice.message);
    else if (session) notifyError(linkNotice.message);
    else setLinkError(linkNotice.message);
    setLinkNotice(undefined);
  }, [linkNotice, loading, session]);

  const userId = session?.user.id;
  useEffect(() => {
    forgetPlayerData();
  }, []);
  useEffect(() => {
    if (!userId) return;
    // Token reconciliation is best effort and never asks for permission during startup.
    const reconcile = () => {
      void reconcileNativePush(userId).catch(() => {});
    };
    reconcile();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") reconcile();
    });
    return () => subscription.remove();
  }, [userId]);
  useEffect(() => subscribeNativeNotifications((path) => void openScreen(path as Href)), []);
  return (
    <Context.Provider
      value={{
        session,
        me: profile.profile,
        loading,
        error: profile.error,
        linkError,
        refreshProfile,
        retry: () => setAttempt((value) => value + 1),
        signOut: async (options) => {
          if (options?.accountDeleted) {
            await forgetNativePush().catch(() => undefined);
            await (await getSupabase()).auth.signOut({ scope: "local" });
            forgetPlayerData();
            return;
          }
          await disableNativePush();
          const { error } = await (await getSupabase()).auth.signOut();
          if (error) throw new Error(authMessage(error));
          forgetPlayerData();
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error("AuthProvider is missing");
  return context;
}
