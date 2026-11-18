import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Pull to refresh that tells the truth: `refreshing` is true only from the player's own pull until that reload
 * has settled, never for a background reload (which would drop the spinner in unasked).
 *
 *   const pull = usePullRefresh(league.refresh);
 *   <ScrollView refreshControl={<RefreshControl {...pull} tintColor={colors.foreground} />} />
 *
 * `reload` should return a promise that settles when the reload is done: `refresh` from `useLeagueLoad`, or an
 * async function that awaits the screen's own requests (`() => Promise.all([a.refresh(), b.refresh()])`). A
 * `reload` that returns nothing shows the spinner briefly, since there is nothing to wait for. It never rejects
 * into the scroll view: a failed reload ends the spinner and the screen shows its own error.
 */
export function usePullRefresh(reload: () => unknown) {
  const [refreshing, setRefreshing] = useState(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onRefresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    const started = Date.now();
    void settled(reloadRef.current(), started).then(() => {
      busy.current = false;
      if (mounted.current) setRefreshing(false);
    });
  }, []);
  return { refreshing, onRefresh };
}

/** Shortest time the spinner shows, so a reload from memory doesn't make it flicker. */
export const MIN_SPIN_MS = 400;

/** Resolves once `result` has settled (whatever it was) and the spinner has shown for at least `MIN_SPIN_MS`. */
export async function settled(result: unknown, started: number, now: () => number = Date.now) {
  try {
    await result;
  } catch {
    /* The screen reports its own load errors. */
  }
  const left = MIN_SPIN_MS - (now() - started);
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
}
