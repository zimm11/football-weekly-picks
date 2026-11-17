import type { Me } from "@picks/shared";
import type { Session } from "@supabase/supabase-js";
import { type Href, useRouter } from "expo-router";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import { getSupabase, messageOf, request } from "./api";
import { authCallback } from "./links";
import { clearMessageUnread } from "./messageUnread";
import { openScreen } from "./navigation";
import { disableNativePush, reconcileNativePush, subscribeNativeNotifications } from "./notifications";

type Auth = {
  session: Session | null;
  me: Me | null;
  loading: boolean;
  error?: string;
  /** Why an emailed link (sign-in, password reset) didn't work, shown on the sign-in form beside a fresh start. */
  linkError?: string;
  refreshProfile: () => Promise<void>;
  retry: () => void;
  signOut: () => Promise<void>;
};
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkLoading, setLinkLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [linkError, setLinkError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const profileRef = useRef<Me | null>(null);
  const profileGeneration = useRef(0);
  const mounted = useRef(true);
  const handledLinks = useRef(new Set<string>());
  const router = useRouter();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      profileGeneration.current += 1;
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    const userId = sessionRef.current?.user.id;
    if (!userId) return;
    const generation = ++profileGeneration.current;
    const profile = await request<Me>("/me");
    if (
      mounted.current &&
      generation === profileGeneration.current &&
      sessionRef.current?.user.id === userId &&
      profile.id === userId
    ) {
      profileRef.current = profile;
      setMe(profile);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries initialization.
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    let authGeneration = 0;
    setLoading(true);
    setError(undefined);
    getSupabase()
      .then(async (sb) => {
        if (!active) return;
        const update = async (next: Session | null) => {
          const sameUser = next?.user.id === sessionRef.current?.user.id;
          sessionRef.current = next;
          setSession(next);
          // Repeated SIGNED_IN and token refresh events must not unmount screens holding edits.
          if (sameUser && next && profileRef.current?.id === next.user.id) {
            setLoading(false);
            return;
          }
          const current = ++profileGeneration.current;
          profileRef.current = null;
          setMe(null);
          setError(undefined);
          if (!next) {
            setLoading(false);
            return;
          }
          setLoading(true);
          try {
            const profile = await request<Me>("/me");
            if (active && current === profileGeneration.current && profile.id === next.user.id) {
              profileRef.current = profile;
              setMe(profile);
            }
          } catch (err) {
            if (active && current === profileGeneration.current) setError(messageOf(err));
          } finally {
            if (active && current === profileGeneration.current) setLoading(false);
          }
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
        if (active) {
          setError(messageOf(err));
          setLoading(false);
        }
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
      ++profileGeneration.current;
      stop?.();
      appState.remove();
    };
  }, [attempt, router]);

  useEffect(() => {
    let active = true;
    const handle = async (url: string) => {
      const callback = authCallback(url);
      if (!callback || handledLinks.current.has(url)) return;
      if (!callback.code && !callback.error && !(callback.accessToken && callback.refreshToken)) return;
      handledLinks.current.add(url);
      setLinkLoading(true);
      setLinkError(undefined);
      try {
        if (callback.error) throw new Error(callback.error);
        const sb = await getSupabase();
        if (!active) return;
        if (callback.code) {
          const { error } = await sb.auth.exchangeCodeForSession(callback.code);
          if (error) throw error;
        } else if (callback.accessToken && callback.refreshToken) {
          const { error } = await sb.auth.setSession({
            access_token: callback.accessToken,
            refresh_token: callback.refreshToken,
          });
          if (error) throw error;
        }
        if (active && callback.recovery) router.replace("/reset-password");
      } catch (err) {
        // An expired or used link is the player's to retry from the form, not an app failure.
        if (active) setLinkError(messageOf(err));
      } finally {
        if (active) setLinkLoading(false);
      }
    };
    Linking.getInitialURL()
      .then((url) => {
        if (active && url) void handle(url);
      })
      .catch(() => {});
    const subscription = Linking.addEventListener("url", (event) => void handle(event.url));
    return () => {
      active = false;
      subscription.remove();
    };
  }, [router]);
  const userId = session?.user.id;
  useEffect(() => {
    clearMessageUnread();
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
        me,
        loading: loading || linkLoading,
        error,
        linkError,
        refreshProfile,
        retry: () => {
          profileRef.current = null;
          setAttempt((value) => value + 1);
        },
        signOut: async () => {
          await disableNativePush();
          const { error } = await (await getSupabase()).auth.signOut();
          if (error) throw error;
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
