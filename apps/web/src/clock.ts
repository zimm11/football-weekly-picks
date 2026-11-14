/**
 * The app's notion of "now". Normally the device clock; while the local API runs with
 * `CLOCK_OVERRIDE`, it is shifted by the same offset so the screens and the API agree on pick locks.
 */
let offsetMs = 0;
const listeners = new Set<() => void>();

/** Called once `/api/config` arrives; screens already showing a time refresh through `onClockChange`. */
export function setClockOffset(ms: number | undefined) {
  if ((ms ?? 0) === offsetMs) return;
  offsetMs = ms ?? 0;
  for (const listener of listeners) listener();
}

export function onClockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const clockOffset = () => offsetMs;

export const now = () => new Date(Date.now() + offsetMs);
