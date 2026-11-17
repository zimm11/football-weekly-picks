import { useSyncExternalStore } from "react";

const counts = new Map<string, number>();
const subscribers = new Set<() => void>();
const changed = new Set<() => void>();
const notices = new Map<string, string>();

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
export function setMessageNotice(leagueId: string, message: string) {
  notices.set(leagueId, message);
}
export function takeMessageNotice(leagueId: string) {
  const message = notices.get(leagueId) ?? "";
  notices.delete(leagueId);
  return message;
}

/** Call when changing account so unread state from the previous player cannot survive sign-out. */
export function clearMessageUnread() {
  counts.clear();
  notices.clear();
  for (const listener of subscribers) listener();
}
