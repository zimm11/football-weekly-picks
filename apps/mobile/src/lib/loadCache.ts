/**
 * The last value each screen load returned, kept in memory so a screen that mounts again (another league tab,
 * Back from a thread) draws at once and checks for changes in the background, instead of blanking to a
 * placeholder. `useLeagueLoad` (`screens/leagueUi.tsx`) and `useResource` (`lib/hooks.ts`) read and write it.
 *
 * It holds one player's leagues, picks and messages, so the auth layer empties it (`clearLoadCache`) on sign-out
 * and whenever the signed-in player changes. Nothing is written to storage, errors are never kept, and only the
 * most recently used `MAX_ENTRIES` values stay.
 *
 * Keys: a value that is exactly one API path's response uses that path ("/leagues/<id>"), so two screens loading
 * the same thing share it; anything else uses the hook's own key.
 */
const MAX_ENTRIES = 50;
const entries = new Map<string, unknown>();
let generation = 0;

/** The cached value for `key`, or undefined. Reading counts as use, so the entry is kept longer. */
export function readLoadCache<T>(key: string): T | undefined {
  if (!entries.has(key)) return undefined;
  const value = entries.get(key) as T;
  entries.delete(key);
  entries.set(key, value);
  return value;
}

/**
 * Stores a loaded value. Pass the `loadCacheGeneration()` read when the request started: a value that was asked
 * for before the cache was cleared (the previous player's) is dropped rather than stored for the next player.
 */
export function writeLoadCache(key: string, value: unknown, startedAt = generation) {
  if (startedAt !== generation) return;
  entries.delete(key);
  if (value === undefined) return;
  entries.set(key, value);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

/** Forgets one value: the thing it described is gone (a 404), so nothing stale shows the next time. */
export function dropLoadCache(key: string) {
  entries.delete(key);
}

/** Changes whenever the cache is cleared; see `writeLoadCache`. */
export const loadCacheGeneration = () => generation;

/** Empties the cache. Called on sign-out and when the signed-in player changes: never show one account another's data. */
export function clearLoadCache() {
  generation++;
  entries.clear();
}
