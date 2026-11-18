/**
 * Where each browser history entry was scrolled to, so Back and Forward return to the same place. Pure
 * bookkeeping for `scrollRestore.web.ts`; kept in memory only, for the most recent `MAX_ENTRIES` entries.
 */
const MAX_ENTRIES = 100;
/** How long after the browser's Back/Forward a screen may mount and still count as that entry coming back. */
export const POP_WINDOW_MS = 1500;

export type ScrollMemory = {
  offsets: Map<string, number>;
  /** The history entry Back/Forward last moved to, and when. */
  popped?: { entry: string; at: number };
};

export const createScrollMemory = (): ScrollMemory => ({ offsets: new Map() });

/** One scroll view's key: the history entry it belongs to, and its name on that screen. */
export const scrollKey = (entry: string, name: string) => `${entry}:${name}`;

/** Remembers an offset, forgetting the entries used longest ago. The top of a page needs no entry. */
export function rememberOffset(memory: ScrollMemory, key: string, offset: number) {
  memory.offsets.delete(key);
  if (offset > 0) memory.offsets.set(key, offset);
  while (memory.offsets.size > MAX_ENTRIES) {
    const oldest = memory.offsets.keys().next();
    if (oldest.done) break;
    memory.offsets.delete(oldest.value);
  }
}

/** Notes that the browser moved to an existing history entry (Back or Forward). */
export function notePop(memory: ScrollMemory, entry: string | undefined, now: number) {
  memory.popped = entry ? { entry, at: now } : undefined;
}

/**
 * The offset a scroll view mounting now should return to: only when its history entry was just reached by
 * Back or Forward and it had been scrolled. A screen opened fresh (a link, a tab press, a reload) starts at
 * the top.
 */
export function offsetToRestore(memory: ScrollMemory, entry: string | undefined, name: string, now: number) {
  const popped = memory.popped;
  if (!entry || !popped || popped.entry !== entry || now - popped.at > POP_WINDOW_MS) return undefined;
  return memory.offsets.get(scrollKey(entry, name));
}
