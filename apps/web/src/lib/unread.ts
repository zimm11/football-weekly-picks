import type { ThreadPage } from "@picks/shared";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api, unwrap } from "../api";
import { usePolling } from "./usePolling";

/**
 * Each league's count of unread message-board threads, shared by the Messages tab's dot and the board itself,
 * so the board's own load also updates the dot instead of the dot fetching the same list again.
 */
const counts = new Map<string, number>();
const listeners = new Set<() => void>();

export function setUnreadThreads(leagueId: string, count: number) {
  if (counts.get(leagueId) === count) return;
  counts.set(leagueId, count);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Something on the board changed (a thread posted, a reply, a thread read): the count is fetched again. */
export const announceMessagesChanged = () => window.dispatchEvent(new Event("messages-changed"));

/** How often the count (and the board, while it is on screen) is fetched again. */
export const MESSAGES_REFRESH_MS = 30_000;

/**
 * The league's unread thread count. While `fetch` is true it is fetched now, every 30 seconds while the tab is
 * visible, and whenever the board changes; pass false while the board is on screen, since its own load
 * reports the count.
 */
export function useUnreadThreads(leagueId: string, fetch: boolean): number {
  const count = useSyncExternalStore(subscribe, () => counts.get(leagueId) ?? 0);
  const refresh = useCallback(() => {
    // One thread is enough: the count covers the whole board.
    unwrap<ThreadPage>(
      api.leagues[":leagueId"].messages.$get({ param: { leagueId }, query: { limit: "1" } }),
    ).then(
      (page) => setUnreadThreads(leagueId, page.unreadCount),
      () => {},
    );
  }, [leagueId]);
  useEffect(() => {
    if (!fetch) return;
    refresh();
    window.addEventListener("messages-changed", refresh);
    return () => window.removeEventListener("messages-changed", refresh);
  }, [fetch, refresh]);
  usePolling(refresh, MESSAGES_REFRESH_MS, fetch);
  return count;
}
