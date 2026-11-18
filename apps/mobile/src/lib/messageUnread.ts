import { useSyncExternalStore } from "react";

const counts = new Map<string, number>();
const subscribers = new Set<() => void>();
const changed = new Set<() => void>();
const posting = new Map<string, string | null>();

export function setUnreadThreads(leagueId: string, count: number) {
  if (counts.get(leagueId) === count) return;
  counts.set(leagueId, count);
  for (const listener of subscribers) listener();
}
export function subscribeMessagesChanged(listener: () => void) {
  changed.add(listener);
  return () => {
    changed.delete(listener);
  };
}
export function announceMessagesChanged() {
  for (const listener of changed) listener();
}
export function useUnreadThreads(leagueId: string) {
  return useSyncExternalStore(
    (listener) => {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    () => counts.get(leagueId),
    () => undefined,
  );
}
/**
 * Why the signed-in player can't post in a league right now (a mute, a suspension), as the board last said:
 * null when they can, undefined before any board has loaded. Lets New thread show the notice at once instead
 * of a form that would be refused.
 */
export function setPostingBlocked(leagueId: string, reason: string | null | undefined) {
  if (reason === undefined) return;
  posting.set(leagueId, reason);
}
export function postingBlockedIn(leagueId: string) {
  return posting.get(leagueId);
}

/** Call when changing account so unread state from the previous player cannot survive sign-out. */
export function clearMessageUnread() {
  counts.clear();
  posting.clear();
  for (const listener of subscribers) listener();
}
