/**
 * Whose profile the app holds, and whether it is still waiting for one. `AuthProvider` (lib/auth.tsx) feeds it
 * the session's player as Supabase reports them and asks it to refresh after a profile change; everything the
 * splash, the error screen and the name step need comes out of `publish`.
 *
 * The rules, so no ordering of sign-in, sign-out, the first load and `refresh` can leave `loading` stuck:
 *
 * - `loading` is true only while the player is unknown (`reset`) or their profile hasn't arrived yet.
 * - Every fetch, the first load or a refresh, takes a number. A profile is shown only when it belongs to the
 *   current player and is newer than the one shown, so a slow first load can't overwrite a refresh that
 *   answered before it. Whichever answers first ends `loading`.
 * - A first load that fails shows its error only if nothing has shown a profile since; a failed refresh is
 *   the caller's (it rejects) and never touches `loading`.
 * - A new player (another account, or signed out) makes everything still in flight for the last one stale.
 */
export type ProfileState<P> = { profile: P | null; loading: boolean; error?: string };

export function createProfileLoader<P extends { id: string }>(options: {
  fetch: () => Promise<P>;
  publish: (state: ProfileState<P>) => void;
  messageOf: (error: unknown) => string;
}) {
  let state: ProfileState<P> = { profile: null, loading: true };
  /** The player, `undefined` while not known yet, `null` when signed out. */
  let user: string | null | undefined;
  /** Bumped for every new player: answers for an older one are dropped. */
  let generation = 0;
  let requested = 0;
  let shown = 0;
  let loadingFirst = false;
  let disposed = false;
  const set = (next: ProfileState<P>) => {
    state = next;
    if (!disposed) options.publish(next);
  };
  /** Fetches the profile for the current player; resolves true when it was shown (or a newer one already was). */
  async function fetchProfile(): Promise<boolean> {
    const mine = generation;
    const forUser = user;
    const number = ++requested;
    const profile = await options.fetch();
    if (disposed || mine !== generation || profile.id !== forUser) return false;
    if (number > shown) {
      shown = number;
      set({ profile, loading: false });
    }
    return true;
  }
  async function firstLoad() {
    const mine = generation;
    loadingFirst = true;
    try {
      await fetchProfile();
    } catch (error) {
      // A refresh that answered meanwhile already showed the profile: this failure is old news.
      if (!disposed && mine === generation && !shown)
        set({ profile: null, loading: false, error: options.messageOf(error) });
    } finally {
      if (mine === generation) {
        loadingFirst = false;
        // An answer for someone else (the profile didn't match the session) still ends the wait.
        if (state.loading) set({ ...state, loading: false });
      }
    }
  }
  return {
    /** The player is unknown again (start-up, or Try again): shows the splash until `setUser`. */
    reset() {
      generation += 1;
      user = undefined;
      shown = 0;
      loadingFirst = false;
      set({ profile: null, loading: true });
    },
    /**
     * The session's player: `null` when signed out. The same player again (a token refresh, a repeated
     * SIGNED_IN) keeps what is shown and any load in flight; a failed load is tried again.
     */
    async setUser(next: string | null) {
      if (next === user && next !== null) {
        if (state.profile || loadingFirst) return;
        set({ profile: null, loading: true });
        return firstLoad();
      }
      generation += 1;
      user = next;
      shown = 0;
      loadingFirst = false;
      if (!next) return set({ profile: null, loading: false });
      set({ profile: null, loading: true });
      return firstLoad();
    },
    /** Loads the profile again (after saving a change). Rejects when the request fails; then nothing changes. */
    async refresh() {
      if (!user) return;
      await fetchProfile();
    },
    /** Start-up failed before a player was known (the app's config, the stored session). */
    fail(error: unknown) {
      generation += 1;
      loadingFirst = false;
      set({ profile: null, loading: false, error: options.messageOf(error) });
    },
    /** What is shown now. */
    current: () => state,
    /** The current player's profile, if it has arrived. */
    profileOf: (id: string) => (user === id ? state.profile : null),
    dispose() {
      disposed = true;
      generation += 1;
    },
  };
}
export type ProfileLoader<P extends { id: string }> = ReturnType<typeof createProfileLoader<P>>;
